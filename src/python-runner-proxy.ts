// Local-only transport. This Worker never executes Python and has no app bindings.
export default {
  async fetch(request, env): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/run" || new URL(request.url).hostname !== "python-runner") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.LOCAL_RUNNER_TOKEN) return new Response("Local runner is not configured", { status: 503 });
    try {
      return await fetch("http://127.0.0.1:8791/run", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.LOCAL_RUNNER_TOKEN}` },
        body: request.body,
        // workerd supports manual/follow only. Never follow a redirect with
        // the controller token; the API treats non-2xx responses as unavailable.
        redirect: "manual",
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      return new Response("Local runner unavailable", { status: 503 });
    }
  },
} satisfies ExportedHandler<{ LOCAL_RUNNER_TOKEN?: string }>;
