import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import worker from "../../src/index";

const OPS = "ops-test-token";
const bindings = { DB: env.DB, TRANSCRIPTS: env.TRANSCRIPTS, OPS_TOKEN: OPS, LEASE_SECONDS: "10" };

function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers: Record<string, string> = token === undefined ? {} : { Authorization: `Bearer ${token}` };
  return worker.fetch(new Request(`http://worker.test${path}`, { ...init, headers }), bindings);
}

const ops = (path: string, body?: unknown, method = "POST") =>
  call(path, body === undefined ? { method } : { method, body: JSON.stringify(body) }, OPS);
const node = (token: string, path: string, body: unknown = {}) => call(`/node/${path}`, { method: "POST", body: JSON.stringify(body) }, token);

async function enroll(nodeId: string): Promise<string> {
  const res = await ops("/ops/nodes", { node_id: nodeId, owner_label: "Owner" });
  return ((await res.json()) as { token: string }).token;
}

const VIDEO = "video000001";
const transcript = (over: Record<string, unknown> = {}) => ({
  video_id: VIDEO, status: "ok", lang: "en", source: "manual", word_count: 4, truncated: false, sponsor_ratio: null, pages: ["one two\n\nthree four"], ...over,
});

interface Lease { video_id: string; lease_id: string; lease_expires_at: string }
async function claim(token: string, max = 1): Promise<Lease[]> {
  const res = await node(token, "claim", { max_jobs: max });
  return ((await res.json()) as { jobs: Lease[] }).jobs;
}
async function job(id: string = VIDEO): Promise<Record<string, unknown>> {
  return (await (await ops(`/ops/jobs/${id}`, undefined, "GET")).json()) as Record<string, unknown>;
}
const count = async (sql: string): Promise<number> => (await env.DB.prepare(sql).first<{ c: number }>())?.c ?? -1;
const errorCode = async (res: Response): Promise<string> => ((await res.json()) as { error: { code: string } }).error.code;

async function setup(nodes: string[]): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};
  for (const id of nodes) tokens[id] = await enroll(id);
  await ops("/ops/jobs", { video_ids: [VIDEO] });
  return tokens;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T07:00:00.000Z"));
  expect((await ops("/ops/reset")).status).toBe(200);
});
afterEach(() => vi.useRealTimers());

