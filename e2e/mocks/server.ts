import { createServer } from "node:http";

const port = Number(process.env.MOCKS_PORT ?? "8789");

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok" }));
  } else if (req.method === "GET" && pathname === "/sponsorblock/api/skipSegments") {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`mocks: listening on http://127.0.0.1:${port}`));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));
