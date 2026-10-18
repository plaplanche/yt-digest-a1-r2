import { expect, test, type APIRequestContext } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const redirectUri = "http://127.0.0.1:9/cb";

async function client(request: APIRequestContext): Promise<string> {
  const res = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "e2e" } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

const authorize = (request: APIRequestContext, clientId: string, extra: Record<string, string>) =>
  request.get("/authorize", {
    maxRedirects: 0,
    params: { response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: "chal", code_challenge_method: "S256", resource: `${workerUrl}/mcp`, state: "s1", ...extra },
  });

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
});

test("E2E-29: no PKCE, plain PKCE and a non-exact redirect_uri are refused", async ({ request }) => {
  const id = await client(request);

  const noPkce = await request.get("/authorize", {
    maxRedirects: 0,
    params: { response_type: "code", client_id: id, redirect_uri: redirectUri, resource: `${workerUrl}/mcp`, state: "s1" },
  });
  expect(noPkce.status()).toBe(302);
  expect(new URL(noPkce.headers().location ?? "").searchParams.get("error")).toBe("invalid_request");

  const plain = await authorize(request, id, { code_challenge_method: "plain" });
  expect(plain.status()).toBe(302);
  expect(new URL(plain.headers().location ?? "").searchParams.get("error")).toBe("invalid_request");

  const other = await authorize(request, id, { redirect_uri: `${redirectUri}/evil` });
  expect(other.status()).toBe(400);
  expect(other.headers().location).toBeUndefined();
});
