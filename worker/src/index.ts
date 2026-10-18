import pkg from "../package.json";
import { errorResponse, json, sha256, sha256Hex } from "./http";
import { log } from "./log";
import { revokeNode, sweepExpired } from "./leases";
import { handleNode } from "./node";
import { authorizationServer, authorize, callback, consent, protectedResource, register, type OAuthEnv } from "./oauth";

export interface Env extends OAuthEnv {
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
  const { video_ids: requested, priority = 0 } = body;
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > 100) return invalid();
  if (!requested.every((v): v is string => typeof v === "string" && VIDEO_ID.test(v))) return invalid();
  const video_ids = [...new Set(requested)];
  if (typeof priority !== "number" || !Number.isSafeInteger(priority) || priority < 0) return invalid();
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
  await sweepExpired(env);
  const row = await env.DB.prepare(
    "SELECT video_id, kind, priority, status, leased_by, lease_expires_at, attempts, tried_nodes, last_outcome, created_at, done_at FROM jobs WHERE video_id = ? AND kind = 'primary'",
  )
    .bind(videoId)
    .first<{ tried_nodes: string }>();
  if (row === null) return notFound();
  return json({ ...row, tried_nodes: JSON.parse(row.tried_nodes) as string[] });
}

async function showTranscript(env: Env, videoId: string): Promise<Response> {
  const object = await env.TRANSCRIPTS.get(`transcripts/${videoId}.json`);
  if (object === null) return notFound();
  const { node_id, lease_id, produced_at } = object.customMetadata ?? {};
  return json({ video_id: videoId, transcript: JSON.parse(await object.text()) as unknown, node_id, lease_id, produced_at });
}

async function inviteUser(request: Request, env: Env, revoke: boolean): Promise<Response> {
  const body = await readJson(request);
  if (body === undefined || Object.keys(body).some((k) => k !== "email")) return invalid();
  const { email: raw } = body;
  if (typeof raw !== "string" || !raw.includes("@")) return invalid();
  const email = raw.toLowerCase();
  if (revoke) {
    const updated = await env.DB.prepare("UPDATE invites SET revoked = 1 WHERE email = ?").bind(email).run();
    if (updated.meta.changes === 0) return notFound();
    return json({ email, revoked: true });
  }
  await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET revoked = 0")
    .bind(email, new Date().toISOString())
    .run();
  return json({ email, revoked: false });
}

async function listUsers(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT user_sub, email, role FROM users ORDER BY email").all();
  return json({ users: results });
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
  if (request.method === "POST" && path === "/ops/invites") return inviteUser(request, env, false);
  if (request.method === "POST" && path === "/ops/invites/revoke") return inviteUser(request, env, true);
  if (request.method === "GET" && path === "/ops/users") return listUsers(env);
  const job = /^\/ops\/jobs\/([^/]+)$/.exec(path);
  if (request.method === "GET" && job?.[1] !== undefined) return showJob(env, job[1]);
  const transcript = /^\/ops\/transcripts\/([^/]+)$/.exec(path);
  if (request.method === "GET" && transcript?.[1] !== undefined) return showTranscript(env, transcript[1]);
  const revoked = /^\/ops\/nodes\/([^/]+)$/.exec(path);
  if (request.method === "DELETE" && revoked?.[1] !== undefined) return revokeNode(env, revoked[1]);
  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/ops" || pathname.startsWith("/ops/")) return handleOps(request, env, pathname);
    if (pathname.startsWith("/node/")) return handleNode(request, env, pathname);
    const get = request.method === "GET";
    if (get && (pathname === "/.well-known/oauth-protected-resource" || pathname === "/.well-known/oauth-protected-resource/mcp")) {
      return protectedResource(env, request);
    }
    if (get && pathname === "/.well-known/oauth-authorization-server") return authorizationServer(env, request);
    if (request.method === "POST" && pathname === "/register") return register(request, env);
    if (get && pathname === "/authorize") return authorize(request, env);
    if (request.method === "POST" && pathname === "/authorize/consent") return consent(request, env);
    if (get && pathname === "/callback") return callback(request, env);
    if (request.method === "GET" && pathname === "/health") return json({ status: "ok", version: pkg.version });
    return notFound();
  },
} satisfies ExportedHandler<Env>;
