import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import worker from "../../src/index";

const OPS = "ops-test-token";
const bindings = { DB: env.DB, TRANSCRIPTS: env.TRANSCRIPTS, OPS_TOKEN: OPS, LEASE_SECONDS: "600" };

function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers: Record<string, string> = token === undefined ? {} : { Authorization: `Bearer ${token}` };
  return worker.fetch(new Request(`http://worker.test${path}`, { ...init, headers }), bindings);
}

const ops = (path: string, body?: unknown, method = "POST") =>
  call(path, body === undefined ? { method } : { method, body: JSON.stringify(body) }, OPS);
const node = (token: string, path: string, body: unknown = {}) => call(`/node/${path}`, { method: "POST", body: JSON.stringify(body) }, token);

async function enroll(nodeId: string): Promise<string> {
  const res = await ops("/ops/nodes", { node_id: nodeId, owner_label: "Owner" });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const vid = (n: number): string => `video${String(n).padStart(6, "0")}`;

async function job(id: string): Promise<Record<string, unknown>> {
  const res = await ops(`/ops/jobs/${id}`, undefined, "GET");
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function claimIds(token: string, max?: number): Promise<string[]> {
  const res = await node(token, "claim", max === undefined ? {} : { max_jobs: max });
  expect(res.status).toBe(200);
  return ((await res.json()) as { jobs: { video_id: string }[] }).jobs.map((j) => j.video_id);
}

beforeEach(async () => {
  expect((await ops("/ops/reset")).status).toBe(200);
});

describe("POST /ops/nodes", () => {
  test("shows the token once and stores only its hash", async () => {
    const res = await ops("/ops/nodes", { node_id: "pi-1", owner_label: "Home" });
    const body = (await res.json()) as { node_id: string; owner_label: string; token: string };
    expect(res.status).toBe(200);
    expect(body.token).toMatch(/^ytd_node_[A-Za-z0-9_-]{43}$/);
    const row = await env.DB.prepare("SELECT token_hash, state FROM nodes WHERE node_id = 'pi-1'").first<{ token_hash: string; state: string }>();
    expect(row?.state).toBe("healthy");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.token));
    expect(row?.token_hash).toBe(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""));
  });

  test("409 on an existing node, 400 on a bad body", async () => {
    await enroll("pi-1");
    expect((await ops("/ops/nodes", { node_id: "pi-1", owner_label: "x" })).status).toBe(409);
    for (const body of [{ node_id: "Bad", owner_label: "x" }, { node_id: "ok", owner_label: "" }, { node_id: "ok" }, { node_id: "ok", owner_label: "x", extra: 1 }]) {
      expect((await ops("/ops/nodes", body)).status).toBe(400);
    }
  });
});

describe("node authentication", () => {
  test("401 without bearer, with an unknown token and with the operator token", async () => {
    await enroll("pi-1");
    for (const path of ["heartbeat", "claim"]) {
      for (const token of [undefined, "ytd_node_unknown", OPS]) {
        const res = await call(`/node/${path}`, { method: "POST", body: "{}" }, token);
        expect(res.status).toBe(401);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
      }
    }
  });

  test("the token of a revoked node is refused", async () => {
    const token = await enroll("pi-1");
    await env.DB.prepare("UPDATE nodes SET revoked_at = 't', state = 'disabled'").run();
    expect((await node(token, "claim")).status).toBe(401);
  });

  test("a node token is not accepted on /ops", async () => {
    const token = await enroll("pi-1");
    expect((await call("/ops/jobs/aaaaaaaaaaa", {}, token)).status).toBe(401);
  });
});

describe("POST /node/heartbeat", () => {
  const beat = { version: "0.1.0", uptime_s: 5, jobs_in_progress: 0 };

  test("updates the node and answers healthy, run, 60", async () => {
    const token = await enroll("pi-1");
    const res = await node(token, "heartbeat", beat);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ node_id: "pi-1", state: "healthy", hourly_budget: 60, directive: "run" });
    const row = await env.DB.prepare("SELECT version, last_heartbeat_at FROM nodes").first<{ version: string; last_heartbeat_at: string }>();
    expect(row?.version).toBe("0.1.0");
    expect(row?.last_heartbeat_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  });

  test("400 on a body that breaks the schema", async () => {
    const token = await enroll("pi-1");
    for (const body of [{}, { ...beat, extra: 1 }, { ...beat, version: "" }, { ...beat, uptime_s: -1 }, { ...beat, disk_free_ratio: 2 }, []]) {
      expect((await node(token, "heartbeat", body)).status).toBe(400);
    }
    expect((await call("/node/heartbeat", { method: "POST", body: "{nope" }, token)).status).toBe(400);
  });
});

