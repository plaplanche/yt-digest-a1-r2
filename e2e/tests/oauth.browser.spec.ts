import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const opsToken = process.env.OPS_TOKEN ?? "ops-local";
const ops = { Authorization: `Bearer ${opsToken}` };
const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
// A path on the Worker itself: its port is one Chromium allows and the final navigation loads (a 404
// page) instead of ending on an error page.
const redirectUri = `${workerUrl}/cb`;
const redirected = new RegExp(`^${workerUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cb\\?`);

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
});

async function startAuthorization(page: Page, request: APIRequestContext): Promise<string> {
  const res = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "E2E client" } });
  const { client_id } = (await res.json()) as { client_id: string };
  await page.goto(
    `/authorize?${new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: redirectUri,
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      resource: `${workerUrl}/mcp`,
      state: "s1",
    })}`,
  );
  return client_id;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL(/\/google\/authorize/);
  await page.locator('input[name="login_hint"]').fill(email);
  await page.locator('form button[type="submit"], form input[type="submit"]').click();
}

test("an invited user goes through the consent page and the sign-in page back to the client with a code", async ({ page, request }) => {
  expect((await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } })).status()).toBe(200);
  await startAuthorization(page, request);
  await expect(page.getByText("E2E client")).toBeVisible();
  await signIn(page, "bob@test");
  await page.waitForURL(redirected);
  const target = new URL(page.url());
  expect(target.searchParams.get("code")?.length).toBeGreaterThanOrEqual(32);
  expect(target.searchParams.get("state")).toBe("s1");
  const users = (await (await request.get("/ops/users", { headers: ops })).json()) as { users: { email: string; role: string }[] };
  expect(users.users).toEqual([expect.objectContaining({ email: "bob@test", role: "member" })]);
});

test("E2E-02: a non-invited user gets the 403 page and no users row", async ({ page, request }) => {
  await startAuthorization(page, request);
  await signIn(page, "mallory@test");
  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();
  const users = (await (await request.get("/ops/users", { headers: ops })).json()) as { users: unknown[] };
  expect(users.users).toEqual([]);
});

test("E2E-28: registration, PKCE, resource, consent and fake Google login: the token lists and calls list_subscriptions", async ({ page, request }) => {
  expect((await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } })).status()).toBe(200);
  const clientId = await startAuthorization(page, request);
  await signIn(page, "bob@test");
  await page.waitForURL(redirected);
  const code = new URL(page.url()).searchParams.get("code") ?? "";
  const exchanged = await request.post("/token", {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      resource: `${workerUrl}/mcp`,
    },
  });
  expect(exchanged.status()).toBe(200);
  const { access_token } = (await exchanged.json()) as { access_token: string };
  const rpc = async (data: unknown): Promise<{ result: Record<string, unknown> }> =>
    (await (await request.post("/mcp", { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json, text/event-stream" }, data })).json()) as {
      result: Record<string, unknown>;
    };
  const listed = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  expect((listed.result.tools as { name: string }[]).map((t) => t.name)).toEqual(["list_subscriptions"]);
  const called = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_subscriptions", arguments: {} } });
  expect(called.result).toEqual({ content: [{ type: "text", text: '{"subscriptions":[]}' }], isError: false });
});
