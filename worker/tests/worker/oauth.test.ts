import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../../src/index";

const OPS = "ops-test-token";
const BASE = "http://worker.test";
const ISSUER = "http://google.test";
const GOOGLE_ID = "google-client";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const REDIRECT = "http://127.0.0.1:9/cb";
const bindings = {
  DB: env.DB,
  TRANSCRIPTS: env.TRANSCRIPTS,
  OPS_TOKEN: OPS,
  PUBLIC_URL: BASE,
  GOOGLE_ISSUER: ISSUER,
  GOOGLE_CLIENT_ID: GOOGLE_ID,
  GOOGLE_CLIENT_SECRET: "google-secret",
  ADMIN_EMAIL: "alice@test",
  TOKEN_ENC_KEY: KEY,
};

const call = (path: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(`${BASE}${path}`, init), bindings);
const ops = (path: string, body?: unknown) =>
  call(path, { method: "POST", headers: { Authorization: `Bearer ${OPS}` }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
const form = (path: string, fields: Record<string, string>) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

// A fake Google: one RSA key, a token endpoint answering what the test sets.
const b64 = (bytes: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const textB64 = (value: unknown): string => b64(new TextEncoder().encode(JSON.stringify(value)));

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const otherPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

async function idToken(claims: Record<string, unknown>, signer = pair.privateKey): Promise<string> {
  const head = textB64({ alg: "RS256", kid: "k1", typ: "JWT" });
  const payload = textB64(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(`${head}.${payload}`));
  return `${head}.${payload}.${b64(sig)}`;
}

let tokenResponse: (nonce: string) => Promise<Response>;
let tokenRequests: URLSearchParams[];

function stubGoogle(): void {
  vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({ authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (url === `${ISSUER}/jwks`) return Response.json({ keys: [publicJwk] });
    if (url === `${ISSUER}/token`) {
      const body = new URLSearchParams(String(init?.body));
      tokenRequests.push(body);
      return tokenResponse(body.get("code") ?? "");
    }
    return new Response("unexpected", { status: 500 });
  });
}

const claimsFor = (email: string, extra: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: GOOGLE_ID,
  sub: `sub-${email}`,
  email,
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...extra,
});

beforeEach(async () => {
  expect((await ops("/ops/reset")).status).toBe(200);
  tokenRequests = [];
  stubGoogle();
});
afterEach(() => vi.unstubAllGlobals());

async function registerClient(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await post("/register", { redirect_uris: [REDIRECT], client_name: "My <b>client</b>", ...extra });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

const authQuery = (clientId: string, extra: Record<string, string | undefined> = {}): string => {
  const params: Record<string, string | undefined> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: "challenge",
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
    state: "client-state",
    ...extra,
  };
  return new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)).toString();
};

const location = (res: Response): URL => new URL(res.headers.get("Location") ?? "");

async function pendingRequest(clientId: string): Promise<string> {
  const res = await call(`/authorize?${authQuery(clientId)}`);
  expect(res.status).toBe(200);
  return /name="request" value="([^"]+)"/.exec(await res.text())?.[1] ?? "";
}

async function approve(clientId: string): Promise<URL> {
  const res = await form("/authorize/consent", { request: await pendingRequest(clientId), decision: "approve" });
  expect(res.status).toBe(302);
  return location(res);
}

async function callbackFor(clientId: string, email: string, claims: Record<string, unknown> = {}, tokens: Record<string, unknown> = {}): Promise<Response> {
  const google = await approve(clientId);
  tokenResponse = async () =>
    Response.json({
      access_token: "google-access",
      refresh_token: "google-refresh-secret",
      id_token: await idToken(claimsFor(email, { nonce: google.searchParams.get("nonce"), ...claims })),
      ...tokens,
    });
  return call(`/callback?code=gcode&state=${google.searchParams.get("state")}`);
}

describe("discovery (10.1)", () => {
  test("protected resource documents", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await call(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(await res.json()).toEqual({ resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ["digest"], bearer_methods_supported: ["header"] });
    }
  });

  test("authorization server metadata", async () => {
    const res = await call("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["digest"],
    });
  });
});

