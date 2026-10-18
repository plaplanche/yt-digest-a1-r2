import { sha256, sha256Hex } from "./http";
import { log } from "./log";
import { b64url, base, randomToken, ttlMs, type OAuthEnv } from "./oauth";

const SCOPE = "digest";

const NO_STORE = { "Cache-Control": "no-store" };

function tokenError(status: number, error: string, description?: string): Response {
  return new Response(JSON.stringify({ error, ...(description === undefined ? {} : { error_description: description }) }), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

interface Issue {
  clientId: string;
  userSub: string;
  familyId: string;
  scope: string;
  resource: string;
  grantType: "authorization_code" | "refresh_token";
}

async function issueTokens(env: OAuthEnv, issue: Issue): Promise<Response> {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const accessTtl = ttlMs(env.ACCESS_TOKEN_TTL_SECONDS, 3600);
  const now = Date.now();
  const statements = await Promise.all(
    [
      [access, "access", accessTtl],
      [refresh, "refresh", ttlMs(env.REFRESH_TOKEN_TTL_SECONDS, 2592000)],
    ].map(async ([token, kind, ttl]) =>
      env.DB.prepare(
        "INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(await sha256Hex(token as string), kind, issue.clientId, issue.userSub, issue.familyId, issue.scope, issue.resource, new Date(now + (ttl as number)).toISOString()),
    ),
  );
  await env.DB.batch(statements);
  log("auth.token.issued", { attrs: { client_id: issue.clientId, grant_type: issue.grantType } });
  return new Response(
    JSON.stringify({ access_token: access, token_type: "Bearer", expires_in: accessTtl / 1000, refresh_token: refresh, scope: SCOPE }),
    { status: 200, headers: { "Content-Type": "application/json", ...NO_STORE } },
  );
}

interface CodeRow {
  client_id: string;
  user_sub: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
  expires_at: string;
}

async function authorizationCode(form: URLSearchParams, env: OAuthEnv, clientId: string, resource: string): Promise<Response> {
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const verifier = form.get("code_verifier");
  if (!code || !redirectUri || !verifier || form.get("resource") === null) return tokenError(400, "invalid_request", "Missing parameter");
  if (form.get("resource") !== resource) return tokenError(400, "invalid_target", "Unknown resource");

  const nowIso = new Date().toISOString();
  const row = await env.DB.prepare(
    "UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL RETURNING client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at",
  )
    .bind(nowIso, await sha256Hex(code))
    .first<CodeRow>();
  const challenge = b64url(await sha256(verifier));
  if (row === null || row.expires_at <= nowIso || row.client_id !== clientId || row.redirect_uri !== redirectUri || row.code_challenge !== challenge || row.resource !== resource) {
    return tokenError(400, "invalid_grant", "Invalid authorization code");
  }
  return issueTokens(env, { clientId, userSub: row.user_sub, familyId: randomToken(24), scope: SCOPE, resource, grantType: "authorization_code" });
}

async function refresh(form: URLSearchParams, env: OAuthEnv, clientId: string, resource: string): Promise<Response> {
  const presented = form.get("refresh_token");
  if (!presented) return tokenError(400, "invalid_request", "Missing parameter");
  if (form.has("resource") && form.get("resource") !== resource) return tokenError(400, "invalid_target", "Unknown resource");

  const hash = await sha256Hex(presented);
  const nowIso = new Date().toISOString();
  const access = randomToken(32);
  const newRefresh = randomToken(32);
  const accessTtl = ttlMs(env.ACCESS_TOKEN_TTL_SECONDS, 3600);
  const refreshTtl = ttlMs(env.REFRESH_TOKEN_TTL_SECONDS, 2592000);
  // One atomic batch: both inserts copy the presented row and only fire while it is usable and its family
  // has no revoked token; the mark-used update comes last, so a concurrent reuse cannot slip in between.
  const insert = async (token: string, kind: string, ttl: number) =>
    env.DB.prepare(
      `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at)
       SELECT ?, ?, client_id, user_sub, family_id, scope, resource, ? FROM oauth_tokens
       WHERE token_hash = ? AND kind = 'refresh' AND client_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
         AND NOT EXISTS (SELECT 1 FROM oauth_tokens f WHERE f.family_id = oauth_tokens.family_id AND f.revoked_at IS NOT NULL)`,
    ).bind(await sha256Hex(token), kind, new Date(Date.now() + ttl).toISOString(), hash, clientId, nowIso);
  const results = await env.DB.batch([
    await insert(access, "access", accessTtl),
    await insert(newRefresh, "refresh", refreshTtl),
    env.DB.prepare("UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ? AND kind = 'refresh' AND client_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM oauth_tokens f WHERE f.family_id = oauth_tokens.family_id AND f.revoked_at IS NOT NULL)").bind(nowIso, hash, clientId, nowIso),
  ]);
  if (results[0].meta.changes === 1 && results[1].meta.changes === 1 && results[2].meta.changes === 1) {
    log("auth.token.issued", { attrs: { client_id: clientId, grant_type: "refresh_token" } });
    return new Response(
      JSON.stringify({ access_token: access, token_type: "Bearer", expires_in: accessTtl / 1000, refresh_token: newRefresh, scope: SCOPE }),
      { status: 200, headers: { "Content-Type": "application/json", ...NO_STORE } },
    );
  }
  const known = await env.DB.prepare("SELECT family_id, used_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh' AND client_id = ?")
    .bind(hash, clientId)
    .first<{ family_id: string; used_at: string | null }>();
  if (known?.used_at) {
    const revoked = await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL")
      .bind(nowIso, known.family_id)
      .run();
    if (revoked.meta.changes > 0) log("auth.refresh.reuse_detected", { level: "warn", attrs: { client_id: clientId, revoked: revoked.meta.changes } });
  }
  return tokenError(400, "invalid_grant", "Invalid refresh token");
}

// 10.5
export async function token(request: Request, env: OAuthEnv): Promise<Response> {
  if ((request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return tokenError(400, "invalid_request", "The body must be form-encoded");
  }
  const form = new URLSearchParams();
  try {
    for (const [key, value] of await request.formData()) if (typeof value === "string") form.append(key, value);
  } catch {
    return tokenError(400, "invalid_request", "The body must be form-encoded");
  }
  const grantType = form.get("grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") return tokenError(400, "unsupported_grant_type");
  const clientId = form.get("client_id");
  const client = clientId ? await env.DB.prepare("SELECT 1 AS found FROM oauth_clients WHERE client_id = ?").bind(clientId).first() : null;
  if (!clientId || client === null) return tokenError(401, "invalid_client");
  const resource = `${base(env, request)}/mcp`;
  return grantType === "authorization_code" ? authorizationCode(form, env, clientId, resource) : refresh(form, env, clientId, resource);
}

export interface AccessGrant {
  userSub: string;
  clientId: string;
  scope: string;
}

// 10.6: the user is read again on every call, so a revoked invite refuses the tokens at once.
export async function verifyAccessToken(request: Request, env: OAuthEnv): Promise<AccessGrant | null> {
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (bearer === undefined) return null;
  const row = await env.DB.prepare(
    `SELECT t.user_sub, t.client_id, t.scope FROM oauth_tokens t JOIN users u ON u.user_sub = t.user_sub
     WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > ? AND t.resource = ?
       AND (u.email = ? OR EXISTS (SELECT 1 FROM invites i WHERE i.email = u.email AND i.revoked = 0))`,
  )
    .bind(await sha256Hex(bearer), new Date().toISOString(), `${base(env, request)}/mcp`, (env.ADMIN_EMAIL ?? "").toLowerCase())
    .first<{ user_sub: string; client_id: string; scope: string }>();
  return row === null ? null : { userSub: row.user_sub, clientId: row.client_id, scope: row.scope };
}
