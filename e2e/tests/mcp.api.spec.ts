import { expect, test, type APIRequestContext } from "@playwright/test";

const opsToken = process.env.OPS_TOKEN ?? "ops-local";
const ops = { Authorization: `Bearer ${opsToken}` };
const redirectUri = "http://127.0.0.1:9/cb";
const workerUrl = process.env.WORKER_URL ?? `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } };

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
});

// The whole login over HTTP, then the code exchange: returns an access token.
async function accessToken(request: APIRequestContext, email: string): Promise<string> {
  const registered = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "E2E client" } });
  const { client_id: clientId } = (await registered.json()) as { client_id: string };
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${workerUrl}/mcp`,
    state: "s1",
  });
  const page = await request.get(`/authorize?${query}`);
  const requestId = /name="request" value="([^"]+)"/.exec(await page.text())?.[1] ?? "";
  const consent = await request.post("/authorize/consent", { form: { request: requestId, decision: "approve" }, maxRedirects: 0 });
  const google = new URL(consent.headers().location ?? "");
  google.searchParams.set("login_hint", email);
  const signedIn = await request.get(google.toString(), { maxRedirects: 0 });
  const callback = await request.get(signedIn.headers().location ?? "", { maxRedirects: 0 });
  const code = new URL(callback.headers().location ?? "").searchParams.get("code") ?? "";
  const exchanged = await request.post("/token", {
    form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: `${workerUrl}/mcp` },
  });
  expect(exchanged.status()).toBe(200);
  return ((await exchanged.json()) as { access_token: string }).access_token;
}

const mcp = (request: APIRequestContext, token?: string) =>
  request.post("/mcp", {
    headers: { Accept: "application/json, text/event-stream", ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
    data: initialize,
  });

test("E2E-27: /mcp without a token gets 401 and WWW-Authenticate; the discovery documents are consistent", async ({ request }) => {
  const res = await mcp(request);
  expect(res.status()).toBe(401);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_token");
  const header = res.headers()["www-authenticate"] ?? "";
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1] ?? "";
  expect(metadataUrl).toBeTruthy();
  const resource = (await (await request.get(metadataUrl)).json()) as { resource: string; authorization_servers: string[] };
  expect(resource.resource).toBe(`${workerUrl}/mcp`);
  const server = (await (await request.get(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as {
    issuer: string;
    token_endpoint: string;
    registration_endpoint: string;
  };
  expect(server.issuer).toBe(resource.authorization_servers[0]);
  expect(server.token_endpoint).toBe(`${workerUrl}/token`);
  expect(server.registration_endpoint).toBe(`${workerUrl}/register`);
});

test("E2E-33: a revoked invite refuses the user's valid access token", async ({ request }) => {
  expect((await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } })).status()).toBe(200);
  const token = await accessToken(request, "bob@test");
  expect((await mcp(request, token)).status()).toBe(200);
  expect((await request.post("/ops/invites/revoke", { headers: ops, data: { email: "bob@test" } })).status()).toBe(200);
  const refused = await mcp(request, token);
  expect(refused.status()).toBe(401);
  expect(refused.headers()["www-authenticate"]).toContain("resource_metadata=");
});

test("E2E-37: a node token on /mcp and an access token on /node/* are refused", async ({ request }) => {
  const enrolled = await request.post("/ops/nodes", { headers: ops, data: { node_id: "n1", owner_label: "e2e" } });
  const { token: nodeToken } = (await enrolled.json()) as { token: string };
  expect((await mcp(request, nodeToken)).status()).toBe(401);
  const access = await accessToken(request, "alice@test");
  expect((await mcp(request, access)).status()).toBe(200);
  const node = await request.post("/node/heartbeat", { headers: { Authorization: `Bearer ${access}` }, data: {} });
  expect(node.status()).toBe(401);
});
