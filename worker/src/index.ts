import pkg from "../package.json";
import { errorResponse, json, sha256, sha256Hex } from "./http";
import { log } from "./log";
import { handleNode } from "./node";

export interface Env {
  DB: D1Database;
  TRANSCRIPTS: R2Bucket;
  OPS_TOKEN?: string;
  LEASE_SECONDS?: string;
}

// Every table of the D1 schema (spec lot 2, section 6.3).
const TABLES = [
  "nodes",
  "jobs",
  "leases",
  "node_events",
  "invites",
  "users",
  "oauth_clients",
  "oauth_requests",
  "oauth_codes",
  "oauth_tokens",
] as const;

const notFound = (): Response => errorResponse(404, "not_found", "Not found");

// Compares the digests of both strings, so the time does not depend on where they differ.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= (da[i] ?? 0) ^ (db[i] ?? 0);
  return diff === 0;
}

async function authenticatedOps(request: Request, opsToken: string): Promise<boolean> {
  const match = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
  const ok = match?.[1] !== undefined && (await safeEqual(match[1], opsToken));
  if (!ok) log("auth.bearer.rejected", { level: "warn", attrs: { surface: "ops", reason: match?.[1] === undefined ? "missing" : "unknown" } });
  return ok;
}

const NODE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const invalid = (): Response => errorResponse(400, "invalid_request", "Invalid request body");

async function enrollNode(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (body === undefined || Object.keys(body).some((k) => k !== "node_id" && k !== "owner_label")) return invalid();
  const { node_id, owner_label } = body;
  if (typeof node_id !== "string" || !NODE_ID.test(node_id)) return invalid();
  if (typeof owner_label !== "string" || owner_label.length < 1 || owner_label.length > 100) return invalid();
  const token = `ytd_node_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES (?, ?, ?, 'healthy', ?, ?)",
  )
    .bind(node_id, owner_label, await sha256Hex(token), now, now)
    .run();
  if (inserted.meta.changes === 0) return errorResponse(409, "conflict", "Node already exists");
  log("node.enrolled", { attrs: { node_id } });
  return json({ node_id, owner_label, token });
}

async function enqueueJobs(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (body === undefined || Object.keys(body).some((k) => k !== "video_ids" && k !== "priority")) return invalid();
  const { video_ids, priority = 0 } = body;
  if (!Array.isArray(video_ids) || video_ids.length < 1 || video_ids.length > 100) return invalid();
  if (!video_ids.every((v): v is string => typeof v === "string" && VIDEO_ID.test(v))) return invalid();
  if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0) return invalid();
  const now = new Date().toISOString();
  const statements = video_ids.flatMap((id) => [
    env.DB.prepare("INSERT OR IGNORE INTO jobs (video_id, kind, priority, status, created_at) VALUES (?, 'primary', ?, 'queued', ?)").bind(id, priority, now),
    env.DB.prepare("UPDATE jobs SET priority = max(priority, ?) WHERE video_id = ? AND kind = 'primary'").bind(priority, id),
  ]);
  const results = await env.DB.batch(statements);
  const enqueued: string[] = [];
  const existing: string[] = [];
  video_ids.forEach((id, i) => (results[i * 2]?.meta.changes === 1 ? enqueued : existing).push(id));
  log("job.enqueued", { attrs: { count: enqueued.length, priority } });
  return json({ enqueued, existing });
}

async function showJob(env: Env, videoId: string): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT video_id, kind, priority, status, leased_by, lease_expires_at, attempts, tried_nodes, last_outcome, created_at, done_at FROM jobs WHERE video_id = ? AND kind = 'primary'",
  )
    .bind(videoId)
    .first<{ tried_nodes: string }>();
  if (row === null) return notFound();
  return json({ ...row, tried_nodes: JSON.parse(row.tried_nodes) as string[] });
}

async function reset(env: Env): Promise<Response> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  let cursor: string | undefined;
  do {
    const page = await env.TRANSCRIPTS.list({ prefix: "transcripts/", cursor });
    if (page.objects.length > 0) await env.TRANSCRIPTS.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return json({ ok: true });
}

async function handleOps(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.OPS_TOKEN) return notFound();
  if (!(await authenticatedOps(request, env.OPS_TOKEN))) {
    return errorResponse(401, "unauthorized", "Missing or invalid operator token");
  }
  if (request.method === "POST" && path === "/ops/reset") return reset(env);
  if (request.method === "POST" && path === "/ops/nodes") return enrollNode(request, env);
  if (request.method === "POST" && path === "/ops/jobs") return enqueueJobs(request, env);
  const job = /^\/ops\/jobs\/([^/]+)$/.exec(path);
  if (request.method === "GET" && job?.[1] !== undefined) return showJob(env, job[1]);
  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/ops" || pathname.startsWith("/ops/")) return handleOps(request, env, pathname);
    if (pathname.startsWith("/node/")) return handleNode(request, env, pathname);
    if (request.method === "GET" && pathname === "/health") return json({ status: "ok", version: pkg.version });
    return notFound();
  },
} satisfies ExportedHandler<Env>;