describe("POST /ops/jobs", () => {
  test("enqueues in request order and keeps existing jobs, raising priority only upwards", async () => {
    let res = await ops("/ops/jobs", { video_ids: [vid(1), vid(2)], priority: 5 });
    expect(await res.json()).toEqual({ enqueued: [vid(1), vid(2)], existing: [] });
    res = await ops("/ops/jobs", { video_ids: [vid(2), vid(3), vid(1)], priority: 2 });
    expect(await res.json()).toEqual({ enqueued: [vid(3)], existing: [vid(2), vid(1)] });
    expect((await job(vid(1))).priority).toBe(5);
    expect((await job(vid(3))).priority).toBe(2);
    await ops("/ops/jobs", { video_ids: [vid(3)], priority: 9 });
    expect((await job(vid(3))).priority).toBe(9);
    expect(await job(vid(3))).toMatchObject({ kind: "primary", status: "queued", attempts: 0, tried_nodes: [], leased_by: null, done_at: null });
  });

  test("400 on a bad body, 404 on an unknown job", async () => {
    for (const body of [{}, { video_ids: [] }, { video_ids: ["short"] }, { video_ids: [vid(1)], priority: -1 }, { video_ids: Array(101).fill(vid(1)) }]) {
      expect((await ops("/ops/jobs", body)).status).toBe(400);
    }
    expect((await ops(`/ops/jobs/${vid(9)}`, undefined, "GET")).status).toBe(404);
  });
});

describe("POST /node/claim", () => {
  test("an empty queue gives no jobs", async () => {
    const token = await enroll("pi-1");
    const res = await node(token, "claim");
    expect(await res.json()).toEqual({ jobs: [] });
  });

  test("takes 3 by default, by priority then creation order", async () => {
    const token = await enroll("pi-1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    await new Promise((r) => setTimeout(r, 5));
    await ops("/ops/jobs", { video_ids: [vid(2), vid(3)] });
    await new Promise((r) => setTimeout(r, 5));
    await ops("/ops/jobs", { video_ids: [vid(4)], priority: 7 });
    await ops("/ops/jobs", { video_ids: [vid(5)], priority: 1 });
    expect(await claimIds(token)).toEqual([vid(4), vid(5), vid(1)]);
    expect(await claimIds(token, 1)).toEqual([vid(2)]);
  });

  test("a claimed job is leased with a lease row, attempts 1 and the node in tried_nodes", async () => {
    const token = await enroll("pi-1");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    const res = await node(token, "claim", { max_jobs: 10 });
    const { jobs } = (await res.json()) as { jobs: { video_id: string; lease_id: string; lease_expires_at: string }[] };
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.lease_id.length).toBeGreaterThanOrEqual(16);
    expect(await job(vid(1))).toMatchObject({ status: "leased", attempts: 1, tried_nodes: ["pi-1"], leased_by: "pi-1", lease_expires_at: jobs[0]?.lease_expires_at });
    const lease = await env.DB.prepare("SELECT * FROM leases").first<Record<string, string>>();
    expect(lease).toMatchObject({ lease_id: jobs[0]?.lease_id, video_id: vid(1), node_id: "pi-1", state: "active", expires_at: jobs[0]?.lease_expires_at });
    const seconds = (Date.parse(lease?.expires_at ?? "") - Date.parse(lease?.issued_at ?? "")) / 1000;
    expect(seconds).toBe(600);
  });

  test("a node already in tried_nodes is not given the job", async () => {
    const token = await enroll("pi-1");
    const other = await enroll("pi-2");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    await env.DB.prepare("UPDATE jobs SET status = 'queued', leased_by = NULL, tried_nodes = '[\"pi-1\"]'").run();
    expect(await claimIds(token)).toEqual([]);
    expect(await claimIds(other)).toEqual([vid(1)]);
    expect((await job(vid(1))).tried_nodes).toEqual(["pi-1", "pi-2"]);
  });

  test("a leased job is not handed out again; 400 on a bad max_jobs", async () => {
    const token = await enroll("pi-1");
    const other = await enroll("pi-2");
    await ops("/ops/jobs", { video_ids: [vid(1)] });
    expect(await claimIds(token)).toEqual([vid(1)]);
    expect(await claimIds(other)).toEqual([]);
    for (const body of [{ max_jobs: 0 }, { max_jobs: 11 }, { max_jobs: 1.5 }, { other: 1 }]) {
      expect((await node(token, "claim", body)).status).toBe(400);
    }
  });

  test("concurrent claims never hand out a job twice and none comes back short", async () => {
    const tokens = await Promise.all(["n-1", "n-2", "n-3", "n-4"].map(enroll));
    const ids = Array.from({ length: 12 }, (_, i) => vid(i));
    await ops("/ops/jobs", { video_ids: ids });
    const claims = await Promise.all(tokens.map((t) => claimIds(t, 3)));
    expect(claims.map((c) => c.length)).toEqual([3, 3, 3, 3]);
    expect(new Set(claims.flat()).size).toBe(12);

    await ops("/ops/reset");
    const fresh = await Promise.all(["m-1", "m-2", "m-3"].map(enroll));
    await ops("/ops/jobs", { video_ids: ids.slice(0, 7) });
    const second = await Promise.all(fresh.map((t) => claimIds(t, 3)));
    expect(second.map((c) => c.length).sort()).toEqual([1, 3, 3]);
    expect(new Set(second.flat()).size).toBe(7);
    const leases = await env.DB.prepare("SELECT COUNT(*) AS c FROM leases").first<{ c: number }>();
    expect(leases?.c).toBe(7);
  });
});
