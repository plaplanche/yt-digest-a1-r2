import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import worker, { type Env } from "../../src/index";

const OPS = "ops-test-token";
const BASE = "http://worker.test";
const ISSUER = "http://google.test/google";
const GOOGLE_CLIENT_ID = "yt-digest-local";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const bindings: Env = {
  DB: env.DB,
  TRANSCRIPTS: env.TRANSCRIPTS,
  OPS_TOKEN: OPS,
  PUBLIC_URL: BASE,
  GOOGLE_ISSUER: ISSUER,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: "local-google-secret",
  ADMIN_EMAIL: "alice@test",
  TOKEN_ENC_KEY: KEY,
};
const REDIRECT = "http://127.0.0.1:9/cb";
const GOOGLE_REFRESH = "google-refresh-secret-value";

const call = (path: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(`${BASE}${path}`, init), bindings);
const ops = (path: string, body: unknown) =>
  call(path, { method: "POST", headers: { Authorization: `Bearer ${OPS}` }, body: JSON.stringify(body) });
const register = (body: unknown) => call("/register", { method: "POST", body: JSON.stringify(body) });

const b64u = (data: ArrayBuffer | string): string =>
  btoa(typeof data === "string" ? data : String.fromCharCode(...new Uint8Array(data))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The stub of Google: one RSA key, a token endpoint that signs whatever claims the test sets.
let signingKey: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };
let idClaims: Record<string, unknown> = {};
let signWith: CryptoKey | undefined;
let tokenStatus = 200;
let googleRefresh: string | undefined = GOOGLE_REFRESH;
let lastNonce = "";

async function idToken(claims: Record<string, unknown>): Promise<string> {
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const body = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signWith ?? signingKey.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

beforeAll(async () => {
  signingKey = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", signingKey.publicKey)), kid: "k1" };
});

beforeEach(async () => {
  await call("/ops/reset", { method: "POST", headers: { Authorization: `Bearer ${OPS}` } });
  signWith = undefined;
  tokenStatus = 200;
  googleRefresh = GOOGLE_REFRESH;
  idClaims = { email: "bob@test", email_verified: true, sub: "g-bob" };
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "http://google.test") return realFetch(input, init);
    if (url.pathname === "/google/.well-known/openid-configuration") {
      return Response.json({ authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (url.pathname === "/google/jwks") return Response.json({ keys: [publicJwk] });
    if (url.pathname === "/google/token") {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("client_secret")).toBe("local-google-secret");
      expect(form.get("redirect_uri")).toBe(`${BASE}/callback`);
      if (tokenStatus !== 200) return Response.json({ error: "invalid_grant" }, { status: tokenStatus });
      const iat = Math.floor(Date.now() / 1000);
      const claims = { iss: ISSUER, aud: GOOGLE_CLIENT_ID, iat, exp: iat + 3600, nonce: lastNonce, ...idClaims };
      return Response.json({ access_token: "a", id_token: await idToken(claims), refresh_token: googleRefresh });
    }
    return new Response("nope", { status: 404 });
  });
});

afterEach(() => vi.restoreAllMocks());

async function newClient(name?: string): Promise<string> {
  const res = await register({ redirect_uris: [REDIRECT], ...(name === undefined ? {} : { client_name: name }) });
  return ((await res.json()) as { client_id: string }).client_id;
}

const authorizeUrl = (clientId: string, extra: Record<string, string | null> = {}): string => {
  const params: Record<string, string | null> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: "chal", code_challenge_method: "S256",
    resource: `${BASE}/mcp`, state: "cs1", ...extra,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null) q.set(k, v);
  return `/authorize?${q}`;
};

const location = (res: Response): URL => new URL(res.headers.get("Location") ?? "");

async function pendingRequest(clientId: string): Promise<string> {
  const res = await call(authorizeUrl(clientId));
  expect(res.status).toBe(200);
  return /name="request" value="([^"]+)"/.exec(await res.text())?.[1] ?? "";
}

