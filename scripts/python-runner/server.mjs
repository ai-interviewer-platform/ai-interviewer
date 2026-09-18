import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { limits, validateRequest } from "./contract.mjs";

export function createRunnerServer(run, token) {
  const expected = Buffer.from(`Bearer ${token}`);
  return createServer({ requestTimeout: 10_000, headersTimeout: 5000, maxHeaderSize: 8192 }, async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    const received = Buffer.from(request.headers.authorization ?? "");
    if (received.length !== expected.length || !timingSafeEqual(received, expected) || request.headers.origin) return reply(403, { error: "Forbidden" });
    if (request.method !== "POST" || request.url !== "/run") return reply(404, { error: "Not found" });
    if (request.headers["content-type"]?.split(";")[0] !== "application/json") return reply(415, { error: "Expected application/json" });
    let body;
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > limits.requestBytes) return reply(413, { error: "Request exceeds 256 KiB" });
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return reply(400, { error: "Malformed JSON request" }); }
    if (!validateRequest(body)) return reply(400, { error: "Invalid runner request, test IDs, entry point, or unsupported test contract" });
    try { reply(200, await run(body)); }
    catch { reply(503, { error: "Runner infrastructure unavailable" }); }
  });
}
