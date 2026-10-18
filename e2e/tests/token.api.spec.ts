import { expect, test, type APIRequestContext } from "@playwright/test";

const opsToken = process.env.OPS_TOKEN ?? "ops-local";
const redirectUri = "http://127.0.0.1:9/cb";
const workerUrl = process.env.WORKER_URL ?? `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: { Authorization: `Bearer ${opsToken}` } })).status()).toBe(200);
});

interface Tokens {
  access_token: string;
  refresh_token: string;
}

// The whole login over HTTP: consent form, then the fake Google through its login_hint, then the callback.
async function login(request: APIRequestContext, email: string): Promise<{ clientId: string; code: string }> {
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
  expect(consent.status()).toBe(302);
  const google = new URL(consent.headers().location ?? "");
  google.searchParams.set("login_hint", email);
  const signedIn = await request.get(google.toString(), { maxRedirects: 0 });
  expect(signedIn.status()).toBe(302);
  const callback = await request.get(signedIn.headers().location ?? "", { maxRedirects: 0 });
  expect(callback.status()).toBe(302);
  const code = new URL(callback.headers().location ?? "").searchParams.get("code");
  expect(code).toBeTruthy();
  return { clientId, code: code ?? "" };
}

test("E2E-31: refresh rotation, and the reuse of an old refresh token revokes the family", async ({ request }) => {
  const { clientId, code } = await login(request, "alice@test");
  const exchanged = await request.post("/token", {
    form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: `${workerUrl}/mcp` },
  });
  expect(exchanged.status()).toBe(200);
  expect(exchanged.headers()["cache-control"]).toBe("no-store");
  const first = (await exchanged.json()) as Tokens;

  const refresh = (token: string) => request.post("/token", { form: { grant_type: "refresh_token", refresh_token: token, client_id: clientId } });
  const rotated = await refresh(first.refresh_token);
  expect(rotated.status()).toBe(200);
  const second = (await rotated.json()) as Tokens;
  expect(second.refresh_token).not.toBe(first.refresh_token);
  expect(second.access_token).not.toBe(first.access_token);

  // The old refresh token was used: reuse is refused and revokes the whole family.
  const reuse = await refresh(first.refresh_token);
  expect(reuse.status()).toBe(400);
  expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");
  const afterRevocation = await refresh(second.refresh_token);
  expect(afterRevocation.status()).toBe(400);
  expect(((await afterRevocation.json()) as { error: string }).error).toBe("invalid_grant");

  // The code is used up.
  const again = await request.post("/token", {
    form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: `${workerUrl}/mcp` },
  });
  expect(again.status()).toBe(400);
  expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");
});
