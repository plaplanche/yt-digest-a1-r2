import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { sha256Hex } from "../../src/http";
import worker from "../../src/index";
import { verifyAccessToken } from "../../src/token";

const OPS = "ops-test-token";
const BASE = "http://worker.test";
const REDIRECT = "http://127.0.0.1:9/cb";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const bindings = { DB: env.DB, TRANSCRIPTS: env.TRANSCRIPTS, OPS_TOKEN: OPS, PUBLIC_URL: BASE, ADMIN_EMAIL: "alice@test" };

const call = (path: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(`${BASE}${path}`, init), bindings);
const ops = (path: string, body?: unknown) =>
  call(path, { method: "POST", headers: { Authorization: `Bearer ${OPS}` }, body: body === undefined ? undefined : JSON.stringify(body) });
const token = (fields: Record<string, string | undefined>, headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" }) =>
  call("/token", {
    method: "POST",
    headers,
    body: new URLSearchParams(Object.entries(fields).filter((e): e is [string, string] => e[1] !== undefined)),
  });

interface Pair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

let clientId: string;
let n = 0;

async function seedCode(over: Record<string, string> = {}, email = "alice@test"): Promise<string> {
  const code = `code-${++n}-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT OR IGNORE INTO users (user_sub, email, role, created_at) VALUES (?, ?, 'member', ?)")
    .bind(`sub-${email}`, email, new Date().toISOString())
    .run();
  const row = {
    client_id: clientId,
    user_sub: `sub-${email}`,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    scope: "digest",
    resource: `${BASE}/mcp`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  };
  await env.DB.prepare(
    "INSERT INTO oauth_codes (code_hash, client_id, user_sub, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(await sha256Hex(code), row.client_id, row.user_sub, row.redirect_uri, row.code_challenge, row.scope, row.resource, row.expires_at)
    .run();
  return code;
}

const exchangeFields = (code: string, extra: Record<string, string | undefined> = {}) => ({
  grant_type: "authorization_code",
  code,
  redirect_uri: REDIRECT,
  client_id: clientId,
  code_verifier: VERIFIER,
  resource: `${BASE}/mcp`,
  ...extra,
});

async function exchange(email = "alice@test"): Promise<Pair> {
  const res = await token(exchangeFields(await seedCode({}, email)));
  expect(res.status).toBe(200);
  return (await res.json()) as Pair;
}

const refreshWith = (refresh: string, extra: Record<string, string | undefined> = {}) =>
  token({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, ...extra });

const bearer = (value: string | undefined) =>
  new Request(`${BASE}/mcp`, { headers: value === undefined ? {} : { Authorization: `Bearer ${value}` } });
const accepted = async (value: string): Promise<boolean> => (await verifyAccessToken(bearer(value), bindings)) !== null;

async function expectError(res: Response, status: number, error: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/json");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(((await res.json()) as { error: string }).error).toBe(error);
}

beforeEach(async () => {
  expect((await ops("/ops/reset")).status).toBe(200);
  clientId = "client-1";
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, 'c', ?, ?)")
    .bind(clientId, JSON.stringify([REDIRECT]), new Date().toISOString())
    .run();
});

describe("POST /token, authorization_code (10.5)", () => {
  test("exchanges a code for a pair of tokens bound to the resource", async () => {
    const res = await token(exchangeFields(await seedCode()));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = (await res.json()) as Pair;
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "digest" });
    expect(body.access_token.length).toBeGreaterThanOrEqual(32);
    expect(body.refresh_token.length).toBeGreaterThanOrEqual(32);
    expect(body.access_token).not.toBe(body.refresh_token);
    const { results } = await env.DB.prepare("SELECT kind, resource, client_id, family_id, token_hash FROM oauth_tokens ORDER BY kind").all<Record<string, string>>();
    expect(results.map((r) => r.kind)).toEqual(["access", "refresh"]);
    expect(results[0]?.token_hash).toBe(await sha256Hex(body.access_token));
    expect(results[1]?.token_hash).toBe(await sha256Hex(body.refresh_token));
    expect(results[0]?.family_id).toBe(results[1]?.family_id);
    expect(results.every((r) => r.resource === `${BASE}/mcp` && r.client_id === clientId)).toBe(true);
    expect(await accepted(body.access_token)).toBe(true);
  });

  test("logs auth.token.issued without the tokens", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    let pair: Pair;
    try {
      pair = await exchange();
    } finally {
      spy.mockRestore();
    }
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ event: "auth.token.issued", service: "worker", attrs: { client_id: clientId, grant_type: "authorization_code" } });
    expect(lines[0]).not.toContain(pair.access_token);
    expect(lines[0]).not.toContain(pair.refresh_token);
  });

  test("a body that is not form-encoded gives invalid_request", async () => {
    const fields = exchangeFields(await seedCode());
    await expectError(await token(fields, { "Content-Type": "application/json" }), 400, "invalid_request");
    await expectError(await token(fields, { "Content-Type": "application/x-www-form-urlencodedx" }), 400, "invalid_request");
    const json = await call("/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
    await expectError(json, 400, "invalid_request");
    await expectError(await call("/token", { method: "POST", body: "grant_type=refresh_token" }), 400, "invalid_request");
  });

  test("unknown grant and unknown client, in that order", async () => {
    await expectError(await token({ grant_type: "password", client_id: "nobody" }), 400, "unsupported_grant_type");
    await expectError(await token({ client_id: clientId }), 400, "unsupported_grant_type");
    await expectError(await token({ grant_type: "authorization_code", client_id: "nobody" }), 401, "invalid_client");
    await expectError(await token({ grant_type: "refresh_token" }), 401, "invalid_client");
  });

  test("a missing parameter gives invalid_request, before the resource and the code", async () => {
    for (const name of ["code", "redirect_uri", "code_verifier", "resource"]) {
      const code = await seedCode();
      await expectError(await token(exchangeFields(code, { [name]: undefined, ...(name === "resource" ? {} : { resource: "http://elsewhere" }) })), 400, "invalid_request");
      // Not reaching the code check, the code is still usable.
      expect((await token(exchangeFields(code))).status).toBe(200);
    }
  });

  test("a wrong resource gives invalid_target and keeps the code", async () => {
    const code = await seedCode();
    await expectError(await token(exchangeFields(code, { resource: `${BASE}/other` })), 400, "invalid_target");
    expect((await token(exchangeFields(code))).status).toBe(200);
  });

  test("invalid_grant: unknown, wrong verifier, other client, other redirect_uri, expired", async () => {
    await expectError(await token(exchangeFields("unknown")), 400, "invalid_grant");
    await expectError(await token(exchangeFields(await seedCode(), { code_verifier: "x".repeat(43) })), 400, "invalid_grant");
    await expectError(await token(exchangeFields(await seedCode(), { redirect_uri: `${REDIRECT}2` })), 400, "invalid_grant");
    await env.DB.prepare("INSERT INTO oauth_clients (client_id, redirect_uris, created_at) VALUES ('client-2', '[]', ?)").bind(new Date().toISOString()).run();
    await expectError(await token(exchangeFields(await seedCode(), { client_id: "client-2" })), 400, "invalid_grant");
    const expired = await seedCode({ expires_at: new Date(Date.now() - 1000).toISOString() });
    await expectError(await token(exchangeFields(expired)), 400, "invalid_grant");
  });

  test("a code is single-use and a failed exchange uses it up", async () => {
    const code = await seedCode();
    expect((await token(exchangeFields(code))).status).toBe(200);
    await expectError(await token(exchangeFields(code)), 400, "invalid_grant");

    const failed = await seedCode();
    await expectError(await token(exchangeFields(failed, { code_verifier: "y".repeat(43) })), 400, "invalid_grant");
    await expectError(await token(exchangeFields(failed)), 400, "invalid_grant");
  });
});

describe("POST /token, refresh_token (10.5)", () => {
  test("rotates both tokens and keeps earlier access tokens valid", async () => {
    const first = await exchange();
    const res = await refreshWith(first.refresh_token, { resource: `${BASE}/mcp` });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const second = (await res.json()) as Pair;
    expect(second).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "digest" });
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await accepted(first.access_token)).toBe(true);
    expect(await accepted(second.access_token)).toBe(true);
    const families = await env.DB.prepare("SELECT DISTINCT family_id FROM oauth_tokens").all();
    expect(families.results).toHaveLength(1);
    expect((await refreshWith(second.refresh_token)).status).toBe(200);
  });

  test("invalid_target for another resource, invalid_request without a token", async () => {
    const pair = await exchange();
    await expectError(await refreshWith(pair.refresh_token, { resource: `${BASE}/other` }), 400, "invalid_target");
    await expectError(await token({ grant_type: "refresh_token", client_id: clientId }), 400, "invalid_request");
    expect((await refreshWith(pair.refresh_token)).status).toBe(200);
  });

  test("reuse of a used refresh token revokes the family, access tokens included, and logs it", async () => {
    const first = await exchange();
    const second = (await (await refreshWith(first.refresh_token)).json()) as Pair;
    await ops("/ops/invites", { email: "bob@test" });
    const other = await exchange("bob@test");
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      await expectError(await refreshWith(first.refresh_token), 400, "invalid_grant");
    } finally {
      spy.mockRestore();
    }
    const events = lines.map((l) => JSON.parse(l) as { event: string; attrs: Record<string, unknown> });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "auth.refresh.reuse_detected", attrs: { client_id: clientId, revoked: 4 } });
    expect(await accepted(first.access_token)).toBe(false);
    expect(await accepted(second.access_token)).toBe(false);
    await expectError(await refreshWith(second.refresh_token), 400, "invalid_grant");
    expect(await accepted(other.access_token)).toBe(true);
    expect((await refreshWith(other.refresh_token)).status).toBe(200);
  });

  test("a family holding a revoked token issues nothing and leaves the refresh token unused", async () => {
    const pair = await exchange();
    await env.DB.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE kind = 'access'").bind(new Date().toISOString()).run();
    await expectError(await refreshWith(pair.refresh_token), 400, "invalid_grant");
    const rows = await env.DB.prepare("SELECT kind, used_at FROM oauth_tokens").all<{ kind: string; used_at: string | null }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.every((r) => r.used_at === null)).toBe(true);
  });

  test("presenting a used token again after its family was revoked logs nothing", async () => {
    const first = await exchange();
    await refreshWith(first.refresh_token);
    await expectError(await refreshWith(first.refresh_token), 400, "invalid_grant");
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      await expectError(await refreshWith(first.refresh_token), 400, "invalid_grant");
    } finally {
      spy.mockRestore();
    }
    expect(lines).toHaveLength(0);
  });

  test("unknown, expired, revoked and other-client refresh tokens give invalid_grant without revoking", async () => {
    await expectError(await refreshWith("unknown"), 400, "invalid_grant");
    const pair = await exchange();
    await env.DB.prepare("INSERT INTO oauth_clients (client_id, redirect_uris, created_at) VALUES ('client-2', '[]', ?)").bind(new Date().toISOString()).run();
    await expectError(await token({ grant_type: "refresh_token", refresh_token: pair.refresh_token, client_id: "client-2" }), 400, "invalid_grant");
    expect(await accepted(pair.access_token)).toBe(true);

    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = ? WHERE kind = 'refresh'").bind(new Date(Date.now() - 1000).toISOString()).run();
    await expectError(await refreshWith(pair.refresh_token), 400, "invalid_grant");
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = ?, revoked_at = ? WHERE kind = 'refresh'")
      .bind(new Date(Date.now() + 60_000).toISOString(), new Date().toISOString())
      .run();
    await expectError(await refreshWith(pair.refresh_token), 400, "invalid_grant");
    expect(await accepted(pair.access_token)).toBe(true);
  });

  test("an access token is not a refresh token", async () => {
    const pair = await exchange();
    await expectError(await refreshWith(pair.access_token), 400, "invalid_grant");
  });
});

describe("accepting an access token (10.6)", () => {
  test("accepts a valid one and names its user and client", async () => {
    const pair = await exchange();
    expect(await verifyAccessToken(bearer(pair.access_token), bindings)).toEqual({ userSub: "sub-alice@test", clientId, scope: "digest" });
  });

  test("refuses a missing, unknown, refresh, node, expired, revoked or wrong-resource bearer", async () => {
    const pair = await exchange();
    expect(await verifyAccessToken(bearer(undefined), bindings)).toBeNull();
    expect(await accepted("unknown")).toBe(false);
    expect(await accepted(pair.refresh_token)).toBe(false);
    const node = (await (await ops("/ops/nodes", { node_id: "n1", owner_label: "o" })).json()) as { token: string };
    expect(await accepted(node.token)).toBe(false);
    expect(await accepted(OPS)).toBe(false);

    await env.DB.prepare("UPDATE oauth_tokens SET resource = 'http://other/mcp' WHERE kind = 'access'").run();
    expect(await accepted(pair.access_token)).toBe(false);
    await env.DB.prepare("UPDATE oauth_tokens SET resource = ?, expires_at = ? WHERE kind = 'access'")
      .bind(`${BASE}/mcp`, new Date(Date.now() - 1000).toISOString())
      .run();
    expect(await accepted(pair.access_token)).toBe(false);
    await env.DB.prepare("UPDATE oauth_tokens SET expires_at = ?, revoked_at = ? WHERE kind = 'access'")
      .bind(new Date(Date.now() + 60_000).toISOString(), new Date().toISOString())
      .run();
    expect(await accepted(pair.access_token)).toBe(false);
  });

  test("refuses the token of a user whose invite was revoked, at once", async () => {
    expect((await ops("/ops/invites", { email: "bob@test" })).status).toBe(200);
    const pair = await exchange("bob@test");
    expect(await accepted(pair.access_token)).toBe(true);
    expect((await ops("/ops/invites/revoke", { email: "bob@test" })).status).toBe(200);
    expect(await accepted(pair.access_token)).toBe(false);
    expect((await ops("/ops/invites", { email: "bob@test" })).status).toBe(200);
    expect(await accepted(pair.access_token)).toBe(true);
  });

  test("refuses a member without an invite", async () => {
    const pair = await exchange("carol@test");
    expect(await accepted(pair.access_token)).toBe(false);
  });
});
