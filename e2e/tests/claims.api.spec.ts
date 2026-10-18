import { expect, test, type APIRequestContext } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };

async function enroll(request: APIRequestContext, nodeId: string): Promise<string> {
  const response = await request.post("/ops/nodes", { headers: ops, data: { node_id: nodeId, owner_label: "e2e" } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

test("2 nodes claim 6 jobs concurrently and each job is handed out once", async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
  const tokens = await Promise.all(["e2e-a", "e2e-b"].map((id) => enroll(request, id)));
  const videoIds = Array.from({ length: 6 }, (_, i) => `e2eclaim${String(i).padStart(3, "0")}`);
  const enqueued = await request.post("/ops/jobs", { headers: ops, data: { video_ids: videoIds } });
  expect(await enqueued.json()).toEqual({ enqueued: videoIds, existing: [] });

  const claims = await Promise.all(
    tokens.map(async (token) => {
      const response = await request.post("/node/claim", {
        headers: { Authorization: `Bearer ${token}` },
        data: { max_jobs: 3 },
      });
      expect(response.status()).toBe(200);
      return ((await response.json()) as { jobs: { video_id: string }[] }).jobs.map((j) => j.video_id);
    }),
  );
  expect(claims.map((c) => c.length)).toEqual([3, 3]);
  expect([...claims.flat()].sort()).toEqual(videoIds);
});
