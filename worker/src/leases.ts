import type { Env } from "./index";
import { errorResponse, json } from "./http";
import { log } from "./log";
import type { NodeJobAck } from "./contracts/node-job-ack";
import type { NodeReleaseRequest } from "./contracts/node-release-request";
import type { NodeResultRequest } from "./contracts/node-result-request";

const MAX_ATTEMPTS = 3;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const OUTCOMES = ["ok", "no_transcript", "unavailable", "blocked", "error"];
const TRANSCRIPT_KEYS = ["video_id", "status", "lang", "source", "word_count", "truncated", "sponsor_ratio", "pages"];
const TRUNCATION_MARKER = "[…]";

type Outcome = NodeResultRequest["outcome"];
type LeaseState = "completed" | "released" | "expired" | "revoked" | "rejected";
type LastOutcome = Outcome | "validation_failed" | "lease_expired" | "lease_revoked" | "released";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Hand-written checks of the schemas: workerd forbids the code generation Ajv relies on.
export function validRelease(body: unknown): body is NodeReleaseRequest {
  return isObject(body) && Object.keys(body).every((k) => k === "lease_id") && typeof body.lease_id === "string" && body.lease_id.length >= 1;
}

function validTranscript(value: unknown): boolean {
  if (!isObject(value) || Object.keys(value).some((k) => !TRANSCRIPT_KEYS.includes(k)) || TRANSCRIPT_KEYS.some((k) => !(k in value))) return false;
  const { video_id, status, lang, source, word_count, truncated, sponsor_ratio, pages } = value;
  return (
    typeof video_id === "string" && VIDEO_ID.test(video_id) &&
    (status === "ok" || status === "no_transcript" || status === "unavailable" || status === "blocked") &&
    (lang === null || typeof lang === "string") &&
    (source === null || source === "manual" || source === "auto") &&
    Number.isInteger(word_count) && (word_count as number) >= 0 &&
    typeof truncated === "boolean" &&
    (sponsor_ratio === null || (typeof sponsor_ratio === "number" && sponsor_ratio >= 0 && sponsor_ratio <= 1)) &&
    Array.isArray(pages) && pages.every((p) => typeof p === "string")
  );
}

export function validResult(body: unknown): body is NodeResultRequest {
  if (!isObject(body) || Object.keys(body).some((k) => k !== "lease_id" && k !== "outcome" && k !== "transcript")) return false;
  const { lease_id, outcome, transcript } = body;
  return (
    typeof lease_id === "string" && lease_id.length >= 1 &&
    typeof outcome === "string" && OUTCOMES.includes(outcome) &&
    "transcript" in body && (transcript === null || validTranscript(transcript))
  );
}

interface EndedLease {
  leaseId: string;
  videoId: string;
  nodeId: string;
  leaseState: LeaseState;
  lastOutcome: LastOutcome;
  /** `done` for a success, `fail` for the failure handling of 8.7. */
  job: "done" | "fail";
  /** The node event kind recorded against the node, if any. */
  event?: string;
}

// Ends a lease and updates its job in one D1 batch. Both writes are conditional on the lease still
// being the job's current one, so of two racing requests only one wins. Returns the job's status
// when this call won, undefined when the lease had already ended.
async function endLease(env: Env, end: EndedLease): Promise<{ status: NodeJobAck["status"]; attempts: number } | undefined> {
  const now = new Date().toISOString();
  const cleared = "leased_by = NULL, lease_id = NULL, lease_expires_at = NULL";
  const jobUpdate =
    end.job === "done"
      ? env.DB.prepare(`UPDATE jobs SET status = 'done', done_at = ?1, last_outcome = ?2, ${cleared} WHERE video_id = ?3 AND kind = 'primary' AND status = 'leased' AND lease_id = ?4`)
      : env.DB.prepare(
          `UPDATE jobs SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed_video' ELSE 'queued' END,
             done_at = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN ?1 ELSE NULL END, last_outcome = ?2, ${cleared}
           WHERE video_id = ?3 AND kind = 'primary' AND status = 'leased' AND lease_id = ?4`,
        );
  const statements = [
    jobUpdate.bind(now, end.lastOutcome, end.videoId, end.leaseId),
    env.DB.prepare(
      `UPDATE leases SET state = ?1,
         response_json = (SELECT json_object('video_id', video_id, 'status', status) FROM jobs WHERE video_id = ?2 AND kind = 'primary')
       WHERE lease_id = ?3 AND state = 'active' AND changes() > 0`,
    ).bind(end.leaseState, end.videoId, end.leaseId),
    end.event === undefined
      ? env.DB.prepare("SELECT 1 WHERE changes() > 0")
      : env.DB.prepare("INSERT INTO node_events (node_id, ts, kind, video_id) SELECT ?1, ?2, ?3, ?4 WHERE changes() > 0").bind(end.nodeId, now, end.event, end.videoId),
    env.DB.prepare("SELECT status, attempts FROM jobs WHERE video_id = ?1 AND kind = 'primary'").bind(end.videoId),
  ];
  const results = await env.DB.batch<{ status: NodeJobAck["status"]; attempts: number }>(statements);
  if (results[1]?.meta.changes !== 1) return undefined;
  return results[3]?.results[0];
}

