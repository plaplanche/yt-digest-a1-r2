import pkg from "../package.json";
import type { ErrorResponse } from "./contracts/error";

export interface Env {
  DB: D1Database;
  TRANSCRIPTS: R2Bucket;
  OPS_TOKEN?: string;
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

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function errorResponse(status: number, code: string, message: string): Response {
  const body: ErrorResponse = { error: { code, message } };
  return json(body, status);
}

const notFound = (): Response => errorResponse(404, "not_found", "Not found");

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Compares the digests of both strings, so the time does not depend on where they differ.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= (da[i] ?? 0) ^ (db[i] ?? 0);
  return diff === 0;
}

async function authenticatedOps(request: Request, opsToken: string): Promise<boolean> {
  const match = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
  return match?.[1] !== undefined && (await safeEqual(match[1], opsToken));
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
  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/ops" || pathname.startsWith("/ops/")) return handleOps(request, env, pathname);
    if (request.method === "GET" && pathname === "/health") return json({ status: "ok", version: pkg.version });
    return notFound();
  },
} satisfies ExportedHandler<Env>;
