import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const workerUrl = `http://127.0.0.1:${process.env.WORKER_PORT ?? "8787"}`;
const mocksUrl = `http://127.0.0.1:${process.env.MOCKS_PORT ?? "8789"}`;

test("the node daemon processes a queued video and its transcript is readable", async ({ request }) => {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
  const enrolled = await request.post("/ops/nodes", { headers: ops, data: { node_id: "e2e-daemon", owner_label: "e2e" } });
  const { token } = (await enrolled.json()) as { token: string };
  const queued = await request.post("/ops/jobs", { headers: ops, data: { video_ids: ["nodedaemon1"] } });
  expect(await queued.json()).toEqual({ enqueued: ["nodedaemon1"], existing: [] });

  const done = spawnSync("uv", ["run", "--project", path.resolve("..", "node"), "yt-digest-node", "work", "--once"], {
    encoding: "utf8",
    env: {
      ...process.env,
      WORKER_URL: workerUrl,
      NODE_TOKEN: token,
      FETCHER_FAKE_YTDLP: "1",
      FAKE_YTDLP_DIR: path.resolve("fixtures", "ytdlp"),
      SPONSORBLOCK_URL: `${mocksUrl}/sponsorblock`,
    },
  });
  expect(done.status, done.stderr).toBe(0);
  expect(done.stderr).not.toContain(token);

  const response = await request.get("/ops/transcripts/nodedaemon1", { headers: ops });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ video_id: "nodedaemon1", node_id: "e2e-daemon", transcript: { video_id: "nodedaemon1", status: "ok", pages: ["Hello brave world."] } });
  const job = await request.get("/ops/jobs/nodedaemon1", { headers: ops });
  expect(await job.json()).toMatchObject({ status: "done", leased_by: null, last_outcome: "ok" });
});
