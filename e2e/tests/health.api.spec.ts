import { expect, test } from "@playwright/test";

const mocksUrl = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;

test("the Worker answers /health", async ({ request }) => {
  const response = await request.get("/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok" });
});

test("the mocks server answers /health", async ({ request }) => {
  const response = await request.get(`${mocksUrl}/health`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("SponsorBlock has no segment for any video", async ({ request }) => {
  const response = await request.get(`${mocksUrl}/sponsorblock/api/skipSegments?videoID=abcdefghijk`);
  expect(response.status()).toBe(404);
  expect(await response.text()).toBe("Not Found");
});
