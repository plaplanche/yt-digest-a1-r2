import { sha256Hex } from "./http";
import { log } from "./log";

export interface OAuthEnv {
  DB: D1Database;
  PUBLIC_URL?: string;
  AUTH_CODE_TTL_SECONDS?: string;
  AUTH_REQUEST_TTL_SECONDS?: string;
  GOOGLE_ISSUER?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_EMAIL?: string;
  TOKEN_ENC_KEY?: string;
}

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";
const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME = 200;

const base = (env: OAuthEnv, request: Request): string => (env.PUBLIC_URL ?? new URL(request.url).origin).replace(/\/+$/, "");

function ttlMs(value: string | undefined, fallbackSeconds: number): number {
  const n = Number(value);
  return (value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : fallbackSeconds) * 1000;
}

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = (bytes = 32): string => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

function oauthJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function page(status: number, title: string, body: string): Response {
  const html = `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "frame-ancestors 'none'", "X-Frame-Options": "DENY" },
  });
}

const errorPage = (message: string): Response => page(400, "Error", `<h1>Error</h1><p>${escapeHtml(message)}</p>`);

function redirectTo(target: string, params: Record<string, string | null | undefined>): Response {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

// 10.1

export function protectedResource(env: OAuthEnv, request: Request): Response {
  return oauthJson({
    resource: `${base(env, request)}/mcp`,
    authorization_servers: [base(env, request)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  });
}

export function authorizationServer(env: OAuthEnv, request: Request): Response {
  const BASE = base(env, request);
  return oauthJson({
    issuer: BASE,
    authorization_endpoint: `${BASE}/authorize`,
    token_endpoint: `${BASE}/token`,
    registration_endpoint: `${BASE}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  });
}

// 10.2

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return value.startsWith("https://") && url.hostname !== "";
  return url.protocol === "http:" && value.startsWith("http://") && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

const subsetOf = (value: unknown, allowed: readonly string[]): boolean =>
  Array.isArray(value) && value.every((v) => typeof v === "string" && allowed.includes(v));

export async function register(request: Request, env: OAuthEnv): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthJson({ error: "invalid_request" }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return oauthJson({ error: "invalid_client_metadata" }, 400);
  const meta = body as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > MAX_REDIRECT_URIS || !uris.every(validRedirectUri)) {
    return oauthJson({ error: "invalid_redirect_uri" }, 400);
  }
  const name = meta.client_name;
  const valid =
    (name === undefined || (typeof name === "string" && name.length <= MAX_CLIENT_NAME)) &&
    (meta.token_endpoint_auth_method === undefined || meta.token_endpoint_auth_method === "none") &&
    (meta.grant_types === undefined || subsetOf(meta.grant_types, ["authorization_code", "refresh_token"])) &&
    (meta.response_types === undefined || subsetOf(meta.response_types, ["code"]));
  if (!valid) return oauthJson({ error: "invalid_client_metadata" }, 400);
  const clientId = randomToken(24);
  const now = new Date();
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, typeof name === "string" ? name : null, JSON.stringify(uris), now.toISOString())
    .run();
  log("auth.client.registered", { attrs: { client_id: clientId } });
  return oauthJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      ...(typeof name === "string" ? { client_name: name } : {}),
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

// 10.3