describe("POST /node/result", () => {
  test("ok stores the transcript in R2 with its metadata and completes the job; a retry changes nothing", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    const [lease] = await claim(a);
    const body = { lease_id: lease?.lease_id, outcome: "ok", transcript: transcript() };
    const res = await node(a, "result", body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ video_id: VIDEO, status: "done" });
    const object = await env.TRANSCRIPTS.get(`transcripts/${VIDEO}.json`);
    expect(JSON.parse((await object?.text()) ?? "")).toEqual(transcript());
    expect(object?.httpMetadata?.contentType).toBe("application/json");
    expect(object?.customMetadata).toEqual({ node_id: "a", lease_id: lease?.lease_id, produced_at: "2026-10-16T07:00:00.000Z" });
    expect(await job()).toMatchObject({ status: "done", last_outcome: "ok", done_at: "2026-10-16T07:00:00.000Z", leased_by: null });

    vi.setSystemTime(new Date("2026-10-16T07:05:00.000Z"));
    const again = await node(a, "result", { ...body, transcript: transcript({ pages: ["other"] }) });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ video_id: VIDEO, status: "done" });
    expect((await env.TRANSCRIPTS.get(`transcripts/${VIDEO}.json`))?.customMetadata?.produced_at).toBe("2026-10-16T07:00:00.000Z");
    expect(await count("SELECT COUNT(*) AS c FROM node_events")).toBe(1);

    const stored = await ops(`/ops/transcripts/${VIDEO}`, undefined, "GET");
    expect(await stored.json()).toEqual({ video_id: VIDEO, transcript: transcript(), node_id: "a", lease_id: lease?.lease_id, produced_at: "2026-10-16T07:00:00.000Z" });
    expect((await ops("/ops/transcripts/unknown00000", undefined, "GET")).status).toBe(404);
  });

  test("an existing R2 object is never overwritten", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    await env.TRANSCRIPTS.put(`transcripts/${VIDEO}.json`, "{}");
    const [lease] = await claim(a);
    const res = await node(a, "result", { lease_id: lease?.lease_id, outcome: "ok", transcript: transcript() });
    expect(res.status).toBe(200);
    expect(await (await env.TRANSCRIPTS.get(`transcripts/${VIDEO}.json`))?.text()).toBe("{}");
  });

  test("an object that appears between the check and the write is not overwritten", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    const [lease] = await claim(a);
    const racing = {
      ...env.TRANSCRIPTS,
      put: async (key: string, value: string, options: R2PutOptions) => {
        await env.TRANSCRIPTS.put(key, "{}");
        return env.TRANSCRIPTS.put(key, value, options);
      },
    } as unknown as R2Bucket;
    const request = new Request("http://worker.test/node/result", {
      method: "POST", headers: { Authorization: `Bearer ${a}` }, body: JSON.stringify({ lease_id: lease?.lease_id, outcome: "ok", transcript: transcript() }),
    });
    expect((await worker.fetch(request, { ...bindings, TRANSCRIPTS: racing })).status).toBe(200);
    expect(await (await env.TRANSCRIPTS.get(`transcripts/${VIDEO}.json`))?.text()).toBe("{}");
  });

  test("a lease that expires before the R2 write reserves nothing: 409 and no object", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    const [lease] = await claim(a);
    const racing = {
      // The lease check passes, then the lease reaches its expiry before the reservation.
      prepare: (sql: string) => {
        const statement = env.DB.prepare(sql);
        if (!sql.startsWith("SELECT video_id, node_id, state")) return statement;
        return { bind: (...args: unknown[]) => ({ first: async () => { const row = await statement.bind(...args).first(); vi.setSystemTime(new Date("2026-10-16T07:00:10.000Z")); return row; } }) };
      },
      batch: (statements: D1PreparedStatement[]) => env.DB.batch(statements),
    } as unknown as D1Database;
    const request = new Request("http://worker.test/node/result", {
      method: "POST", headers: { Authorization: `Bearer ${a}` }, body: JSON.stringify({ lease_id: lease?.lease_id, outcome: "ok", transcript: transcript() }),
    });
    const res = await worker.fetch(request, { ...bindings, DB: racing });
    expect(res.status).toBe(409);
    expect(await env.TRANSCRIPTS.get(`transcripts/${VIDEO}.json`)).toBeNull();
    expect(await job()).toMatchObject({ status: "queued", last_outcome: "lease_expired" });
  });

  test("a failing R2 write gives 503, keeps the lease and the job, and a retry succeeds", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    const [lease] = await claim(a);
    const body = { lease_id: lease?.lease_id, outcome: "ok", transcript: transcript() };
    const failing = { ...env.TRANSCRIPTS, put: async () => { throw new Error("r2 down"); } } as unknown as R2Bucket;
    const request = new Request("http://worker.test/node/result", { method: "POST", headers: { Authorization: `Bearer ${a}` }, body: JSON.stringify(body) });
    const res = await worker.fetch(request, { ...bindings, TRANSCRIPTS: failing });
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("storage_error");
    expect(await job()).toMatchObject({ status: "leased" });
    expect(await count(`SELECT COUNT(*) AS c FROM leases WHERE lease_id = '${lease?.lease_id}' AND state = 'active'`)).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM node_events")).toBe(0);
    const retry = await node(a, "result", body);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ video_id: VIDEO, status: "done" });
  });

  test("a claim that races with a revocation leases nothing", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    const racing = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.prepare("UPDATE nodes SET state = 'disabled', revoked_at = 't' WHERE node_id = 'a'").run();
        return env.DB.batch(statements);
      },
    } as unknown as D1Database;
    const request = new Request("http://worker.test/node/claim", {
      method: "POST", headers: { Authorization: `Bearer ${a}` }, body: JSON.stringify({ max_jobs: 1 }),
    });
    await worker.fetch(request, { ...bindings, DB: racing });
    expect(await job()).toMatchObject({ status: "queued" });
    expect(await count("SELECT COUNT(*) AS c FROM leases")).toBe(0);
  });

  test("the marker is not a word", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    const [lease] = await claim(a);
    const res = await node(a, "result", { lease_id: lease?.lease_id, outcome: "ok", transcript: transcript({ word_count: 2, pages: ["one\n\n[…]", "two"] }) });
    expect(res.status).toBe(200);
  });

  test("no_transcript is terminal and writes nothing to R2", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    const [lease] = await claim(a);
    const res = await node(a, "result", { lease_id: lease?.lease_id, outcome: "no_transcript", transcript: null });
    expect(await res.json()).toEqual({ video_id: VIDEO, status: "done" });
    expect(await job()).toMatchObject({ status: "done", last_outcome: "no_transcript" });
    expect((await env.TRANSCRIPTS.list()).objects).toHaveLength(0);
    expect(await count("SELECT COUNT(*) AS c FROM node_events WHERE kind = 'job_no_transcript'")).toBe(1);
  });

  test.each(["unavailable", "blocked", "error"])("%s requeues for another node, and the third failure gives failed_video", async (outcome) => {
    const tokens = await setup(["a", "b", "c", "d"]);
    for (const [i, id] of ["a", "b", "c"].entries()) {
      const [lease] = await claim(tokens[id] ?? "");
      expect(lease?.video_id).toBe(VIDEO);
      const res = await node(tokens[id] ?? "", "result", { lease_id: lease?.lease_id, outcome, transcript: null });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ video_id: VIDEO, status: i < 2 ? "queued" : "failed_video" });
      expect(await claim(tokens[id] ?? "")).toEqual([]);
    }
    expect(await job()).toMatchObject({ status: "failed_video", attempts: 3, tried_nodes: ["a", "b", "c"], last_outcome: outcome, leased_by: null });
    expect((await job()).done_at).not.toBeNull();
    expect(await claim(tokens.d ?? "")).toEqual([]);
    expect(await count(`SELECT COUNT(*) AS c FROM node_events WHERE kind = 'job_${outcome}'`)).toBe(3);
  });

  test("an expired lease requeues the job and its late result gets 409 and writes nothing", async () => {
    const tokens = await setup(["a", "b"]);
    const [first] = await claim(tokens.a ?? "");
    vi.setSystemTime(new Date("2026-10-16T07:00:10.000Z"));
    const late = await node(tokens.a ?? "", "result", { lease_id: first?.lease_id, outcome: "ok", transcript: transcript() });
    expect(late.status).toBe(409);
    expect(await errorCode(late)).toBe("stale_lease");
    expect((await env.TRANSCRIPTS.list()).objects).toHaveLength(0);
    expect(await job()).toMatchObject({ status: "queued", last_outcome: "lease_expired", tried_nodes: ["a"], attempts: 1 });
    expect(await count("SELECT COUNT(*) AS c FROM node_events WHERE kind = 'lease_expired' AND node_id = 'a'")).toBe(1);
    expect(await claim(tokens.a ?? "")).toEqual([]);
    const [second] = await claim(tokens.b ?? "");
    expect(second?.video_id).toBe(VIDEO);
    expect((await node(tokens.b ?? "", "result", { lease_id: second?.lease_id, outcome: "ok", transcript: transcript() })).status).toBe(200);
  });

  test("a lease is still valid one millisecond before lease_expires_at, expired exactly at it", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    const [lease] = await claim(a);
    vi.setSystemTime(new Date("2026-10-16T07:00:09.999Z"));
    expect((await job()).status).toBe("leased");
    vi.setSystemTime(new Date(lease?.lease_expires_at ?? ""));
    expect(await job()).toMatchObject({ status: "queued", last_outcome: "lease_expired" });
  });

  test("an expired third attempt gives failed_video", async () => {
    const tokens = await setup(["a", "b", "c"]);
    for (const [i, id] of ["a", "b", "c"].entries()) {
      await claim(tokens[id] ?? "");
      vi.setSystemTime(new Date(Date.parse("2026-10-16T07:00:10.000Z") + i * 10_000));
    }
    expect(await job()).toMatchObject({ status: "failed_video", attempts: 3 });
  });

  test("409 stale_lease for an unknown lease, another node's lease, a released one; nothing is written", async () => {
    const tokens = await setup(["a", "b"]);
    const [lease] = await claim(tokens.a ?? "");
    const ok = { outcome: "ok", transcript: transcript() };
    expect((await node(tokens.a ?? "", "result", { lease_id: "nope", ...ok })).status).toBe(409);
    expect((await node(tokens.b ?? "", "result", { lease_id: lease?.lease_id, ...ok })).status).toBe(409);
    await node(tokens.a ?? "", "release", { lease_id: lease?.lease_id });
    expect((await node(tokens.a ?? "", "result", { lease_id: lease?.lease_id, ...ok })).status).toBe(409);
    expect((await env.TRANSCRIPTS.list()).objects).toHaveLength(0);
    expect(await count("SELECT COUNT(*) AS c FROM node_events")).toBe(0);
  });

  test("400 on a body that breaks the schema", async () => {
    const { a } = (await setup(["a"])) as { a: string };
    for (const body of [{}, { lease_id: "", outcome: "ok", transcript: null }, { lease_id: "x", outcome: "nope", transcript: null }, { lease_id: "x", outcome: "error" }, { lease_id: "x", outcome: "error", transcript: null, extra: 1 }, { lease_id: "x", outcome: "ok", transcript: { video_id: VIDEO } }]) {
      expect((await node(a, "result", body)).status).toBe(400);
    }
  });

  test.each([
    ["ok with a null transcript", "ok", null],
    ["ok with a transcript whose status is not ok", "ok", transcript({ status: "blocked" })],
    ["ok with another video id", "ok", transcript({ video_id: "other000000" })],
    ["ok with no pages", "ok", transcript({ pages: [], word_count: 0 })],
    ["ok with a wrong word count", "ok", transcript({ word_count: 5 })],
    ["error with a transcript", "error", transcript()],
    ["no_transcript with a transcript", "no_transcript", transcript()],
  ])("422 validation_failed, counted as a failure: %s", async (_name, outcome, body) => {
    const tokens = await setup(["a", "b"]);
    const [lease] = await claim(tokens.a ?? "");
    const res = await node(tokens.a ?? "", "result", { lease_id: lease?.lease_id, outcome, transcript: body });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("validation_failed");
    expect(await job()).toMatchObject({ status: "queued", last_outcome: "validation_failed", attempts: 1 });
    expect((await env.DB.prepare("SELECT state FROM leases").first<{ state: string }>())?.state).toBe("rejected");
    expect(await count("SELECT COUNT(*) AS c FROM node_events WHERE kind = 'validation_failed'")).toBe(1);
    expect((await env.TRANSCRIPTS.list()).objects).toHaveLength(0);
    expect((await node(tokens.a ?? "", "result", { lease_id: lease?.lease_id, outcome: "error", transcript: null })).status).toBe(409);
  });
});

