import { limits } from "./security";

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

export function unauthorized(): Response {
  return json({ error: "Sign in is required." }, { status: 401 });
}

export function forbidden(): Response {
  return json({ error: "You do not have access to this record." }, { status: 403 });
}

export function notFound(): Response {
  return json({ error: "Not found." }, { status: 404 });
}

export function serverUnavailable(message: string): Response {
  return json({ error: message }, { status: 503 });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export async function requestBody(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  try {
    const body: unknown = JSON.parse(await request.text());
    if (!isRecord(body)) return null;
    const fields = Object.values(body).flatMap(value => isRecord(value) ? Object.values(value) : [value]);
    if (fields.some(value => typeof value === "string" && new TextEncoder().encode(value).length > limits.textBytes)) return null;
    return body;
  } catch {
    return null;
  }
}

export async function boundedRequest(request: Request): Promise<Request | Response> {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limits.requestBytes) {
      await reader.cancel();
      return json({ error: "Request exceeds 256 KiB." }, { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  // The body guard above excludes bodyless GET and HEAD requests.
  // eslint-disable-next-line unicorn/no-invalid-fetch-options
  return new Request(request, { method: request.method, body: bytes });
}

export function checkOrigin(request: Request, baseURL: string): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  if (request.headers.get("origin") !== new URL(baseURL).origin) {
    return json({ error: "The request origin is not allowed." }, { status: 403 });
  }
  return null;
}