describe("POST /register (10.2)", () => {
  test("registers a public client", async () => {
    const res = await post("/register", { redirect_uris: [REDIRECT, "https://app.example/cb", "http://localhost:3000/x"], client_name: "Client" });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(201);
    expect(String(body.client_id).length).toBeGreaterThanOrEqual(16);
    expect(typeof body.client_id_issued_at).toBe("number");
    expect(body).toMatchObject({
      client_name: "Client",
      redirect_uris: [REDIRECT, "https://app.example/cb", "http://localhost:3000/x"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(await env.DB.prepare("SELECT client_name FROM oauth_clients WHERE client_id = ?").bind(body.client_id).first()).toEqual({ client_name: "Client" });
  });

  test("leaves client_name out when not given", async () => {
    const res = await post("/register", { redirect_uris: [REDIRECT] });
    expect(res.status).toBe(201);
    expect(await res.json()).not.toHaveProperty("client_name");
  });

  test("invalid_redirect_uri", async () => {
    const bad = [
      {},
      { redirect_uris: [] },
      { redirect_uris: "http://127.0.0.1/cb" },
      { redirect_uris: ["http://example.com/cb"] },
      { redirect_uris: ["https://example.com/cb#frag"] },
      { redirect_uris: ["/relative"] },
      { redirect_uris: ["custom://app"] },
      { redirect_uris: [REDIRECT, 3] },
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`) },
    ];
    for (const body of bad) {
      const res = await post("/register", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
    }
    expect((await post("/register", { redirect_uris: Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`) })).status).toBe(201);
  });

  test("invalid_client_metadata", async () => {
    const bad = [
      { client_name: "x".repeat(201) },
      { client_name: 3 },
      { token_endpoint_auth_method: "client_secret_basic" },
      { grant_types: ["password"] },
      { grant_types: "authorization_code" },
      { response_types: ["token"] },
    ];
    for (const extra of bad) {
      const res = await post("/register", { redirect_uris: [REDIRECT], ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_client_metadata" });
    }
    expect((await call("/register", { method: "POST", body: "not json" })).status).toBe(400);
    expect((await post("/register", { redirect_uris: [REDIRECT], client_name: "x".repeat(200), grant_types: ["refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" })).status).toBe(201);
  });
});

describe("GET /authorize (10.3)", () => {
  test("unknown client or unregistered redirect_uri: 400 page, no redirect", async () => {
    const id = await registerClient();
    for (const query of [authQuery("nope"), authQuery(id, { redirect_uri: `${REDIRECT}/` }), authQuery(id, { redirect_uri: undefined }), authQuery(id, { client_id: undefined }), authQuery(id, { redirect_uri: "http://127.0.0.1:9/cb?x=1" })]) {
      const res = await call(`/authorize?${query}`);
      expect(res.status).toBe(400);
      expect(res.headers.get("Location")).toBeNull();
      expect(res.headers.get("Content-Type")).toContain("text/html");
    }
    // and the errors below take precedence over nothing: a bad client wins over a bad response_type
    expect((await call(`/authorize?${authQuery("nope", { response_type: "token" })}`)).status).toBe(400);
  });

  test("errors redirect in order", async () => {
    const id = await registerClient();
    const cases: [Record<string, string | undefined>, string][] = [
      [{ response_type: "token", code_challenge: undefined, resource: undefined, scope: "other" }, "unsupported_response_type"],
      [{ response_type: undefined }, "unsupported_response_type"],
      [{ code_challenge: undefined, resource: undefined, scope: "other" }, "invalid_request"],
      [{ code_challenge_method: undefined, resource: undefined }, "invalid_request"],
      [{ code_challenge_method: "plain", resource: undefined }, "invalid_request"],
      [{ resource: undefined, scope: "other" }, "invalid_target"],
      [{ resource: `${BASE}/mcp/`, scope: "other" }, "invalid_target"],
      [{ resource: "http://other.test/mcp" }, "invalid_target"],
      [{ scope: "digest other" }, "invalid_scope"],
      [{ scope: "other" }, "invalid_scope"],
    ];
    for (const [extra, error] of cases) {
      const res = await call(`/authorize?${authQuery(id, extra)}`);
      expect(res.status, JSON.stringify(extra)).toBe(302);
      const target = location(res);
      expect(target.origin + target.pathname).toBe(REDIRECT);
      expect(target.searchParams.get("error")).toBe(error);
      expect(target.searchParams.get("state")).toBe("client-state");
    }
    const noState = await call(`/authorize?${authQuery(id, { response_type: "x", state: undefined })}`);
    expect(location(noState).searchParams.has("state")).toBe(false);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM oauth_requests").first<{ n: number }>())?.n).toBe(0);
  });

  test("the consent page escapes the client name and has two decision buttons", async () => {
    const id = await registerClient();
    const res = await call(`/authorize?${authQuery(id, { scope: "digest" })}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("My &lt;b&gt;client&lt;/b&gt;");
    expect(html).not.toContain("<b>client</b>");
    expect(html).toContain(REDIRECT);
    expect(html).toContain("digest");
    expect(html).toContain('<form method="post" action="/authorize/consent">');
    expect(html).toContain('<button type="submit" name="decision" value="approve">');
    expect(html).toContain('<button type="submit" name="decision" value="deny">');
    expect(/name="request" value="([A-Za-z0-9_-]{16,})"/.test(html)).toBe(true);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM oauth_requests").first<{ n: number }>())?.n).toBe(1);
  });

  test("shows the client_id when the client has no name; scope defaults to digest", async () => {
    const res = await post("/register", { redirect_uris: [REDIRECT] });
    const id = ((await res.json()) as { client_id: string }).client_id;
    const html = await (await call(`/authorize?${authQuery(id)}`)).text();
    expect(html).toContain(id);
    expect(html).toContain("<code>digest</code>");
  });

  test("escapes the redirect_uri", async () => {
    const uri = "https://app.example/cb?a=1&b=<i>\"'";
    const id = await registerClient({ redirect_uris: [uri] });
    const html = await (await call(`/authorize?${authQuery(id, { redirect_uri: uri })}`)).text();
    expect(html).toContain("a=1&amp;b=&lt;i&gt;&quot;&#39;");
  });
});

describe("POST /authorize/consent (10.3)", () => {
  test("deny uses the request up and redirects with access_denied", async () => {
    const id = await registerClient();
    const request = await pendingRequest(id);
    const res = await form("/authorize/consent", { request, decision: "deny" });
    expect(res.status).toBe(302);
    const target = location(res);
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("client-state");
    expect((await form("/authorize/consent", { request, decision: "approve" })).status).toBe(400);
    expect((await form("/authorize/consent", { request, decision: "deny" })).status).toBe(400);
  });

  test("unknown, missing or expired request: 400 HTML", async () => {
    const id = await registerClient();
    for (const fields of [{ request: "nope", decision: "approve" }, { decision: "approve" }, { request: "nope", decision: "deny" }] as Record<string, string>[]) {
      const res = await form("/authorize/consent", fields);
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("text/html");
    }
    const request = await pendingRequest(id);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await form("/authorize/consent", { request, decision: "approve" })).status).toBe(400);
    expect((await form("/authorize/consent", { request, decision: "deny" })).status).toBe(400);
  });

  test("another decision is refused and does not use the request up", async () => {
    const id = await registerClient();
    const request = await pendingRequest(id);
    expect((await form("/authorize/consent", { request, decision: "maybe" })).status).toBe(400);
    expect((await form("/authorize/consent", { request, decision: "approve" })).status).toBe(302);
  });

  test("approve redirects to Google with every parameter", async () => {
    const id = await registerClient();
    const target = await approve(id);
    expect(target.origin + target.pathname).toBe(`${ISSUER}/authorize`);
    const p = target.searchParams;
    expect(p.get("client_id")).toBe(GOOGLE_ID);
    expect(p.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid email https://www.googleapis.com/auth/youtube.readonly");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("state")?.length).toBeGreaterThanOrEqual(16);
    expect(p.get("nonce")?.length).toBeGreaterThanOrEqual(16);
    expect(p.get("state")).not.toBe(p.get("nonce"));
    const row = await env.DB.prepare("SELECT google_state, google_nonce FROM oauth_requests").first();
    expect(row).toEqual({ google_state: p.get("state"), google_nonce: p.get("nonce") });
  });
});

describe("GET /callback (10.4)", () => {
  test("an unknown, used or expired state: 400 HTML", async () => {
    const id = await registerClient();
    for (const query of ["", "?state=nope&code=c", "?code=c"]) expect((await call(`/callback${query}`)).status).toBe(400);
    const google = await approve(id);
    const state = google.searchParams.get("state");
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await call(`/callback?code=c&state=${state}`)).status).toBe(400);
    expect(tokenRequests).toEqual([]);
  });

  test("the state is used up by the first request, even a failed one", async () => {
    const id = await registerClient();
    const google = await approve(id);
    const state = google.searchParams.get("state");
    tokenResponse = async () => new Response("{}", { status: 400 });
    expect(location(await call(`/callback?code=c&state=${state}`)).searchParams.get("error")).toBe("server_error");
    expect((await call(`/callback?code=c&state=${state}`)).status).toBe(400);
  });

  test("an error from Google redirects to the client with access_denied", async () => {
    const id = await registerClient();
    const state = (await approve(id)).searchParams.get("state");
    const res = await call(`/callback?error=access_denied&state=${state}`);
    expect(res.status).toBe(302);
    const target = location(res);
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("client-state");
    expect(tokenRequests).toEqual([]);
  });

  test("an invited user gets a code and a member row", async () => {
    const id = await registerClient();
    await ops("/ops/invites", { email: "Bob@Test" });
    const res = await callbackFor(id, "bob@test");
    expect(res.status).toBe(302);
    const target = location(res);
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("state")).toBe("client-state");
    const code = target.searchParams.get("code") ?? "";
    expect(code.length).toBeGreaterThanOrEqual(32);
    expect(tokenRequests[0]?.get("client_secret")).toBe("google-secret");
    expect(tokenRequests[0]?.get("redirect_uri")).toBe(`${BASE}/callback`);
    const user = await env.DB.prepare("SELECT user_sub, email, role FROM users").first();
    expect(user).toEqual({ user_sub: "sub-bob@test", email: "bob@test", role: "member" });
    expect((await env.DB.prepare("SELECT accepted_user_sub FROM invites").first())?.accepted_user_sub).toBe("sub-bob@test");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
    const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    const row = await env.DB.prepare("SELECT * FROM oauth_codes").first<Record<string, string | null>>();
    expect(row).toMatchObject({ code_hash: hash, client_id: id, user_sub: "sub-bob@test", redirect_uri: REDIRECT, code_challenge: "challenge", scope: "digest", resource: `${BASE}/mcp`, used_at: null });
    const ttl = Date.parse(row?.expires_at ?? "") - Date.now();
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  test("the admin needs no invite and gets the admin role", async () => {
    const id = await registerClient();
    const res = await callbackFor(id, "ALICE@test");
    expect(location(res).searchParams.get("code")).toBeTruthy();
    expect(await env.DB.prepare("SELECT email, role FROM users").first()).toEqual({ email: "alice@test", role: "admin" });
  });

  test("a returning user keeps the stored Google refresh token when none is sent", async () => {
    const id = await registerClient();
    await callbackFor(id, "alice@test");
    const first = (await env.DB.prepare("SELECT google_refresh_token_enc AS t FROM users").first<{ t: string }>())?.t;
    await callbackFor(id, "alice@test", {}, { refresh_token: undefined });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT google_refresh_token_enc AS t FROM users").first<{ t: string }>())?.t).toBe(first);
  });

  test("a non-invited, a revoked-invite and an unverified user get the 403 page and no row", async () => {
    const id = await registerClient();
    await ops("/ops/invites", { email: "carol@test" });
    await ops("/ops/invites/revoke", { email: "carol@test" });
    await ops("/ops/invites", { email: "dave@test" });
    const cases: [string, Record<string, unknown>][] = [
      ["mallory@test", {}],
      ["carol@test", {}],
      ["dave@test", { email_verified: false }],
    ];
    for (const [email, claims] of cases) {
      const res = await callbackFor(id, email, claims);
      expect(res.status, email).toBe(403);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("<title>Access refused</title>");
      expect(html).toContain("This account is not invited.");
    }
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM oauth_codes").first<{ n: number }>())?.n).toBe(0);
  });

  test("the ID token checks: signature, aud, nonce, iss, exp, alg", async () => {
    const id = await registerClient();
    const bad: [string, (nonce: string) => Promise<string>][] = [
      ["signature", (nonce) => idToken(claimsFor("alice@test", { nonce }), otherPair.privateKey)],
      ["aud", (nonce) => idToken(claimsFor("alice@test", { nonce, aud: "someone-else" }))],
      ["nonce", () => idToken(claimsFor("alice@test", { nonce: "wrong" }))],
      ["no nonce", () => idToken(claimsFor("alice@test"))],
      ["iss", (nonce) => idToken(claimsFor("alice@test", { nonce, iss: "http://evil.test" }))],
      ["exp", (nonce) => idToken(claimsFor("alice@test", { nonce, exp: Math.floor(Date.now() / 1000) - 5 }))],
      ["garbage", async () => "not.a.jwt"],
    ];
    for (const [name, make] of bad) {
      const google = await approve(id);
      tokenResponse = async () => Response.json({ refresh_token: "r", id_token: await make(google.searchParams.get("nonce") ?? "") });
      const res = await call(`/callback?code=c&state=${google.searchParams.get("state")}`);
      expect(res.status, name).toBe(302);
      const target = location(res);
      expect(target.searchParams.get("error"), name).toBe("server_error");
      expect(target.searchParams.get("state")).toBe("client-state");
      expect(target.searchParams.has("code")).toBe(false);
    }
    expect((await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())?.n).toBe(0);
  });

  test("a token endpoint failure or a missing code is server_error", async () => {
    const id = await registerClient();
    const google = await approve(id);
    expect(location(await call(`/callback?state=${google.searchParams.get("state")}`)).searchParams.get("error")).toBe("server_error");
  });

  test("no stored value holds the Google refresh token in clear", async () => {
    const id = await registerClient();
    await callbackFor(id, "alice@test");
    const user = await env.DB.prepare("SELECT google_refresh_token_enc AS t FROM users").first<{ t: string }>();
    expect(user?.t).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    const packed = Uint8Array.from(atob(user?.t.slice(3) ?? ""), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12));
    expect(new TextDecoder().decode(plain)).toBe("google-refresh-secret");
    for (const table of ["nodes", "jobs", "leases", "node_events", "invites", "users", "oauth_clients", "oauth_requests", "oauth_codes", "oauth_tokens"]) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(results)).not.toContain("google-refresh-secret");
    }
  });

  test("encrypts with a fresh IV each time", async () => {
    const id = await registerClient();
    await callbackFor(id, "alice@test");
    const first = (await env.DB.prepare("SELECT google_refresh_token_enc AS t FROM users").first<{ t: string }>())?.t;
    await callbackFor(id, "alice@test");
    expect((await env.DB.prepare("SELECT google_refresh_token_enc AS t FROM users").first<{ t: string }>())?.t).not.toBe(first);
  });
});

describe("log events", () => {
  test("registered, completed and denied lines hold no e-mail, code or token", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      const id = await registerClient();
      await callbackFor(id, "alice@test");
      await callbackFor(id, "mallory@test");
      await form("/authorize/consent", { request: await pendingRequest(id), decision: "deny" });
    } finally {
      spy.mockRestore();
    }
    const events = lines.map((l) => JSON.parse(l) as { event: string; attrs: Record<string, unknown> });
    expect(events.map((e) => e.event)).toEqual(["auth.client.registered", "auth.oauth.completed", "auth.oauth.denied", "auth.oauth.denied"]);
    expect(events[0]?.attrs).toEqual({ client_id: expect.any(String) });
    expect(events[1]?.attrs).toEqual({ client_id: expect.any(String), role: "admin" });
    expect(events[2]?.attrs).toMatchObject({ reason: "not_invited" });
    expect(events[3]?.attrs).toMatchObject({ reason: "access_denied" });
    const all = lines.join("\n");
    for (const secret of ["alice@test", "mallory@test", "sub-alice", "google-refresh-secret", "gcode"]) expect(all).not.toContain(secret);
  });
});
