import { expect, test, type APIRequestContext } from "@playwright/test";

const opsToken = process.env.OPS_TOKEN ?? "ops-local";
const redirectUri = "http://127.0.0.1:9/cb";

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: { Authorization: `Bearer ${opsToken}` } })).status()).toBe(200);
});

async function register(request: APIRequestContext): Promise<string> {
  const res = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "E2E client" } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

const query = (clientId: string, extra: Record<string, string> = {}): string =>
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: `${process.env.WORKER_URL ?? `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`}/mcp`,
    state: "s1",
    ...extra,
  }).toString();

test("E2E-29: no PKCE, plain PKCE and a non-exact redirect_uri are refused", async ({ request }) => {
  const id = await register(request);

  const noPkce = new URLSearchParams(query(id));
  noPkce.delete("code_challenge");
  noPkce.delete("code_challenge_method");
  for (const q of [noPkce.toString(), query(id, { code_challenge_method: "plain" })]) {
    const res = await request.get(`/authorize?${q}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const target = new URL(res.headers().location ?? "");
    expect(target.origin + target.pathname).toBe(redirectUri);
    expect(target.searchParams.get("error")).toBe("invalid_request");
    expect(target.searchParams.get("state")).toBe("s1");
  }

  for (const uri of [`${redirectUri}/`, "http://127.0.0.1:9/cb?x=1", "http://127.0.0.1:9/other"]) {
    const res = await request.get(`/authorize?${query(id, { redirect_uri: uri })}`, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
    expect(res.headers().location).toBeUndefined();
  }

  const ok = await request.get(`/authorize?${query(id)}`, { maxRedirects: 0 });
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toContain('<form method="post" action="/authorize/consent">');
});