export async function authorize(request: Request, env: OAuthEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const clientId = params.get("client_id");
  const client =
    clientId === null
      ? null
      : await env.DB.prepare("SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?")
          .bind(clientId)
          .first<{ client_name: string | null; redirect_uris: string }>();
  const redirectUri = params.get("redirect_uri");
  if (clientId === null || client === null) return errorPage("Unknown client.");
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) {
    return errorPage("The redirect URI is not registered for this client.");
  }
  const state = params.get("state");
  const fail = (error: string): Response => redirectTo(redirectUri, { error, state });
  if (params.get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = params.get("code_challenge");
  if (challenge === null || challenge === "" || params.get("code_challenge_method") !== "S256") return fail("invalid_request");
  const resource = params.get("resource");
  if (resource !== `${base(env, request)}/mcp`) return fail("invalid_target");
  const scope = params.get("scope") ?? SCOPE;
  if (scope !== SCOPE) return fail("invalid_scope");

  const requestId = randomToken(24);
  const expires = new Date(Date.now() + ttlMs(env.AUTH_REQUEST_TTL_SECONDS, 600)).toISOString();
  await env.DB.prepare(
    "INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(requestId, clientId, redirectUri, state, challenge, scope, resource, expires)
    .run();
  const name = client.client_name ?? clientId;
  return page(
    200,
    "Authorize access",
    `<h1>Authorize access</h1>
<p><strong>${escapeHtml(name)}</strong> asks to access your yt-digest account.</p>
<p>Redirect URI: <code>${escapeHtml(redirectUri)}</code></p>
<p>Scope: <code>${escapeHtml(scope)}</code></p>
<form method="post" action="/authorize/consent">
<input type="hidden" name="request" value="${escapeHtml(requestId)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`,
  );
}

interface PendingRequest {
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
}

interface GoogleConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

async function googleConfig(env: OAuthEnv): Promise<GoogleConfig> {
  const issuer = (env.GOOGLE_ISSUER ?? "").replace(/\/+$/, "");
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error("google discovery failed");
  const doc = (await res.json()) as Partial<GoogleConfig>;
  if (typeof doc.authorization_endpoint !== "string" || typeof doc.token_endpoint !== "string" || typeof doc.jwks_uri !== "string") {
    throw new Error("google discovery is incomplete");
  }
  return { authorization_endpoint: doc.authorization_endpoint, token_endpoint: doc.token_endpoint, jwks_uri: doc.jwks_uri };
}

export async function consent(request: Request, env: OAuthEnv): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorPage("Invalid request.");
  }
  const requestId = form.get("request");
  const decision = form.get("decision");
  if (typeof requestId !== "string" || (decision !== "approve" && decision !== "deny")) return errorPage("Invalid request.");
  const nowIso = new Date().toISOString();
  const pending = await env.DB.prepare(
    "SELECT client_id, redirect_uri, client_state FROM oauth_requests WHERE request_id = ? AND used_at IS NULL AND expires_at > ?",
  )
    .bind(requestId, nowIso)
    .first<PendingRequest>();
  if (pending === null) return errorPage("This authorization request is unknown, expired or already used.");

  if (decision === "deny") {
    const used = await env.DB.prepare("UPDATE oauth_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL")
      .bind(nowIso, requestId)
      .run();
    if (used.meta.changes === 0) return errorPage("This authorization request is unknown, expired or already used.");
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "access_denied" } });
    return redirectTo(pending.redirect_uri, { error: "access_denied", state: pending.client_state });
  }

  let config: GoogleConfig;
  try {
    config = await googleConfig(env);
  } catch {
    return page(502, "Error", "<h1>Error</h1><p>The sign-in provider is unavailable.</p>");
  }
  const googleState = randomToken(24);
  const nonce = randomToken(24);
  const bound = await env.DB.prepare(
    "UPDATE oauth_requests SET google_state = ?, google_nonce = ? WHERE request_id = ? AND used_at IS NULL AND expires_at > ?",
  )
    .bind(googleState, nonce, requestId, nowIso)
    .run();
  if (bound.meta.changes === 0) return errorPage("This authorization request is unknown, expired or already used.");
  return redirectTo(config.authorization_endpoint, {
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${base(env, request)}/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state: googleState,
    nonce,
    access_type: "offline",
    prompt: "consent",
  });
}

// 10.4

const fromB64url = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

interface IdClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nonce?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

async function verifyIdToken(token: string, jwksUri: string, env: OAuthEnv, nonce: string): Promise<IdClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, s] = parts as [string, string, string];
  const decode = (part: string): unknown => JSON.parse(new TextDecoder().decode(fromB64url(part)));
  const header = decode(h) as { alg?: unknown; kid?: unknown };
  if (header.alg !== "RS256") throw new Error("bad alg");
  const res = await fetch(jwksUri);
  if (!res.ok) throw new Error("jwks unavailable");
  const jwks = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const jwk = (jwks.keys ?? []).find((k) => k.kty === "RSA" && (header.kid === undefined || k.kid === header.kid));
  if (jwk === undefined) throw new Error("no key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) throw new Error("bad signature");
  const claims = decode(p) as IdClaims;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !env.GOOGLE_ISSUER ||
    !env.GOOGLE_CLIENT_ID ||
    claims.iss !== env.GOOGLE_ISSUER ||
    !aud.includes(env.GOOGLE_CLIENT_ID) ||
    typeof claims.exp !== "number" ||
    claims.exp * 1000 <= Date.now() ||
    claims.nonce !== nonce ||
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string"
  ) {
    throw new Error("bad claims");
  }
  return claims;
}

