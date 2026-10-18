import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const opsToken = process.env.OPS_TOKEN ?? "ops-local";
const ops = { Authorization: `Bearer ${opsToken}` };
const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
// Nothing listens here: the browser is stopped at the redirect by a route, so the test reads the URL
// without Chromium navigating to an error page.
const redirectUri = "http://127.0.0.1:9/cb";
const redirected = /^http:\/\/127\.0\.0\.1:9\/cb\?/;

test.beforeEach(async ({ request, page }) => {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
  await page.route(redirected, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "client" }));
});

async function startAuthorization(page: Page, request: APIRequestContext): Promise<void> {
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
