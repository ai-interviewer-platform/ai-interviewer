import type { Pool } from "pg";
import { catalog, routeApi } from "./api";
import { personalCollectionEnabled, personalCollectionUnavailable } from "./data-policy";
import { DEEPGRAM_THINKING_MODEL, DEEPGRAM_VOICE_PROVIDER, deepgramVoiceEnabled } from "./deepgram";
import { emailConfigured } from "./email";
import type { Env } from "./env";
import { boundedRequest, checkOrigin, json, serverUnavailable, unauthorized } from "./http";
import { logOperationalEvent } from "./observability";
import { runtimeCapabilities } from "./runtime-config";
import { consumeRate, userRateLimitKey } from "./security";

// The signed-in user of a request. Production uses better-auth; tests pass a fake.
export interface SessionResolver {
  userId(request: Request): Promise<string | null>;
  passwordMatches(request: Request, password: string): Promise<boolean>;
  // Serves the /api/auth/ routes.
  handle(request: Request): Promise<Response>;
}

export type RequestDependencies = {
  // Called only when a request needs the database; the caller owns the pool lifetime.
  database(): Pool;
  sessions(pool: Pool): SessionResolver;
};

function isExpectedServiceError(error: unknown): boolean {
  return error instanceof Error && /connect|database|ECONNREFUSED|timeout/i.test(error.message);
}

function availability(env: Env): Response {
  const capabilities = runtimeCapabilities(env);
  return json({
    collectionEnabled: personalCollectionEnabled(env),
    emailEnabled: emailConfigured(env),
    voiceEnabled: deepgramVoiceEnabled(env),
    voiceProvider: DEEPGRAM_VOICE_PROVIDER,
    thinkingModel: DEEPGRAM_THINKING_MODEL,
    mvpReady: capabilities.mvpReady,
    services: {
      database: capabilities.databaseConfigured,
      voice: capabilities.voiceConfigured,
      runner: capabilities.runnerConfigured,
      review: capabilities.reviewConfigured && capabilities.reviewQueueConfigured,
    },
  });
}

// The one request pipeline for every /api/ request, in a fixed order: health and
// availability, collection gate, origin, body size limit, session, rate limit, route.
export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext, dependencies: RequestDependencies): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/health" && request.method === "GET") return json({ status: "ok" });
  if (url.pathname === "/api/personal-availability" && request.method === "GET") return availability(env);
  if (!personalCollectionEnabled(env)) return serverUnavailable(personalCollectionUnavailable);
  const originError = checkOrigin(request, env.BETTER_AUTH_URL);
  if (originError) return originError;
  const bounded = await boundedRequest(request);
  if (bounded instanceof Response) return bounded;
  try {
    const pool = dependencies.database();
    const sessions = dependencies.sessions(pool);
    if (url.pathname.startsWith("/api/auth/")) return await sessions.handle(bounded);
    if (url.pathname === "/api/catalog" && request.method === "GET") return await catalog(pool);
    const userId = await sessions.userId(bounded);
    if (!userId) return unauthorized();
    if (!(await consumeRate(pool, userRateLimitKey("api", userId), 60, 120)).allowed) return json({ error: "Too many requests." }, { status: 429 });
    return await routeApi(bounded, env, ctx, { pool, userId, sessions });
  } catch (error) {
    if (isExpectedServiceError(error)) {
      logOperationalEvent("warn", "database_unavailable");
      return serverUnavailable("The data service is unavailable. Nothing was recorded.");
    }
    logOperationalEvent("error", "request_failed");
    return json({ error: "The request could not be completed. Nothing new was published." }, { status: 500 });
  }
}
