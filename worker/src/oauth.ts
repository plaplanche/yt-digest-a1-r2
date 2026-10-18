import type { Env } from "./index";
import { json, sha256Hex } from "./http";
import { log } from "./log";

const SCOPE = "digest";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/youtube.readonly";
const GRANT_TYPES = ["authorization_code", "refresh_token"];

const base = (env: Env, request: Request): string => (env.PUBLIC_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
const seconds = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};
const after = (s: number): string => new Date(Date.now() + s * 1000).toISOString();

function setting(value: string | undefined, name: string): string {
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

const randomToken = (bytes = 32): string => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function html(status: number, title: string, body: string): Response {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
  return new Response(page, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const errorPage = (message: string): Response => html(400, "Error", `<h1>Error</h1><p>${escapeHtml(message)}</p>`);

function redirect(target: string, params: Record<string, string | undefined>): Response {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

// AES-GCM with a random IV: `v1:` + base64(IV || ciphertext) (spec lot 2, section 6.3).
async function encrypt(plain: string, keyBase64: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv);
  packed.set(cipher, iv.length);
  return `v1:${btoa(String.fromCharCode(...packed))}`;
}

// 10.1

export function discovery(env: Env, request: Request, path: string): Response | undefined {
  if (request.method !== "GET") return undefined;
  const BASE = base(env, request);
  if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
    return json({ resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] });
  }
  if (path === "/.well-known/oauth-authorization-server") {
    return json({
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    });
  }
  return undefined;
}

// 10.2

function validRedirectUri(uri: unknown): boolean {
  if (typeof uri !== "string" || uri.includes("#")) return false;
  try {
    const url = new URL(uri);
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
  } catch {
    return false;
  }
}

const oauthError = (status: number, error: string, description: string): Response => json({ error, error_description: description }, status);

export async function register(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_client_metadata", "The body is not JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return oauthError(400, "invalid_client_metadata", "The body is not an object");
  const meta = body as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must hold 1 to 10 valid URIs");
  }
  const { client_name, token_endpoint_auth_method, grant_types, response_types } = meta;
  const invalid =
    (client_name !== undefined && (typeof client_name !== "string" || client_name.length > 200)) ||
    (token_endpoint_auth_method !== undefined && token_endpoint_auth_method !== "none") ||
    (grant_types !== undefined && (!Array.isArray(grant_types) || !grant_types.every((g) => GRANT_TYPES.includes(g as string)))) ||
    (response_types !== undefined && (!Array.isArray(response_types) || !response_types.every((r) => r === "code")));
  if (invalid) return oauthError(400, "invalid_client_metadata", "Invalid client metadata");
  const client_id = randomToken(24);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
    .bind(client_id, client_name ?? null, JSON.stringify(uris), new Date(now).toISOString())
    .run();
  log("auth.client.registered", { attrs: { client_id } });
  return json(
    {
      client_id,
      client_id_issued_at: Math.floor(now / 1000),
      ...(client_name === undefined ? {} : { client_name }),
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: GRANT_TYPES,
      response_types: ["code"],
    },
    201,
  );
}

// 10.3

