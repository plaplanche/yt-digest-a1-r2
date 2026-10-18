import { expect, test } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const redirectUri = "http://127.0.0.1:9/cb";

test.beforeEach(async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
});

async function startLogin(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const registered = await request.post("/register", { data: { redirect_uris: [redirectUri], client_name: "Browser client" } });
  const { client_id } = (await registered.json()) as { client_id: string };
  const params = new URLSearchParams({
    response_type: "code", client_id, redirect_uri: redirectUri, code_challenge: "chal", code_challenge_method: "S256",
    resource: `${workerUrl}/mcp`, state: "s-browser",
  });
  return `/authorize?${params}`;
}

async function signIn(page: import("@playwright/test").Page, url: string, email: string): Promise<void> {
  await page.route(`${redirectUri}*`, (route) => route.fulfill({ status: 200, body: "client" }));
  await page.goto(url);
  await expect(page.getByText("Browser client")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await page.locator('input[name="login_hint"]').fill(email);
  await page.locator('button[type="submit"], input[type="submit"]').click();
}

test("an invited user goes through the consent page and the sign-in page back to the client with a code", async ({ page, request }) => {
  await request.post("/ops/invites", { headers: ops, data: { email: "bob@test" } });
  await signIn(page, await startLogin(request), "bob@test");
  await page.waitForURL(`${redirectUri}?*`);
  const back = new URL(page.url());
  expect(back.searchParams.get("code")?.length).toBeGreaterThanOrEqual(32);
  expect(back.searchParams.get("state")).toBe("s-browser");
  const users = await request.get("/ops/users", { headers: ops });
  const { users: rows } = (await users.json()) as { users: { user_sub: string; email: string; role: string }[] };
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ email: "bob@test", role: "member" });
  expect(rows[0]?.user_sub).toMatch(/^g-[0-9a-f]{16}$/);
});

test("E2E-02: a non-invited user gets the 403 page and no users row", async ({ page, request }) => {
  await signIn(page, await startLogin(request), "mallory@test");
  await expect(page).toHaveTitle("Access refused");
  await expect(page.getByText("This account is not invited.")).toBeVisible();
  expect(await (await request.get("/ops/users", { headers: ops })).json()).toEqual({ users: [] });
});
