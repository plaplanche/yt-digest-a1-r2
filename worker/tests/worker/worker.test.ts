import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";
import worker, { type Env } from "../../src/index";
import pkg from "../../package.json";
import errorSchema from "../../../contracts/error.schema.json";
import Ajv from "ajv/dist/2020";

const validateError = new Ajv({ strict: false }).compile(errorSchema);

function call(path: string, init?: RequestInit, bindings: Env = env): Promise<Response> {
  return worker.fetch(new Request(`http://worker.test${path}`, init), bindings);
}

async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/json");
  const body: unknown = await res.json();
  expect(validateError(body)).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

const COLUMNS: Record<string, string[]> = {
  nodes: ["node_id", "owner_label", "token_hash", "state", "state_since", "last_heartbeat_at", "version", "hourly_budget", "created_at", "revoked_at"],
  jobs: ["video_id", "kind", "priority", "status", "leased_by", "lease_id", "lease_expires_at", "attempts", "tried_nodes", "last_outcome", "created_at", "done_at"],
  leases: ["lease_id", "video_id", "node_id", "issued_at", "expires_at", "state", "response_json"],
  node_events: ["node_id", "ts", "kind", "video_id"],
  invites: ["email", "invited_at", "accepted_user_sub", "revoked"],
  users: ["user_sub", "email", "role", "google_refresh_token_enc", "created_at"],
  oauth_clients: ["client_id", "client_name", "redirect_uris", "created_at"],
  oauth_requests: ["request_id", "client_id", "redirect_uri", "client_state", "code_challenge", "scope", "resource", "google_state", "google_nonce", "expires_at", "used_at"],
  oauth_codes: ["code_hash", "client_id", "user_sub", "redirect_uri", "code_challenge", "scope", "resource", "expires_at", "used_at"],
  oauth_tokens: ["token_hash", "kind", "client_id", "user_sub", "family_id", "scope", "resource", "expires_at", "used_at", "revoked_at"],
};

describe("migrations", () => {
  for (const [table, columns] of Object.entries(COLUMNS)) {
    test(`${table} has its columns`, async () => {
      const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>();
      const names = results.map((r: { name: string }) => r.name);
      for (const column of columns) expect(names).toContain(column);
    });
  }

  test("defaults and keys", async () => {
    await env.DB.prepare("INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES ('n', 'o', 'h', 'healthy', 't', 't')").run();
    expect((await env.DB.prepare("SELECT hourly_budget FROM nodes").first<{ hourly_budget: number }>())?.hourly_budget).toBe(60);
    const insertJob = env.DB.prepare("INSERT INTO jobs (video_id, kind, status, created_at) VALUES ('aaaaaaaaaaa', 'primary', 'queued', 't')");
    await insertJob.run();
    await expect(insertJob.run()).rejects.toThrow();
    await env.DB.prepare("DELETE FROM nodes").run();
    await env.DB.prepare("DELETE FROM jobs").run();
  });
});

describe("conventions", () => {
  test("/health answers the package version", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ status: "ok", version: pkg.version });
  });

  test("unknown route and wrong method give 404 not_found", async () => {
    await expectError(await call("/nope"), 404, "not_found");
    await expectError(await call("/health", { method: "POST" }), 404, "not_found");
  });
});

describe("operator authentication", () => {
  const token = "ops-test-token";
  const callWith = (opsToken: string | undefined, path: string, init: RequestInit = {}) =>
    call(path, init, { DB: env.DB, TRANSCRIPTS: env.TRANSCRIPTS, OPS_TOKEN: opsToken });

  test("401 without bearer or with a wrong one, whatever the body", async () => {
    for (const headers of [{} as Record<string, string>, { Authorization: "Bearer wrong" }, { Authorization: `Basic ${token}` }, { Authorization: "Bearer " }]) {
      await expectError(await callWith(token, "/ops/reset", { method: "POST", headers }), 401, "unauthorized");
      await expectError(await callWith(token, "/ops/reset", { method: "POST", headers, body: "{not json" }), 401, "unauthorized");
      await expectError(await callWith(token, "/ops/anything", { method: "GET", headers }), 401, "unauthorized");
    }
  });

  test("404 when OPS_TOKEN is empty or unset", async () => {
    for (const value of ["", undefined]) {
      const headers = { Authorization: "Bearer " };
      await expectError(await callWith(value, "/ops/reset", { method: "POST", headers }), 404, "not_found");
      await expectError(await callWith(value, "/ops/reset", { method: "POST" }), 404, "not_found");
    }
  });

  test("authenticated unknown ops route gives 404", async () => {
    await expectError(await callWith(token, "/ops/nope", { headers: { Authorization: `Bearer ${token}` } }), 404, "not_found");
    await expectError(await callWith(token, "/ops/reset", { headers: { Authorization: `Bearer ${token}` } }), 404, "not_found");
  });

  describe("POST /ops/reset", () => {
    beforeEach(async () => {
      await env.DB.prepare("INSERT INTO nodes (node_id, owner_label, token_hash, state, state_since, created_at) VALUES ('n', 'o', 'h', 'healthy', 't', 't')").run();
      await env.DB.prepare("INSERT INTO invites (email, invited_at) VALUES ('a@b', 't')").run();
      await env.DB.prepare("INSERT INTO node_events (node_id, ts, kind) VALUES ('n', 't', 'job_ok')").run();
      for (let i = 0; i < 3; i++) await env.TRANSCRIPTS.put(`transcripts/v${i}.json`, "{}");
      await env.TRANSCRIPTS.put("other/keep.json", "{}");
    });

    test("empties every table and every transcript object", async () => {
      const res = await callWith(token, "/ops/reset", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      for (const table of Object.keys(COLUMNS)) {
        expect((await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>())?.c).toBe(0);
      }
      expect((await env.TRANSCRIPTS.list({ prefix: "transcripts/" })).objects).toHaveLength(0);
      expect((await env.TRANSCRIPTS.list({ prefix: "other/" })).objects).toHaveLength(1);
      await env.TRANSCRIPTS.delete("other/keep.json");
    });

    test("does nothing when unauthenticated", async () => {
      await expectError(await callWith(token, "/ops/reset", { method: "POST" }), 401, "unauthorized");
      expect((await env.DB.prepare("SELECT COUNT(*) AS c FROM nodes").first<{ c: number }>())?.c).toBe(1);
      expect((await env.TRANSCRIPTS.list({ prefix: "transcripts/" })).objects).toHaveLength(3);
    });
  });
});
