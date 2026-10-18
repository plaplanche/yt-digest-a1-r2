import { errorResponse, json } from "./http";
import { log } from "./log";
import { base, type OAuthEnv } from "./oauth";
import { verifyAccessToken } from "./token";

export interface McpEnv extends OAuthEnv {
  ALLOWED_ORIGINS?: string;
}

const PROTOCOL_VERSION = "2025-06-18";
const TOOL = "list_subscriptions";

const rpcError = (id: unknown, code: number, message: string, status = 200): Response =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);

// 11.2: runs before the authentication.
function originAllowed(request: Request, env: McpEnv): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  const allowed = [new URL(base(env, request)).origin, ...(env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim().replace(/\/+$/, ""))];
  return allowed.includes(origin);
}

function unauthorized(request: Request, env: McpEnv): Response {
  const header = request.headers.get("Authorization");
  const reason = header === null || !/^Bearer .+$/.test(header) ? "missing" : "unknown";
  log("auth.bearer.rejected", { level: "warn", attrs: { surface: "mcp", reason } });
  return new Response(JSON.stringify({ error: "invalid_token", error_description: "Missing or invalid access token" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${base(env, request)}/.well-known/oauth-protected-resource"`,
    },
  });
}

// 11.1 and 11.3: stateless, every answer is plain JSON.
export async function handleMcp(request: Request, env: McpEnv): Promise<Response> {
  if (!originAllowed(request, env)) {
    log("auth.origin.rejected", { level: "warn", attrs: { origin: request.headers.get("Origin") ?? "" } });
    return errorResponse(403, "origin_rejected", "Origin not allowed");
  }
  if ((await verifyAccessToken(request, env)) === null) return unauthorized(request, env);

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (typeof message !== "object" || message === null || Array.isArray(message)) return rpcError(null, -32600, "Invalid Request", 400);
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof method !== "string") return rpcError(id, -32600, "Invalid Request", 400);
  if (id === undefined) return new Response(null, { status: 202 });

  switch (method) {
    case "initialize":
      return json({
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "yt-digest", version: "0.1.0" } },
      });
    case "ping":
      return json({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      return json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: TOOL,
              description: "List the YouTube subscriptions of the signed-in user.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    case "tools/call": {
      const started = Date.now();
      const name = typeof params === "object" && params !== null ? (params as { name?: unknown }).name : undefined;
      if (name !== TOOL) {
        log("mcp.tool.call", { attrs: { tool: typeof name === "string" ? name : "", outcome: "error", duration_ms: Date.now() - started } });
        return rpcError(id, -32602, "Unknown tool");
      }
      const result = { content: [{ type: "text", text: JSON.stringify({ subscriptions: [] }) }], isError: false };
      log("mcp.tool.call", { attrs: { tool: TOOL, outcome: "ok", duration_ms: Date.now() - started } });
      return json({ jsonrpc: "2.0", id, result });
    }
    default:
      return rpcError(id, -32601, "Method not found");
  }
}
