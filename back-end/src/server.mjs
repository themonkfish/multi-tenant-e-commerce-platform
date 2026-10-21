import { createServer } from "node:http";

const port = Number(process.env.PORT ?? "4000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (requestUrl.pathname === "/health" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "healthy" }));
    return;
  }

  if (requestUrl.pathname === "/health") {
    response.writeHead(405, {
      allow: "GET",
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.info(`Backend scaffold listening on http://127.0.0.1:${port}`);
});
