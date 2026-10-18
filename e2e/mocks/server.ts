import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.MOCKS_PORT ?? "8789");
const clientId = process.env.GOOGLE_CLIENT_ID ?? "yt-digest-local";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "local-google-secret";
const issuer = `http://127.0.0.1:${port}/google`;
const CODE_TTL_MS = 60_000;
const TOKEN_TTL_SECONDS = 3600;

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", use: "sig" };
const kid = createHash("sha256").update(JSON.stringify(jwk)).digest("hex").slice(0, 16);

interface Grant {
  email: string;
  scope: string;
  nonce?: string;
}
interface Code extends Grant {
  redirectUri: string;
  offline: boolean;
  expiresAt: number;
}
const codes = new Map<string, Code>();
const accessTokens = new Map<string, Grant>();
const refreshTokens = new Map<string, Grant>();

const b64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");
const token = (): string => randomBytes(32).toString("base64url");
const subject = (email: string): string => `g-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;

function idToken({ email, nonce }: Grant): string {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, aud: clientId, sub: subject(email), email, email_verified: true, iat, exp: iat + TOKEN_TTL_SECONDS, ...(nonce === undefined ? {} : { nonce }) };
  const input = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }))}.${b64url(JSON.stringify(claims))}`;
  return `${input}.${b64url(sign("RSA-SHA256", Buffer.from(input), privateKey))}`;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}
function text(res: ServerResponse, status: number, body: string, type = "text/plain"): void {
  res.writeHead(status, { "Content-Type": type }).end(body);
}

const escapeHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function authorize(url: URL, res: ServerResponse): void {
  const q = url.searchParams;
  const redirectUri = q.get("redirect_uri");
  const scopes = (q.get("scope") ?? "").split(/\s+/);
  if (q.get("client_id") !== clientId || redirectUri === null || q.get("response_type") !== "code" || !scopes.includes("openid")) {
    return text(res, 400, "Bad Request");
  }
  const hint = q.get("login_hint");
  if (hint === null || hint === "") {
    const hidden = [...q].filter(([k]) => k !== "login_hint").map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`);
    const page = `<!doctype html><html><body><form method="get" action="/google/authorize">${hidden.join("")}<input type="text" name="login_hint"><button type="submit">Sign in</button></form></body></html>`;
    return text(res, 200, page, "text/html; charset=utf-8");
  }
  const code = token();
  codes.set(code, {
    email: hint.toLowerCase(),
    scope: q.get("scope") ?? "",
    ...(q.has("nonce") ? { nonce: q.get("nonce") ?? "" } : {}),
    redirectUri,
    offline: q.get("access_type") === "offline",
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (q.has("state")) target.searchParams.set("state", q.get("state") ?? "");
  res.writeHead(302, { Location: target.toString() }).end();
}

function tokenResponse(grant: Grant, refresh?: string): Record<string, unknown> {
  const access = token();
  accessTokens.set(access, grant);
  return { access_token: access, token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS, scope: grant.scope, id_token: idToken(grant), ...(refresh === undefined ? {} : { refresh_token: refresh }) };
}

function exchange(req: IncomingMessage, form: URLSearchParams, res: ServerResponse): void {
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (basic !== undefined) {
    const decoded = Buffer.from(basic, "base64").toString();
    const colon = decoded.indexOf(":");
    [id, secret] = [decodeURIComponent(decoded.slice(0, colon)), decodeURIComponent(decoded.slice(colon + 1))];
  }
  if (id !== clientId || secret !== clientSecret) return send(res, 401, { error: "invalid_client" });
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = codes.get(form.get("code") ?? "");
    codes.delete(form.get("code") ?? "");
    if (code !== undefined && code.expiresAt > Date.now() && code.redirectUri === form.get("redirect_uri")) {
      const refresh = code.offline ? token() : undefined;
      const grant: Grant = { email: code.email, scope: code.scope, ...(code.nonce === undefined ? {} : { nonce: code.nonce }) };
      if (refresh !== undefined) refreshTokens.set(refresh, grant);
      return send(res, 200, tokenResponse(grant, refresh));
    }
  } else if (grantType === "refresh_token") {
    const grant = refreshTokens.get(form.get("refresh_token") ?? "");
    if (grant !== undefined) return send(res, 200, tokenResponse({ email: grant.email, scope: grant.scope }));
  }
  send(res, 400, { error: "invalid_grant" });
}

function userinfo(req: IncomingMessage, res: ServerResponse): void {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  const grant = bearer === undefined ? undefined : accessTokens.get(bearer);
  if (grant === undefined) return send(res, 401, { error: "invalid_token" });
  send(res, 200, { sub: subject(grant.email), email: grant.email, email_verified: true });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const { pathname } = url;
    const get = req.method === "GET";
    if (get && pathname === "/health") send(res, 200, { status: "ok" });
    else if (get && pathname === "/google/.well-known/openid-configuration") {
      send(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        revocation_endpoint: `${issuer}/revoke`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    } else if (get && pathname === "/google/authorize") authorize(url, res);
    else if (req.method === "POST" && pathname === "/google/token") exchange(req, new URLSearchParams(await readBody(req)), res);
    else if (get && pathname === "/google/userinfo") userinfo(req, res);
    else if (get && pathname === "/google/jwks") send(res, 200, { keys: [{ ...jwk, kid }] });
    else if (req.method === "POST" && pathname === "/google/revoke") {
      await readBody(req);
      send(res, 200, {});
    } else text(res, 404, "Not Found");
  })();
});

server.listen(port, "127.0.0.1", () => console.log(`mocks: listening on http://127.0.0.1:${port}`));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));