export async function authorize(request: Request, env: Env): Promise<Response> {
  const BASE = base(env, request);
  const q = new URL(request.url).searchParams;
  const client = await env.DB.prepare("SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?")
    .bind(q.get("client_id") ?? "")
    .first<{ client_name: string | null; redirect_uris: string }>();
  if (client === null) return errorPage("Unknown client.");
  const redirectUri = q.get("redirect_uri");
  if (redirectUri === null || !(JSON.parse(client.redirect_uris) as string[]).includes(redirectUri)) return errorPage("Unregistered redirect URI.");
  const state = q.get("state") ?? undefined;
  const fail = (error: string): Response => redirect(redirectUri, { error, state });
  const scope = q.get("scope") ?? SCOPE;
  if (q.get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = q.get("code_challenge");
  if (challenge === null || challenge === "" || q.get("code_challenge_method") !== "S256") return fail("invalid_request");
  if (q.get("resource") !== `${BASE}/mcp`) return fail("invalid_target");
  if (scope === "" || !scope.split(" ").every((s) => s === SCOPE)) return fail("invalid_scope");
  const requestId = randomToken();
  await env.DB.prepare(
    "INSERT INTO oauth_requests (request_id, client_id, redirect_uri, client_state, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(requestId, q.get("client_id"), redirectUri, state ?? null, challenge, SCOPE, `${BASE}/mcp`, after(seconds(env.AUTH_REQUEST_TTL_SECONDS, 600)))
    .run();
  const e = escapeHtml;
  return html(
    200,
    "Authorize access",
    `<h1>Authorize access</h1>` +
      `<p><strong>${e(client.client_name ?? q.get("client_id") ?? "")}</strong> asks to access your yt-digest account.</p>` +
      `<p>Redirect URI: <code>${e(redirectUri)}</code></p><p>Scope: <code>${e(SCOPE)}</code></p>` +
      `<form method="post" action="/authorize/consent"><input type="hidden" name="request" value="${e(requestId)}">` +
      `<button type="submit" name="decision" value="approve">Approve</button> <button type="submit" name="decision" value="deny">Deny</button></form>`,
  );
}

interface Pending {
  client_id: string;
  redirect_uri: string;
  client_state: string | null;
  code_challenge: string;
  scope: string;
  resource: string;
}

export async function consent(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorPage("Invalid request.");
  }
  const id = form.get("request");
  const decision = form.get("decision");
  if (typeof id !== "string" || (decision !== "approve" && decision !== "deny")) return errorPage("Invalid request.");
  const now = new Date().toISOString();
  const state = randomToken();
  const pending =
    decision === "deny"
      ? await env.DB.prepare("UPDATE oauth_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL AND expires_at > ? RETURNING *").bind(now, id, now).first<Pending>()
      : await env.DB.prepare(
          "UPDATE oauth_requests SET google_state = ?, google_nonce = ? WHERE request_id = ? AND used_at IS NULL AND google_state IS NULL AND expires_at > ? RETURNING *",
        )
          .bind(state, randomToken(), id, now)
          .first<Pending & { google_nonce: string }>();
  if (pending === null) return errorPage("This authorization request is unknown, expired or already used.");
  if (decision === "deny") {
    log("auth.oauth.denied", { attrs: { client_id: pending.client_id, reason: "access_denied" } });
    return redirect(pending.redirect_uri, { error: "access_denied", state: pending.client_state ?? undefined });
  }
  const nonce = (pending as Pending & { google_nonce: string }).google_nonce;
  const metadata = await fetchJson<{ authorization_endpoint: string }>(`${setting(env.GOOGLE_ISSUER, "GOOGLE_ISSUER")}/.well-known/openid-configuration`);
  return redirect(metadata.authorization_endpoint, {
    client_id: env.GOOGLE_CLIENT_ID ?? "yt-digest-local",
    redirect_uri: `${base(env, request)}/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    state,
    nonce,
    access_type: "offline",
    prompt: "consent",
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

// 10.4

interface IdClaims {
  sub: string;
  email: string;
  email_verified: unknown;
}

async function verifyIdToken(idToken: string, env: Env, jwksUri: string, nonce: string): Promise<IdClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed ID token");
  const [h, p, s] = parts as [string, string, string];
  const decode = (part: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(fromBase64url(part))) as Record<string, unknown>;
  const header = decode(h);
  if (header.alg !== "RS256") throw new Error("bad alg");
  const { keys } = await fetchJson<{ keys: (JsonWebKey & { kid?: string })[] }>(jwksUri);
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (jwk === undefined) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(s), new TextEncoder().encode(`${h}.${p}`)))) throw new Error("bad signature");
  const claims = decode(p);
  const aud = claims.aud;
  const clientId = env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
  if (claims.iss !== env.GOOGLE_ISSUER) throw new Error("bad iss");
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId)))) throw new Error("bad aud");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) throw new Error("expired");
  if (claims.nonce !== nonce) throw new Error("bad nonce");
  if (typeof claims.sub !== "string" || claims.sub === "" || typeof claims.email !== "string") throw new Error("missing claims");
  return { sub: claims.sub, email: claims.email, email_verified: claims.email_verified };
}

const refusal = (): Response =>
  html(403, "Access refused", `<h1>Access refused</h1><p>This account is not invited.</p>`);

export async function callback(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const now = new Date().toISOString();
  const pending = await env.DB.prepare("UPDATE oauth_requests SET used_at = ? WHERE google_state = ? AND used_at IS NULL AND expires_at > ? RETURNING *")
    .bind(now, q.get("state") ?? "", now)
    .first<Pending & { google_nonce: string }>();
  if (q.get("state") === null || pending === null) return errorPage("This sign-in is unknown, expired or already used.");
  const clientState = pending.client_state ?? undefined;
  const deny = (error: string, reason: string): Response => {
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: pending.client_id, reason } });
    return redirect(pending.redirect_uri, { error, state: clientState });
  };
  if (q.has("error")) return deny("access_denied", "google_error");

  let claims: IdClaims;
  let googleRefresh: string | undefined;
  try {
    const metadata = await fetchJson<{ token_endpoint: string; jwks_uri: string }>(`${setting(env.GOOGLE_ISSUER, "GOOGLE_ISSUER")}/.well-known/openid-configuration`);
    const tokens = await fetchJson<{ id_token?: string; refresh_token?: string }>(metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: q.get("code") ?? "",
        redirect_uri: `${base(env, request)}/callback`,
        client_id: env.GOOGLE_CLIENT_ID ?? "yt-digest-local",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "local-google-secret",
      }),
    });
    if (typeof tokens.id_token !== "string") throw new Error("no ID token");
    claims = await verifyIdToken(tokens.id_token, env, metadata.jwks_uri, pending.google_nonce);
    googleRefresh = tokens.refresh_token;
  } catch {
    return deny("server_error", "google_error");
  }

  const email = claims.email.toLowerCase();
  const isAdmin = email === (env.ADMIN_EMAIL ?? "alice@test").toLowerCase();
  const invite = isAdmin ? null : await env.DB.prepare("SELECT 1 AS ok FROM invites WHERE email = ? AND revoked = 0").bind(email).first();
  if (claims.email_verified !== true) {
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: pending.client_id, reason: "email_unverified" } });
    return refusal();
  }
  if (!isAdmin && invite === null) {
    log("auth.oauth.denied", { level: "warn", attrs: { client_id: pending.client_id, reason: "not_invited" } });
    return refusal();
  }
  const role = isAdmin ? "admin" : "member";
  const encrypted = googleRefresh === undefined ? null : await encrypt(googleRefresh, env.TOKEN_ENC_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  const code = randomToken();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (user_sub, email, role, google_refresh_token_enc, created_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_sub) DO UPDATE SET email = excluded.email, role = excluded.role, google_refresh_token_enc = COALESCE(excluded.google_refresh_token_enc, google_refresh_token_enc)",
    ).bind(claims.sub, email, role, encrypted, now),
    env.DB.prepare("UPDATE invites SET accepted_user_sub = ? WHERE email = ? AND revoked = 0").bind(claims.sub, email),
    env.DB.prepare(
      "INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(await sha256Hex(code), pending.client_id, claims.sub, pending.redirect_uri, pending.code_challenge, pending.scope, pending.resource, after(seconds(env.AUTH_CODE_TTL_SECONDS, 60))),
  ]);
  log("auth.oauth.completed", { attrs: { client_id: pending.client_id, role } });
  return redirect(pending.redirect_uri, { code, state: clientState });
}

export async function handleOauth(request: Request, env: Env, path: string): Promise<Response | undefined> {
  const found = discovery(env, request, path);
  if (found !== undefined) return found;
  const { method } = request;
  if (method === "POST" && path === "/register") return register(request, env);
  if (method === "GET" && path === "/authorize") return authorize(request, env);
  if (method === "POST" && path === "/authorize/consent") return consent(request, env);
  if (method === "GET" && path === "/callback") return callback(request, env);
  return undefined;
}
