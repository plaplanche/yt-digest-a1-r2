import type { Env } from "./index";
import { errorResponse, json, sha256Hex } from "./http";
import { log } from "./log";
import type { NodeClaimRequest } from "./contracts/node-claim-request";
import type { NodeClaimResponse } from "./contracts/node-claim-response";
import type { NodeHeartbeatRequest } from "./contracts/node-heartbeat-request";
import type { NodeHeartbeatResponse } from "./contracts/node-heartbeat-response";

const DEFAULT_MAX_JOBS = 3;
const DEFAULT_LEASE_SECONDS = 600;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;
const isTimestampOrNull = (value: unknown): boolean => value === null || (typeof value === "string" && TIMESTAMP.test(value));

// Hand-written checks of the schemas: workerd forbids the code generation Ajv relies on.
function validHeartbeat(body: unknown): body is NodeHeartbeatRequest {
  if (!isObject(body)) return false;
  const allowed = ["version", "uptime_s", "jobs_in_progress", "last_success_at", "last_blocked_at", "disk_free_ratio", "cpu_temp_c"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return false;
  const { version, uptime_s, jobs_in_progress, last_success_at, last_blocked_at, disk_free_ratio, cpu_temp_c } = body;
  return (
    typeof version === "string" && version.length >= 1 && version.length <= 64 &&
    isCount(uptime_s) && isCount(jobs_in_progress) &&
    (last_success_at === undefined || isTimestampOrNull(last_success_at)) &&
    (last_blocked_at === undefined || isTimestampOrNull(last_blocked_at)) &&
    (disk_free_ratio === undefined || (typeof disk_free_ratio === "number" && disk_free_ratio >= 0 && disk_free_ratio <= 1)) &&
    (cpu_temp_c === undefined || (typeof cpu_temp_c === "number" && Number.isFinite(cpu_temp_c)))
  );
}

function validClaim(body: unknown): body is NodeClaimRequest {
  if (!isObject(body)) return false;
  if (Object.keys(body).some((key) => key !== "max_jobs")) return false;
  const { max_jobs } = body;
  return max_jobs === undefined || (Number.isInteger(max_jobs) && (max_jobs as number) >= 1 && (max_jobs as number) <= 10);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function unauthorized(reason: "missing" | "unknown" | "revoked"): Response {
  log("auth.bearer.rejected", { level: "warn", attrs: { surface: "node", reason } });
  return errorResponse(401, "unauthorized", "Missing or invalid node token");
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function handleNode(request: Request, env: Env, path: string): Promise<Response> {
  const endpoint = path.slice("/node/".length);
  if (request.method !== "POST" || (endpoint !== "heartbeat" && endpoint !== "claim")) {
    return errorResponse(404, "not_found", "Not found");
  }

  const match = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
  if (match?.[1] === undefined) return unauthorized("missing");
  const node = await env.DB.prepare("SELECT node_id, hourly_budget, revoked_at FROM nodes WHERE token_hash = ?")
    .bind(await sha256Hex(match[1]))
    .first<{ node_id: string; hourly_budget: number; revoked_at: string | null }>();
  if (node === null) return unauthorized("unknown");
  if (node.revoked_at !== null) return unauthorized("revoked");

  const body = await readBody(request);
  if (endpoint === "heartbeat") {
    if (!validHeartbeat(body)) return errorResponse(400, "invalid_request", "Invalid heartbeat body");
    return heartbeat(env, node, body);
  }
  if (!validClaim(body)) return errorResponse(400, "invalid_request", "Invalid claim body");
  return claim(env, node.node_id, body.max_jobs ?? DEFAULT_MAX_JOBS);
}

async function heartbeat(env: Env, node: { node_id: string; hourly_budget: number }, body: NodeHeartbeatRequest): Promise<Response> {
  await env.DB.prepare("UPDATE nodes SET last_heartbeat_at = ?, version = ? WHERE node_id = ?")
    .bind(new Date().toISOString(), body.version, node.node_id)
    .run();
  log("node.heartbeat", {
    attrs: { node_id: node.node_id, version: body.version, jobs_in_progress: body.jobs_in_progress },
  });
  const response: NodeHeartbeatResponse = {
    node_id: node.node_id,
    state: "healthy",
    hourly_budget: node.hourly_budget,
    directive: "run",
  };
  return json(response);
}

// One D1 batch (a single transaction): the conditional UPDATE picks and leases the jobs, so two
// claims can never take the same job and none comes back short; the lease rows are copied from
// the jobs the UPDATE just marked with this claim's lease id prefix.
async function claim(env: Env, nodeId: string, maxJobs: number): Promise<Response> {
  const leaseSeconds = Number(env.LEASE_SECONDS) > 0 ? Number(env.LEASE_SECONDS) : DEFAULT_LEASE_SECONDS;
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const prefix = hex(crypto.getRandomValues(new Uint8Array(16)));

  const [, , claimed] = await env.DB.batch<{ video_id: string; lease_id: string; lease_expires_at: string; attempts: number }>([
    env.DB.prepare(
      `UPDATE jobs SET status = 'leased', leased_by = ?1, lease_id = ?2 || '.' || video_id, lease_expires_at = ?3,
         attempts = attempts + 1, tried_nodes = json_insert(tried_nodes, '$[#]', ?1)
       WHERE status = 'queued' AND rowid IN (
         SELECT rowid FROM jobs
         WHERE status = 'queued' AND NOT EXISTS (SELECT 1 FROM json_each(jobs.tried_nodes) WHERE value = ?1)
         ORDER BY priority DESC, created_at ASC, video_id ASC LIMIT ?4)`,
    ).bind(nodeId, prefix, expiresAt, maxJobs),
    env.DB.prepare(
      `INSERT INTO leases (lease_id, video_id, node_id, issued_at, expires_at, state)
       SELECT lease_id, video_id, leased_by, ?2, lease_expires_at, 'active' FROM jobs WHERE lease_id LIKE ?1 || '.%'`,
    ).bind(prefix, issuedAt),
    env.DB.prepare(
      `SELECT video_id, lease_id, lease_expires_at, attempts FROM jobs WHERE lease_id LIKE ?1 || '.%'
       ORDER BY priority DESC, created_at ASC, video_id ASC`,
    ).bind(prefix),
  ] as D1PreparedStatement[]);

  const rows = claimed?.results ?? [];
  for (const row of rows) {
    log("job.claimed", {
      video_id: row.video_id,
      attrs: { node_id: nodeId, attempt: row.attempts, lease_seconds: leaseSeconds },
    });
  }
  const response: NodeClaimResponse = {
    jobs: rows.map((r) => ({ video_id: r.video_id, lease_id: r.lease_id, lease_expires_at: r.lease_expires_at })),
  };
  return json(response);
}
