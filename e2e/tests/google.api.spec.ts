import { createHash, createPublicKey, verify } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const mocksUrl = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;
const issuer = `${mocksUrl}/google`;
const clientId = process.env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "local-google-secret";
const redirectUri = "http://127.0.0.1:9/cb";

const authorizeUrl = (extra: Record<string, string> = {}): string =>
  `${issuer}/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email", ...extra })}`;

async function login(request: APIRequestContext, email: string, extra: Record<string, string> = {}): Promise<string> {
  const res = await request.get(authorizeUrl({ login_hint: email, state: "st", ...extra }), { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const location = new URL(res.headers().location ?? "");
  expect(location.origin + location.pathname).toBe(redirectUri);
  expect(location.searchParams.get("state")).toBe("st");
  return location.searchParams.get("code") ?? "";
}

const exchange = (request: APIRequestContext, form: Record<string, string>, secret = clientSecret) =>
  request.post(`${issuer}/token`, { form: { client_id: clientId, client_secret: secret, ...form } });

test("the discovery document", async ({ request }) => {
  const res = await request.get(`${issuer}/.well-known/openid-configuration`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  });
});

test("authorize refuses a wrong client_id and a missing openid scope", async ({ request }) => {
  expect((await request.get(authorizeUrl({ client_id: "other" }))).status()).toBe(400);
  expect((await request.get(authorizeUrl({ scope: "email profile" }))).status()).toBe(400);
  expect((await request.get(authorizeUrl({ response_type: "token" }))).status()).toBe(400);
});

test("authorize shows a sign-in form repeating every parameter", async ({ request }) => {
  const res = await request.get(authorizeUrl({ state: "s&1", nonce: "n1", access_type: "offline" }));
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('<form method="get" action="/google/authorize">');
  expect(html).toContain('name="login_hint"');
  for (const [k, v] of [["client_id", clientId], ["redirect_uri", redirectUri], ["response_type", "code"], ["scope", "openid email"], ["state", "s&#38;1"], ["nonce", "n1"], ["access_type", "offline"]]) {
    expect(html).toContain(`<input type="hidden" name="${k}" value="${v}">`);
  }
});

test("the code gives a signed ID token with the claims of 5.3, and is single use", async ({ request }) => {
  const code = await login(request, "Bob@Test", { nonce: "n-123" });
  const res = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
  expect(body.refresh_token).toBeUndefined();
  const [h, p, s] = String(body.id_token).split(".") as [string, string, string];
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string; kid: string };
  const jwks = (await (await request.get(`${issuer}/jwks`)).json()) as { keys: (JsonWebKey & { kid: string; alg: string; use: string })[] };
  const key = jwks.keys[0]!;
  expect(header.alg).toBe("RS256");
  expect(header.kid).toBe(key.kid);
  expect([key.alg, key.use]).toEqual(["RS256", "sig"]);
  expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key, format: "jwk" }), Buffer.from(s, "base64url"))).toBe(true);
  const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, number>;
  expect(claims).toMatchObject({
    iss: issuer,
    aud: clientId,
    sub: `g-${createHash("sha256").update("bob@test").digest("hex").slice(0, 16)}`,
    email: "bob@test",
    email_verified: true,
    nonce: "n-123",
  });
  expect(claims.exp).toBe(claims.iat! + 3600);
  expect(Math.abs(claims.iat! - Date.now() / 1000)).toBeLessThan(60);

  const again = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  expect(again.status()).toBe(400);
  expect(await again.json()).toEqual({ error: "invalid_grant" });
});

test("a wrong redirect_uri gives invalid_grant", async ({ request }) => {
  const code = await login(request, "bob@test");
  const res = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: "http://127.0.0.1:9/other" });
  expect(res.status()).toBe(400);
});

test("a wrong client secret gives 401 invalid_client; HTTP Basic works", async ({ request }) => {
  const code = await login(request, "bob@test");
  const bad = await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, "wrong");
  expect(bad.status()).toBe(401);
  expect(await bad.json()).toEqual({ error: "invalid_client" });
  const basic = await request.post(`${issuer}/token`, {
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
    form: { grant_type: "authorization_code", code, redirect_uri: redirectUri },
  });
  expect(basic.status()).toBe(200);
});

test("access_type=offline gives a refresh token that refreshes", async ({ request }) => {
  const code = await login(request, "alice@test", { access_type: "offline" });
  const first = (await (await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri })).json()) as Record<string, string>;
  expect(first.refresh_token).toBeTruthy();
  const res = await exchange(request, { grant_type: "refresh_token", refresh_token: first.refresh_token! });
  expect(res.status()).toBe(200);
  const next = (await res.json()) as Record<string, string>;
  expect(next.access_token).not.toBe(first.access_token);
  expect(next.id_token).toBeTruthy();
  const bad = await exchange(request, { grant_type: "refresh_token", refresh_token: "nope" });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: "invalid_grant" });
});

test("userinfo answers for its access token only", async ({ request }) => {
  const code = await login(request, "Mallory@Test");
  const tokens = (await (await exchange(request, { grant_type: "authorization_code", code, redirect_uri: redirectUri })).json()) as Record<string, string>;
  const ok = await request.get(`${issuer}/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({
    sub: `g-${createHash("sha256").update("mallory@test").digest("hex").slice(0, 16)}`,
    email: "mallory@test",
    email_verified: true,
  });
  expect((await request.get(`${issuer}/userinfo`, { headers: { Authorization: "Bearer nope" } })).status()).toBe(401);
  expect((await request.get(`${issuer}/userinfo`)).status()).toBe(401);
});

test("revoke answers 200", async ({ request }) => {
  expect((await request.post(`${issuer}/revoke`, { form: { token: "x" } })).status()).toBe(200);
});