async function encrypt(value: string, keyBase64: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv);
  packed.set(cipher, iv.length);
  return `v1:${btoa(String.fromCharCode(...packed))}`;
}

const refusal = (): Response =>
  page(403, "Access refused", "<h1>Access refused</h1><p>This account is not invited.</p>");

export async function callback(request: Request, env: OAuthEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const nowIso = new Date().toISOString();
  const pending =
    state === null || state === ""
      ? null
      : await env.DB.prepare(
          "UPDATE oauth_requests SET used_at = ? WHERE google_state = ? AND used_at IS NULL AND expires_at > ? RETURNING client_id, redirect_uri, client_state, code_challenge, scope, resource, google_nonce",
        )
          .bind(nowIso, state, nowIso)
          .first<PendingRequest & { google_nonce: string }>();
  if (pending === null) return errorPage("This sign-in is unknown, expired or already used.");
  const toClient = (error: string): Response => redirectTo(pending.redirect_uri, { error, state: pending.client_state });
  const googleFailure = (): Response => {
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: pending.client_id, reason: "google_error" } });
    return toClient("server_error");
  };

  if (params.has("error")) {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "google_error" } });
    return toClient("access_denied");
  }
  const code = params.get("code");
  if (code === null || code === "") return googleFailure();

  let claims: IdClaims;
  let googleRefresh: string | null;
  try {
    const config = await googleConfig(env);
    const res = await fetch(config.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${base(env, request)}/callback`,
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      }),
    });
    if (!res.ok) throw new Error("token exchange failed");
    const tokens = (await res.json()) as { id_token?: unknown; refresh_token?: unknown };
    if (typeof tokens.id_token !== "string") throw new Error("no id_token");
    claims = await verifyIdToken(tokens.id_token, config.jwks_uri, env, pending.google_nonce);
    googleRefresh = typeof tokens.refresh_token === "string" ? tokens.refresh_token : null;
  } catch {
    return googleFailure();
  }

  const sub = claims.sub as string;
  const email = (claims.email as string).toLowerCase();
  const isAdmin = email === (env.ADMIN_EMAIL ?? "").toLowerCase();
  const invite = await env.DB.prepare("SELECT 1 AS found FROM invites WHERE email = ? AND revoked = 0").bind(email).first();
  if (claims.email_verified !== true) {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "email_unverified" } });
    return refusal();
  }
  if (!isAdmin && invite === null) {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "not_invited" } });
    return refusal();
  }
  const role = isAdmin ? "admin" : "member";

  let encrypted: string | null;
  try {
    encrypted = googleRefresh === null ? null : await encrypt(googleRefresh, env.TOKEN_ENC_KEY ?? "");
  } catch {
    log("auth.oauth.denied", { level: "error", attrs: { client_id: pending.client_id, reason: "server_error" } });
    return toClient("server_error");
  }
  const authCode = randomToken(32);
  // Admission is part of each statement, so a revocation landing after the check above cannot be missed.
  const admitted = "(? = 1 OR EXISTS (SELECT 1 FROM invites WHERE email = ? AND revoked = 0))";
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) SELECT ?, ?, ?, ?, ? WHERE ${admitted} ON CONFLICT(user_sub) DO UPDATE SET email = excluded.email, role = excluded.role, google_refresh_token_enc = COALESCE(excluded.google_refresh_token_enc, google_refresh_token_enc)`,
    ).bind(sub, email, role, encrypted, nowIso, isAdmin ? 1 : 0, email),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ? WHERE email = ? AND revoked = 0").bind(sub, email),
    env.DB.prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${admitted}`,
    ).bind(
      await sha256Hex(authCode),
      pending.client_id,
      sub,
      pending.redirect_uri,
      pending.code_challenge,
      pending.scope,
      pending.resource,
      new Date(Date.now() + ttlMs(env.AUTH_CODE_TTL_SECONDS, 60)).toISOString(),
      isAdmin ? 1 : 0,
      email,
    ),
  ]);
  if (results[2]?.meta.changes === 0) {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "not_invited" } });
    return refusal();
  }
  log("auth.oauth.completed", { attrs: { client_id: pending.client_id, role } });
  return redirectTo(pending.redirect_uri, { code: authCode, state: pending.client_state });
}