describe("POST /node/release", () => {
  test("undoes the claim and is idempotent", async () => {
    const tokens = await setup(["a", "b"]);
    const [lease] = await claim(tokens.a ?? "");
    const res = await node(tokens.a ?? "", "release", { lease_id: lease?.lease_id });
    expect(await res.json()).toEqual({ video_id: VIDEO, status: "queued" });
    expect(await job()).toMatchObject({ status: "queued", attempts: 0, tried_nodes: [], leased_by: null, lease_expires_at: null, last_outcome: "released" });
    const again = await node(tokens.a ?? "", "release", { lease_id: lease?.lease_id });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ video_id: VIDEO, status: "queued" });
    expect(await job()).toMatchObject({ attempts: 0, tried_nodes: [] });
    expect(await claim(tokens.a ?? "")).toHaveLength(1);
  });

  test("409 for an unknown lease, another node's, and completed, expired ones; 400 on a bad body", async () => {
    const tokens = await setup(["a", "b"]);
    const [lease] = await claim(tokens.a ?? "");
    expect((await node(tokens.a ?? "", "release", { lease_id: "nope" })).status).toBe(409);
    expect((await node(tokens.b ?? "", "release", { lease_id: lease?.lease_id })).status).toBe(409);
    expect((await node(tokens.a ?? "", "release", {})).status).toBe(400);
    vi.setSystemTime(new Date("2026-10-16T07:00:10.000Z"));
    const expired = await node(tokens.a ?? "", "release", { lease_id: lease?.lease_id });
    expect(expired.status).toBe(409);
    expect(await errorCode(expired)).toBe("stale_lease");
    const [next] = await claim(tokens.b ?? "");
    await node(tokens.b ?? "", "result", { lease_id: next?.lease_id, outcome: "no_transcript", transcript: null });
    expect((await node(tokens.b ?? "", "release", { lease_id: next?.lease_id })).status).toBe(409);
  });
});