// 8.6: every leased job whose lease expires at or before now goes through the failure handling.
export async function sweepExpired(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT video_id, lease_id, leased_by FROM jobs WHERE status = 'leased' AND lease_expires_at <= ?",
  )
    .bind(new Date().toISOString())
    .all<{ video_id: string; lease_id: string; leased_by: string }>();
  for (const row of results) {
    const ended = await endLease(env, {
      leaseId: row.lease_id,
      videoId: row.video_id,
      nodeId: row.leased_by,
      leaseState: "expired",
      lastOutcome: "lease_expired",
      job: "fail",
      event: "lease_expired",
    });
    if (ended !== undefined) {
      log("job.lease_expired", { video_id: row.video_id, attrs: { node_id: row.leased_by, attempts: ended.attempts, status: ended.status } });
    }
  }
}

interface LeaseRow {
  video_id: string;
  node_id: string;
  state: string;
  response_json: string | null;
}

async function findLease(env: Env, nodeId: string, leaseId: string): Promise<LeaseRow | undefined> {
  const lease = await env.DB.prepare("SELECT video_id, node_id, state, response_json FROM leases WHERE lease_id = ?")
    .bind(leaseId)
    .first<LeaseRow>();
  return lease !== null && lease.node_id === nodeId ? lease : undefined;
}

function stale(nodeId: string, videoId?: string): Response {
  log("job.stale_result", { level: "warn", ...(videoId === undefined ? {} : { video_id: videoId }), attrs: { node_id: nodeId } });
  return errorResponse(409, "stale_lease", "The lease is not current");
}

const stored = (lease: LeaseRow): Response =>
  new Response(lease.response_json, { status: 200, headers: { "Content-Type": "application/json" } });

// The first rule the transcript breaks (design 18.5, reduced), or undefined.
function validationFailure(body: NodeResultRequest, videoId: string): string | undefined {
  const { outcome, transcript } = body;
  if (outcome !== "ok") return transcript === null ? undefined : "transcript_not_null";
  if (transcript === null) return "transcript_missing";
  if (transcript.status !== "ok") return "status_mismatch";
  if (transcript.video_id !== videoId) return "video_id_mismatch";
  if (transcript.pages.length === 0) return "pages_empty";
  const words = transcript.pages.flatMap((page) => page.split(/\s+/).filter((w) => w !== "" && w !== TRUNCATION_MARKER)).length;
  return words === transcript.word_count ? undefined : "word_count_mismatch";
}

