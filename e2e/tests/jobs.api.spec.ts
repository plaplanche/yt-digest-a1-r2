import { expect, test, type APIRequestContext } from "@playwright/test";

const ops = { Authorization: `Bearer ${process.env.OPS_TOKEN ?? "ops-local"}` };
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Lease {
  video_id: string;
  lease_id: string;
  lease_expires_at: string;
}

async function reset(request: APIRequestContext): Promise<void> {
  expect((await request.post("/ops/reset", { headers: ops })).status()).toBe(200);
}

async function enroll(request: APIRequestContext, nodeId: string): Promise<string> {
  const response = await request.post("/ops/nodes", { headers: ops, data: { node_id: nodeId, owner_label: "e2e" } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

async function enqueue(request: APIRequestContext, videoIds: string[]): Promise<void> {
  const response = await request.post("/ops/jobs", { headers: ops, data: { video_ids: videoIds } });
  expect(await response.json()).toEqual({ enqueued: videoIds, existing: [] });
}

async function claim(request: APIRequestContext, token: string, maxJobs: number): Promise<Lease[]> {
  const response = await request.post("/node/claim", { headers: bearer(token), data: { max_jobs: maxJobs } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { jobs: Lease[] }).jobs;
}

function transcript(videoId: string): Record<string, unknown> {
  return { video_id: videoId, status: "ok", lang: "en", source: "auto", word_count: 3, truncated: false, sponsor_ratio: null, pages: ["alpha beta gamma"] };
}

async function jobStatus(request: APIRequestContext, videoId: string): Promise<Record<string, unknown>> {
  const response = await request.get(`/ops/jobs/${videoId}`, { headers: ops });
  expect(response.status()).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("E2E-13: 2 nodes claim 6 jobs concurrently, each job is handed out once and all 6 end done", async ({ request }) => {
  await reset(request);
  const tokens = await Promise.all(["e2e-a", "e2e-b"].map((id) => enroll(request, id)));
  const videoIds = Array.from({ length: 6 }, (_, i) => `e2eclaim${String(i).padStart(3, "0")}`);
  await enqueue(request, videoIds);

  const claims = await Promise.all(tokens.map((token) => claim(request, token, 3)));
  expect(claims.map((c) => c.length)).toEqual([3, 3]);
  expect(claims.flat().map((l) => l.video_id).sort()).toEqual(videoIds);

  await Promise.all(
    tokens.flatMap((token, i) =>
      (claims[i] ?? []).map(async (lease) => {
        const response = await request.post("/node/result", {
          headers: bearer(token),
          data: { lease_id: lease.lease_id, outcome: "ok", transcript: transcript(lease.video_id) },
        });
        expect(response.status()).toBe(200);
      }),
    ),
  );
  for (const id of videoIds) {
    expect(await jobStatus(request, id)).toMatchObject({ status: "done", attempts: 1, last_outcome: "ok" });
    expect((await request.get(`/ops/transcripts/${id}`, { headers: ops })).status()).toBe(200);
  }
});

test("E2E-14: an expired lease goes to another node and the first node's late result gets 409", async ({ request }) => {
  await reset(request);
  const [a, b] = await Promise.all(["e2e-a", "e2e-b"].map((id) => enroll(request, id)));
  await enqueue(request, ["e2elease001"]);
  const [first] = await claim(request, a ?? "", 1);
  expect(first).toBeDefined();
  await sleep(Math.max(0, Date.parse(first?.lease_expires_at ?? "") - Date.now()) + 300);

  const late = await request.post("/node/result", {
    headers: bearer(a ?? ""),
    data: { lease_id: first?.lease_id, outcome: "ok", transcript: transcript("e2elease001") },
  });
  expect(late.status()).toBe(409);
  expect(((await late.json()) as { error: { code: string } }).error.code).toBe("stale_lease");
  expect((await request.get("/ops/transcripts/e2elease001", { headers: ops })).status()).toBe(404);

  const [second] = await claim(request, b ?? "", 1);
  expect(second?.video_id).toBe("e2elease001");
  expect(await jobStatus(request, "e2elease001")).toMatchObject({ status: "leased", leased_by: "e2e-b", tried_nodes: ["e2e-a", "e2e-b"] });
});

test("E2E-16: unavailable on 3 nodes gives failed_video and a 4th node gets nothing", async ({ request }) => {
  await reset(request);
  const tokens = await Promise.all(["e2e-a", "e2e-b", "e2e-c", "e2e-d"].map((id) => enroll(request, id)));
  await enqueue(request, ["e2efail0001"]);
  for (const token of tokens.slice(0, 3)) {
    const [lease] = await claim(request, token, 1);
    expect(lease?.video_id).toBe("e2efail0001");
    const response = await request.post("/node/result", {
      headers: bearer(token),
      data: { lease_id: lease?.lease_id, outcome: "unavailable", transcript: null },
    });
    expect(response.status()).toBe(200);
  }
  expect(await jobStatus(request, "e2efail0001")).toMatchObject({ status: "failed_video", attempts: 3, last_outcome: "unavailable" });
  expect(await claim(request, tokens[3] ?? "", 3)).toEqual([]);
});

test("E2E-20: a revoked node is refused and its job is reassigned", async ({ request }) => {
  await reset(request);
  const [a, b] = await Promise.all(["e2e-a", "e2e-b"].map((id) => enroll(request, id)));
  await enqueue(request, ["e2erevoke01"]);
  const [lease] = await claim(request, a ?? "", 1);

  const revoked = await request.delete("/ops/nodes/e2e-a", { headers: ops });
  expect(await revoked.json()).toEqual({ node_id: "e2e-a", state: "disabled" });
  expect((await request.post("/node/claim", { headers: bearer(a ?? ""), data: {} })).status()).toBe(401);
  const result = await request.post("/node/result", {
    headers: bearer(a ?? ""),
    data: { lease_id: lease?.lease_id, outcome: "ok", transcript: transcript("e2erevoke01") },
  });
  expect(result.status()).toBe(401);
  expect(await jobStatus(request, "e2erevoke01")).toMatchObject({ status: "queued", last_outcome: "lease_revoked" });

  const [next] = await claim(request, b ?? "", 1);
  expect(next?.video_id).toBe("e2erevoke01");
});

test("E2E-21: /node/* responses hold no user data", async ({ request }) => {
  await reset(request);
  const token = await enroll(request, "e2e-a");
  await enqueue(request, ["e2edata0001", "e2edata0002"]);
  const bodies: unknown[] = [];
  const post = async (path: string, data: unknown): Promise<void> => {
    const response = await request.post(path, { headers: bearer(token), data });
    bodies.push(await response.json());
  };
  await post("/node/heartbeat", { version: "0.1.0", uptime_s: 1, jobs_in_progress: 0 });
  const leases = await claim(request, token, 2);
  bodies.push({ jobs: leases });
  await post("/node/result", {
    lease_id: leases[0]?.lease_id,
    outcome: "ok",
    transcript: { ...transcript("e2edata0001"), pages: ["alpha beta gamma"] },
  });
  await post("/node/release", { lease_id: leases[1]?.lease_id });
  await post("/node/result", { lease_id: "unknown", outcome: "error", transcript: null });

  const allowed = new Set(["node_id", "state", "hourly_budget", "directive", "jobs", "video_id", "lease_id", "lease_expires_at", "status", "error", "code", "message"]);
  const keys = (value: unknown): string[] =>
    Array.isArray(value) ? value.flatMap(keys) : typeof value === "object" && value !== null ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]) : [];
  const text = JSON.stringify(bodies);
  expect(bodies).toHaveLength(5);
  for (const key of keys(bodies)) expect(allowed.has(key)).toBe(true);
  for (const secret of ["alpha", "beta", "gamma", "@", token]) expect(text).not.toContain(secret);
});
