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
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}