describe("DELETE /ops/nodes/<node_id>", () => {
  test("revokes the token and the active leases, and the job goes to another node", async () => {
    const tokens = await setup(["a", "b"]);
    const [lease] = await claim(tokens.a ?? "");
    const res = await ops("/ops/nodes/a", undefined, "DELETE");
    expect(await res.json()).toEqual({ node_id: "a", state: "disabled" });
    expect((await node(tokens.a ?? "", "claim")).status).toBe(401);
    expect((await node(tokens.a ?? "", "result", { lease_id: lease?.lease_id, outcome: "error", transcript: null })).status).toBe(401);
    expect(await job()).toMatchObject({ status: "queued", last_outcome: "lease_revoked", leased_by: null, tried_nodes: ["a"] });
    expect((await env.DB.prepare("SELECT state FROM leases").first<{ state: string }>())?.state).toBe("revoked");
    expect(await claim(tokens.b ?? "")).toHaveLength(1);
    const row = await env.DB.prepare("SELECT state, revoked_at FROM nodes WHERE node_id = 'a'").first<{ state: string; revoked_at: string }>();
    expect(row).toEqual({ state: "disabled", revoked_at: "2026-10-16T07:00:00.000Z" });
  });

  test("a revoked lease on the third attempt gives failed_video; again is the same 200; unknown is 404; 401 without the ops token", async () => {
    const tokens = await setup(["a", "b", "c"]);
    await env.DB.prepare("UPDATE jobs SET attempts = 2, tried_nodes = '[\"a\",\"b\"]'").run();
    await claim(tokens.c ?? "");
    expect((await ops("/ops/nodes/c", undefined, "DELETE")).status).toBe(200);
    expect(await job()).toMatchObject({ status: "failed_video", last_outcome: "lease_revoked" });
    const again = await ops("/ops/nodes/c", undefined, "DELETE");
    expect(await again.json()).toEqual({ node_id: "c", state: "disabled" });
    expect((await ops("/ops/nodes/zzz", undefined, "DELETE")).status).toBe(404);
    expect((await call("/ops/nodes/c", { method: "DELETE" })).status).toBe(401);
  });
});