const consent = (request: string, decision: string) =>
  call("/authorize/consent", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request, decision }) });

// Runs consent then the callback; returns the callback response.
async function login(clientId: string, state?: string): Promise<Response> {
  const approve = await consent(await pendingRequest(clientId), "approve");
  const to = location(approve);
  lastNonce = to.searchParams.get("nonce") ?? "";
  return call(`/callback?code=gcode&state=${encodeURIComponent(state ?? to.searchParams.get("state") ?? "")}`);
}

describe("discovery", () => {
  test("protected resource and authorization server documents", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      expect(await (await call(path)).json()).toEqual({
        resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ["digest"], bearer_methods_supported: ["header"],
      });
    }
    const res = await call("/.well-known/oauth-authorization-server");
    expect(res.headers.get("Content-Type")).toBe("application/json");
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

describe("POST /register", () => {
  test("registers a public client", async () => {
    const res = await register({ redirect_uris: [REDIRECT, "https://app.example/cb?x=1"], client_name: "My <b>client</b>", token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      client_name: "My <b>client</b>", redirect_uris: [REDIRECT, "https://app.example/cb?x=1"], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    });
    expect((body.client_id as string).length).toBeGreaterThanOrEqual(16);
    expect(Math.abs((body.client_id_issued_at as number) - Date.now() / 1000)).toBeLessThan(5);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM oauth_clients WHERE client_id = ?").bind(body.client_id).first("n")).toBe(1);
  });

  test("omits client_name when not given", async () => {
    expect(await (await register({ redirect_uris: [REDIRECT] })).json()).not.toHaveProperty("client_name");
  });

  test.each([["not JSON", "{nope"], ["not an object", "[1]"]])("invalid_request: body %s", async (_name, raw) => {
    const res = await call("/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
  });

  test.each([
    ["missing", {}],
    ["empty", { redirect_uris: [] }],
    ["more than 10", { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) }],
    ["not a string", { redirect_uris: [3] }],
    ["relative", { redirect_uris: ["/cb"] }],
    ["http on a public host", { redirect_uris: ["http://example.com/cb"] }],
    ["fragment", { redirect_uris: ["https://a.example/cb#x"] }],
    ["custom scheme", { redirect_uris: ["app://cb"] }],
  ])("invalid_redirect_uri: %s", async (_name, body) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_redirect_uri");
  });

  test.each([
    ["client_name too long", { client_name: "x".repeat(201) }],
    ["client_name not a string", { client_name: 1 }],
    ["auth method", { token_endpoint_auth_method: "client_secret_basic" }],
    ["grant type", { grant_types: ["password"] }],
    ["response type", { response_types: ["token"] }],
  ])("invalid_client_metadata: %s", async (_name, extra) => {
    const res = await register({ redirect_uris: [REDIRECT], ...extra });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_client_metadata");
  });

  test("accepts http on localhost", async () => {
    expect((await register({ redirect_uris: ["http://localhost:3000/cb"] })).status).toBe(201);
  });
});

describe("GET /authorize", () => {
  test("never redirects on an unknown client or a wrong redirect_uri", async () => {
    const client = await newClient();
    for (const url of [authorizeUrl("nope"), authorizeUrl(client, { redirect_uri: null }), authorizeUrl(client, { redirect_uri: `${REDIRECT}/` }), authorizeUrl(client, { redirect_uri: "http://127.0.0.1:9/cb?x=1" })]) {
      const res = await call(url);
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.has("Location")).toBe(false);
    }
  });

  test.each([
    ["response_type", { response_type: "token" }, "unsupported_response_type"],
    ["missing challenge", { code_challenge: null }, "invalid_request"],
    ["no method", { code_challenge_method: null }, "invalid_request"],
    ["plain", { code_challenge_method: "plain" }, "invalid_request"],
    ["missing resource", { resource: null }, "invalid_target"],
    ["wrong resource", { resource: `${BASE}/mcp/` }, "invalid_target"],
    ["scope", { scope: "digest admin" }, "invalid_scope"],
  ])("redirects with %s", async (_name, extra, error) => {
    const res = await call(authorizeUrl(await newClient(), extra));
    expect(res.status).toBe(302);
    const to = location(res);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get("error")).toBe(error);
    expect(to.searchParams.get("state")).toBe("cs1");
  });

  test("errors are checked in order", async () => {
    const client = await newClient();
    const res = await call(authorizeUrl(client, { response_type: "x", code_challenge: null, resource: null, scope: "other" }));
    expect(location(res).searchParams.get("error")).toBe("unsupported_response_type");
    const res2 = await call(authorizeUrl(client, { code_challenge: null, resource: null, scope: "other" }));
    expect(location(res2).searchParams.get("error")).toBe("invalid_request");
    const res3 = await call(authorizeUrl(client, { resource: null, scope: "other" }));
    expect(location(res3).searchParams.get("error")).toBe("invalid_target");
  });

  test("an error redirect without state carries none", async () => {
    const res = await call(authorizeUrl(await newClient(), { response_type: "x", state: null }));
    expect(location(res).searchParams.has("state")).toBe(false);
  });

  test("the consent page escapes the client name and has two decision buttons", async () => {
    const client = await newClient(`<script>alert("x")</script>`);
    const res = await call(authorizeUrl(client));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const page = await res.text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(page).toContain('<form method="post" action="/authorize/consent">');
    expect(page.match(/<button type="submit" name="decision" value="(approve|deny)">/g)).toHaveLength(2);
    expect(page).toContain(REDIRECT);
    expect(page).toContain("digest");
    expect(/name="request" value="([^"]{16,})"/.test(page)).toBe(true);
  });

  test("a client without a name is shown by its client_id", async () => {
    const client = await newClient();
    expect(await (await call(authorizeUrl(client))).text()).toContain(client);
  });
});