export async function handleResult(env: Env, nodeId: string, body: NodeResultRequest): Promise<Response> {
  const lease = await findLease(env, nodeId, body.lease_id);
  if (lease === undefined || lease.state !== "active") {
    if (lease?.state === "completed") return stored(lease);
    return stale(nodeId, lease?.video_id);
  }
  const videoId = lease.video_id;

  const reason = validationFailure(body, videoId);
  if (reason !== undefined) {
    const ended = await endLease(env, {
      leaseId: body.lease_id, videoId, nodeId, leaseState: "rejected", lastOutcome: "validation_failed", job: "fail", event: "validation_failed",
    });
    if (ended === undefined) return stale(nodeId, videoId);
    log("job.validation_failed", { level: "warn", video_id: videoId, attrs: { node_id: nodeId, reason } });
    return errorResponse(422, "validation_failed", `The result is invalid: ${reason}`);
  }

  if (body.outcome === "ok") {
    const key = `transcripts/${videoId}.json`;
    try {
      if ((await env.TRANSCRIPTS.head(key)) === null) {
        await env.TRANSCRIPTS.put(key, JSON.stringify(body.transcript), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { node_id: nodeId, lease_id: body.lease_id, produced_at: new Date().toISOString() },
        });
      }
    } catch {
      return errorResponse(503, "storage_error", "The transcript could not be stored");
    }
  }

  const failing = body.outcome === "unavailable" || body.outcome === "blocked" || body.outcome === "error";
  const ended = await endLease(env, {
    leaseId: body.lease_id, videoId, nodeId, leaseState: "completed", lastOutcome: body.outcome, job: failing ? "fail" : "done", event: `job_${body.outcome}`,
  });
  if (ended === undefined) {
    // Lost a race with the sweep, a revocation or a retry of this very result.
    const current = await findLease(env, nodeId, body.lease_id);
    return current?.state === "completed" ? stored(current) : stale(nodeId, videoId);
  }
  log("job.completed", { video_id: videoId, attrs: { node_id: nodeId, outcome: body.outcome, status: ended.status } });
  const ack: NodeJobAck = { video_id: videoId, status: ended.status };
  return json(ack);
}

export async function handleRelease(env: Env, nodeId: string, body: NodeReleaseRequest): Promise<Response> {
  const lease = await findLease(env, nodeId, body.lease_id);
  if (lease === undefined || lease.state !== "active") {
    if (lease?.state === "released") return stored(lease);
    return stale(nodeId, lease?.video_id);
  }
  const videoId = lease.video_id;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET status = 'queued', leased_by = NULL, lease_id = NULL, lease_expires_at = NULL, attempts = attempts - 1,
         tried_nodes = (SELECT json_group_array(value) FROM json_each(tried_nodes) WHERE value != ?1), last_outcome = 'released'
       WHERE video_id = ?2 AND kind = 'primary' AND status = 'leased' AND lease_id = ?3`,
    ).bind(nodeId, videoId, body.lease_id),
    env.DB.prepare(
      `UPDATE leases SET state = 'released', response_json = json_object('video_id', ?1, 'status', 'queued')
       WHERE lease_id = ?2 AND state = 'active' AND changes() > 0`,
    ).bind(videoId, body.lease_id),
  ]);
  if (results[1]?.meta.changes !== 1) {
    const current = await findLease(env, nodeId, body.lease_id);
    return current?.state === "released" ? stored(current) : stale(nodeId, videoId);
  }
  log("job.released", { video_id: videoId, attrs: { node_id: nodeId } });
  const ack: NodeJobAck = { video_id: videoId, status: "queued" };
  return json(ack);
}

// 8.8: the token is refused from now on, and each active lease of the node is revoked.
export async function revokeNode(env: Env, nodeId: string): Promise<Response> {
  const node = await env.DB.prepare("SELECT revoked_at FROM nodes WHERE node_id = ?").bind(nodeId).first<{ revoked_at: string | null }>();
  if (node === null) return errorResponse(404, "not_found", "Not found");
  const answer = json({ node_id: nodeId, state: "disabled" });
  if (node.revoked_at !== null) return answer;
  const now = new Date().toISOString();
  const revoked = await env.DB.prepare("UPDATE nodes SET state = 'disabled', state_since = ?1, revoked_at = ?1 WHERE node_id = ?2 AND revoked_at IS NULL")
    .bind(now, nodeId)
    .run();
  if (revoked.meta.changes === 0) return answer;
  const { results } = await env.DB.prepare("SELECT lease_id, video_id FROM leases WHERE node_id = ? AND state = 'active'")
    .bind(nodeId)
    .all<{ lease_id: string; video_id: string }>();
  let count = 0;
  for (const row of results) {
    const ended = await endLease(env, {
      leaseId: row.lease_id, videoId: row.video_id, nodeId, leaseState: "revoked", lastOutcome: "lease_revoked", job: "fail",
    });
    if (ended !== undefined) count++;
  }
  log("node.revoked", { attrs: { node_id: nodeId, leases_revoked: count } });
  return answer;
}
