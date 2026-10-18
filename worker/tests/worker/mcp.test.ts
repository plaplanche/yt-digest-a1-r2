import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { sha256Hex } from "../../src/http";
import worker from "../../src/index";

const OPS = "ops-test-token";
const BASE = "http://worker.test";
const bindings = { DB: env.DB, TRANSCRIPTS: env.TRANSCRIPTS, OPS_TOKEN: OPS, PUBLIC_URL: BASE, ADMIN_EMAIL: "alice@test", ALLOWED_ORIGINS: "http://client.test, http://other.test" };

const call = (path: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(`${BASE}${path}`, init), bindings);
const ops = (path: string, body?: unknown) =>
  call(path, { method: "POST", headers: { Authorization: `Bearer ${OPS}` }, body: body === undefined ? undefined : JSON.stringify(body) });
const rpc = (message: unknown, token?: string, headers: Record<string, string> = {}) =>
  call("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }), ...headers },
    body: JSON.stringify(message),
  });

let n = 0;
async function accessToken(email: string, over: { expires_at?: string; resource?: string } = {}): Promise<string> {
  const token = `access-${++n}-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT OR IGNORE INTO users (user_sub, email, role, created_at) VALUES (?, ?, 'member', ?)")
    .bind(`sub-${email}`, email, new Date().toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO oauth_tokens (token_hash, kind, client_id, user_sub, family_id, scope, resource, expires_at) VALUES (?, 'access', 'c1', ?, 'f1', 'digest', ?, ?)",
  )
    .bind(await sha256Hex(token), `sub-${email}`, over.resource ?? `${BASE}/mcp`, over.expires_at ?? new Date(Date.now() + 60_000).toISOString())
    .run();
  return token;
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

async function expectInvalidToken(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  expect(res.headers.get("WWW-Authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_token");
}

beforeEach(async () => {
  expect((await ops("/ops/reset")).status).toBe(200);
  expect((await ops("/ops/invites", { email: "bob@test" })).status).toBe(200);
});

describe("POST /mcp authentication (11.1)", () => {
  test("refuses no token, an unknown token, an expired token and a token of another resource", async () => {
    await expectInvalidToken(await rpc(initialize));
    await expectInvalidToken(await rpc(initialize, "nope"));
    await expectInvalidToken(await rpc(initialize, await accessToken("bob@test", { expires_at: new Date(Date.now() - 1000).toISOString() })));
    await expectInvalidToken(await rpc(initialize, await accessToken("bob@test", { resource: `${BASE}/other` })));
  });

  test("refuses a node token and the operator token", async () => {
    const enrolled = (await (await ops("/ops/nodes", { node_id: "n1", owner_label: "x" })).json()) as { token: string };
    await expectInvalidToken(await rpc(initialize, enrolled.token));
    await expectInvalidToken(await rpc(initialize, OPS));
  });

  test("refuses the token of a user whose invite was revoked", async () => {
    const token = await accessToken("bob@test");
    expect((await rpc(initialize, token)).status).toBe(200);
    expect((await ops("/ops/invites/revoke", { email: "bob@test" })).status).toBe(200);
    await expectInvalidToken(await rpc(initialize, token));
  });

  test("an access token is refused on /node/*", async () => {
    const token = await accessToken("bob@test");
    const res = await call("/node/heartbeat", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" });
    expect(res.status).toBe(401);
  });

  test("logs auth.bearer.rejected with surface mcp", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    await rpc(initialize);
    await rpc(initialize, "nope");
    spy.mockRestore();
    const events = lines.map((l) => JSON.parse(l) as { event: string; attrs: Record<string, string> }).filter((e) => e.event === "auth.bearer.rejected");
    expect(events.map((e) => e.attrs)).toEqual([
      { surface: "mcp", reason: "missing" },
      { surface: "mcp", reason: "unknown" },
    ]);
  });
});

describe("Origin check (11.2)", () => {
  test("a foreign Origin gets 403 origin_rejected before authentication and is logged", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    const res = await rpc(initialize, undefined, { Origin: "http://evil.test" });
    spy.mockRestore();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("origin_rejected");
    expect(lines.map((l) => JSON.parse(l) as { event: string; attrs: Record<string, string> })).toContainEqual(
      expect.objectContaining({ event: "auth.origin.rejected", attrs: { origin: "http://evil.test" } }),
    );
    // Even with a valid token.
    expect((await rpc(initialize, await accessToken("bob@test"), { Origin: "http://evil.test" })).status).toBe(403);
  });

  test("the origin of BASE, an allowed origin and no Origin pass", async () => {
    const token = await accessToken("bob@test");
    for (const origin of [BASE, "http://client.test", "http://other.test"]) {
      expect((await rpc(initialize, token, { Origin: origin })).status).toBe(200);
    }
    expect((await rpc(initialize, token)).status).toBe(200);
    // An allowed origin still needs a token.
    expect((await rpc(initialize, undefined, { Origin: "http://client.test" })).status).toBe(401);
  });
});

describe("MCP messages (11.1, 11.3)", () => {
  let token: string;
  beforeEach(async () => {
    token = await accessToken("bob@test");
  });

  test("initialize answers protocolVersion 2025-06-18", async () => {
    const res = await rpc(initialize, token);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = (await res.json()) as { id: number; result: { protocolVersion: string } };
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-06-18");
  });

  test("a notification gets 202 without a body", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, token);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  test("ping answers an empty result", async () => {
    expect(await (await rpc({ jsonrpc: "2.0", id: 2, method: "ping" }, token)).json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  test("tools/list returns exactly list_subscriptions", async () => {
    const body = (await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, token)).json()) as {
      result: { tools: { name: string; inputSchema: { type: string; properties: object } }[] };
    };
    expect(body.result.tools.map((t) => t.name)).toEqual(["list_subscriptions"]);
    expect(body.result.tools[0]?.inputSchema).toMatchObject({ type: "object", properties: {} });
  });

  test("tools/call list_subscriptions returns an empty list and logs mcp.tool.call", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    const res = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_subscriptions", arguments: {} } }, token);
    spy.mockRestore();
    const body = (await res.json()) as { result: { isError: boolean; content: { type: string; text: string }[] } };
    expect(body.result.isError).toBe(false);
    expect(body.result.content).toEqual([{ type: "text", text: '{"subscriptions":[]}' }]);
    const event = lines.map((l) => JSON.parse(l) as { event: string; attrs: Record<string, unknown> }).find((e) => e.event === "mcp.tool.call");
    expect(event?.attrs).toMatchObject({ tool: "list_subscriptions", outcome: "ok" });
    expect(typeof event?.attrs.duration_ms).toBe("number");
  });

  test("unknown tool, unknown method and malformed bodies are JSON-RPC errors", async () => {
    const unknownTool = (await (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "x" } }, token)).json()) as { error: { code: number } };
    expect(unknownTool.error.code).toBe(-32602);
    const unknownMethod = (await (await rpc({ jsonrpc: "2.0", id: 6, method: "nope" }, token)).json()) as { error: { code: number } };
    expect(unknownMethod.error.code).toBe(-32601);
    const bad = await call("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });

  test("only POST is routed", async () => {
    expect((await call("/mcp", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
  });
});