describe("POST /authorize/consent", () => {
  test("unknown, expired and used requests give 400 HTML", async () => {
    const client = await newClient();
    expect((await consent("unknown", "approve")).status).toBe(400);
    const id = await pendingRequest(client);
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ? WHERE request_id = ?").bind(new Date(Date.now() - 1000).toISOString(), id).run();
    const expired = await consent(id, "deny");
    expect(expired.status).toBe(400);
    expect(expired.headers.get("Content-Type")).toContain("text/html");
    const used = await pendingRequest(client);
    expect((await consent(used, "deny")).status).toBe(302);
    expect((await consent(used, "deny")).status).toBe(400);
    expect((await consent(used, "approve")).status).toBe(400);
  });

  test("deny redirects with access_denied and the client state", async () => {
    const res = await consent(await pendingRequest(await newClient()), "deny");
    expect(res.status).toBe(302);
    const to = location(res);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("cs1");
  });

  test("a failed Google discovery fetch leaves the approve retryable", async () => {
    const id = await pendingRequest(await newClient());
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => new Response("down", { status: 503 }));
    await expect(consent(id, "approve")).rejects.toThrow();
    expect((await consent(id, "approve")).status).toBe(302);
  });

  test("approve redirects to Google with every parameter, and only once", async () => {
    const id = await pendingRequest(await newClient());
    const res = await consent(id, "approve");
    expect(res.status).toBe(302);
    const to = location(res);
    expect(to.origin + to.pathname).toBe(`${ISSUER}/authorize`);
    const q = to.searchParams;
    expect(q.get("client_id")).toBe(GOOGLE_CLIENT_ID);
    expect(q.get("redirect_uri")).toBe(`${BASE}/callback`);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe("openid email https://www.googleapis.com/auth/youtube.readonly");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("state")?.length).toBeGreaterThanOrEqual(16);
    expect(q.get("nonce")?.length).toBeGreaterThanOrEqual(16);
    expect(q.get("state")).not.toBe(q.get("nonce"));
    expect(q.get("state")).not.toBe("cs1");
    expect((await consent(id, "approve")).status).toBe(400);
  });

  test("a bad decision or body is refused without using the request", async () => {
    const id = await pendingRequest(await newClient());
    expect((await consent(id, "maybe")).status).toBe(400);
    expect((await call("/authorize/consent", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await consent(id, "deny")).status).toBe(302);
  });
});