describe("logs", () => {
  test("each end of a lease logs its event, with no transcript text", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const tokens = await setup(["a", "b", "c"]);
      const [first] = await claim(tokens.a ?? "");
      await node(tokens.a ?? "", "result", { lease_id: first?.lease_id, outcome: "ok", transcript: transcript({ word_count: 2, pages: ["secretwords"] }) });
      const [second] = await claim(tokens.b ?? "");
      vi.setSystemTime(new Date("2026-10-16T07:00:10.000Z"));
      await node(tokens.b ?? "", "result", { lease_id: second?.lease_id, outcome: "error", transcript: null });
      const [third] = await claim(tokens.c ?? "");
      await node(tokens.c ?? "", "release", { lease_id: third?.lease_id });
      const [fourth] = await claim(tokens.c ?? "");
      await node(tokens.c ?? "", "result", { lease_id: fourth?.lease_id, outcome: "error", transcript: null });
      await ops("/ops/nodes/c", undefined, "DELETE");
      const lines = spy.mock.calls.map((c) => String(c[0]));
      const events = lines.map((l) => JSON.parse(l) as { event: string; video_id?: string; attrs: Record<string, unknown> });
      const byName = (name: string) => events.filter((e) => e.event === name);
      expect(byName("job.validation_failed")[0]).toMatchObject({ video_id: VIDEO, attrs: { node_id: "a", reason: "word_count_mismatch" } });
      expect(byName("job.lease_expired")[0]).toMatchObject({ video_id: VIDEO, attrs: { node_id: "b", attempts: 2, status: "queued" } });
      expect(byName("job.stale_result")[0]).toMatchObject({ attrs: { node_id: "b" } });
      expect(byName("job.released")[0]).toMatchObject({ video_id: VIDEO, attrs: { node_id: "c" } });
      expect(byName("job.completed")[0]).toMatchObject({ video_id: VIDEO, attrs: { node_id: "c", outcome: "error", status: "failed_video" } });
      expect(byName("node.revoked")[0]).toMatchObject({ attrs: { node_id: "c", leases_revoked: 0 } });
      expect(lines.join("\n")).not.toContain("secretwords");
    } finally {
      spy.mockRestore();
    }
  });
});