describe("GET /callback", () => {
  const userCount = async () => (await env.DB.prepare("SELECT count(*) AS n FROM users").first<number>("n")) ?? -1;

  test("an invited user gets a code and a member row", async () => {
    await ops("/ops/invites", { email: "Bob@Test" });
    const client = await newClient();
    const res = await login(client);
    expect(res.status).toBe(302);
    const to = location(res);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get("state")).toBe("cs1");
    const code = to.searchParams.get("code") ?? "";
    expect(code.length).toBeGreaterThanOrEqual(32);
    const user = await env.DB.prepare("SELECT user_sub, email, role FROM users").first();
    expect(user).toEqual({ user_sub: "g-bob", email: "bob@test", role: "member" });
    expect(await env.DB.prepare("SELECT accepted_user_sub FROM invites WHERE email = 'bob@test'").first("accepted_user_sub")).toBe("g-bob");
    const row = await env.DB.prepare("SELECT * FROM oauth_codes").first<Record<string, unknown>>();
    expect(row).toMatchObject({ client_id: client, user_sub: "g-bob", redirect_uri: REDIRECT, code_challenge: "chal", scope: "digest", resource: `${BASE}/mcp` });
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.code_hash).not.toBe(code);
    expect(new Date(row?.expires_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  test("the admin needs no invite", async () => {
    idClaims = { email: "alice@test", email_verified: true, sub: "g-alice" };
    const res = await login(await newClient());
    expect(location(res).searchParams.has("code")).toBe(true);
    expect(await env.DB.prepare("SELECT role FROM users WHERE user_sub = 'g-alice'").first("role")).toBe("admin");
  });

  test("a non-invited user, a revoked invite and an unverified e-mail get the 403 page and no row", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await ops("/ops/invites/revoke", { email: "bob@test" });
    const cases: Record<string, unknown>[] = [
      { email: "mallory@test", sub: "g-mal" },
      { email: "bob@test", sub: "g-bob" },
      { email: "alice@test", sub: "g-alice", email_verified: false },
    ];
    for (const claims of cases) {
      idClaims = { email_verified: true, ...claims };
      const res = await login(await newClient());
      expect(res.status).toBe(403);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      const page = await res.text();
      expect(page).toContain("<title>Access refused</title>");
      expect(page).toContain("This account is not invited.");
    }
    expect(await userCount()).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM oauth_codes").first("n")).toBe(0);
  });

  test("a bad or reused state is refused with 400 HTML", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const client = await newClient();
    const bad = await login(client, "not-the-state");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("Content-Type")).toContain("text/html");
    const first = await login(client);
    expect(first.status).toBe(302);
    const state = (await env.DB.prepare("SELECT google_state FROM oauth_requests WHERE used_at IS NOT NULL").first<string>("google_state")) ?? "";
    expect((await call(`/callback?code=x&state=${state}`)).status).toBe(400);
    expect((await call("/callback?code=x")).status).toBe(400);
  });

  test("an expired pending authorization is refused", async () => {
    const approve = await consent(await pendingRequest(await newClient()), "approve");
    await env.DB.prepare("UPDATE oauth_requests SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect((await call(`/callback?code=x&state=${location(approve).searchParams.get("state")}`)).status).toBe(400);
  });

  test("an error from Google redirects with access_denied and the state, using the request up", async () => {
    const approve = await consent(await pendingRequest(await newClient()), "approve");
    const state = location(approve).searchParams.get("state");
    const res = await call(`/callback?error=access_denied&state=${state}`);
    expect(res.status).toBe(302);
    expect(location(res).searchParams.get("error")).toBe("access_denied");
    expect(location(res).searchParams.get("state")).toBe("cs1");
    expect((await call(`/callback?code=x&state=${state}`)).status).toBe(400);
  });

  async function expectServerError(res: Response): Promise<void> {
    expect(res.status).toBe(302);
    expect(location(res).searchParams.get("error")).toBe("server_error");
    expect(location(res).searchParams.get("state")).toBe("cs1");
    expect(await userCount()).toBe(0);
  }

  test("a bad signature is refused", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    signWith = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])).privateKey;
    await expectServerError(await login(await newClient()));
  });

  test.each([
    ["aud", { aud: "someone-else" }],
    ["iss", { iss: "http://evil.test" }],
    ["nonce", { nonce: "wrong" }],
    ["exp", { exp: Math.floor(Date.now() / 1000) - 10 }],
  ])("a wrong %s is refused", async (_name, claims) => {
    await ops("/ops/invites", { email: "bob@test" });
    idClaims = { ...idClaims, ...claims };
    await expectServerError(await login(await newClient()));
  });

  test("a failing token endpoint is refused", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    tokenStatus = 400;
    await expectServerError(await login(await newClient()));
  });

  test("the Google refresh token is stored encrypted and never in clear", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    await login(await newClient());
    const stored = await env.DB.prepare("SELECT google_refresh_token_enc AS enc FROM users").first<string>("enc");
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    const packed = Uint8Array.from(atob((stored ?? "").slice(3)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12));
    expect(new TextDecoder().decode(plain)).toBe(GOOGLE_REFRESH);
    for (const table of ["users", "invites", "oauth_clients", "oauth_requests", "oauth_codes", "oauth_tokens"]) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(results)).not.toContain(GOOGLE_REFRESH);
    }
  });

  test("a later login updates the role and keeps the stored refresh token", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const client = await newClient();
    await login(client);
    const row = () => env.DB.prepare("SELECT email, role, google_refresh_token_enc AS enc FROM users").all<{ email: string; role: string; enc: string }>();
    const first = (await row()).results[0];
    expect(first?.role).toBe("member");
    googleRefresh = undefined;
    idClaims = { email: "alice@test", email_verified: true, sub: "g-bob" };
    await login(client);
    const { results } = await row();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ email: "alice@test", role: "admin", enc: first?.enc });
  });

  test("an invite revoked before the writes gives the 403 page and no row or code", async () => {
    await ops("/ops/invites", { email: "bob@test" });
    const client = await newClient();
    const stub = vi.mocked(globalThis.fetch).getMockImplementation() as typeof fetch;
    // Revoke while the callback talks to Google, after the request was used up.
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/google/jwks")) await ops("/ops/invites/revoke", { email: "bob@test" });
      return stub(input, init);
    });
    const res = await login(client);
    expect(res.status).toBe(403);
    expect(await userCount()).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_codes").first<{ n: number }>())?.n).toBe(0);
  });

  test("the log events carry no secret, e-mail or sub", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    await ops("/ops/invites", { email: "bob@test" });
    const client = await newClient();
    const done = location(await login(client)).searchParams.get("code") ?? "";
    idClaims = { email: "mallory@test", email_verified: true, sub: "g-mal" };
    await login(client);
    const events = lines.map((l) => JSON.parse(l) as { event: string; attrs: Record<string, unknown> });
    expect(events.find((e) => e.event === "auth.client.registered")?.attrs).toEqual({ client_id: client });
    expect(events.find((e) => e.event === "auth.oauth.completed")?.attrs).toEqual({ client_id: client, role: "member" });
    expect(events.find((e) => e.event === "auth.oauth.denied")?.attrs).toEqual({ client_id: client, reason: "not_invited" });
    const text = lines.join("\n");
    for (const secret of [done, GOOGLE_REFRESH, "bob@test", "mallory@test", "g-bob", "g-mal"]) expect(text).not.toContain(secret);
  });
});
