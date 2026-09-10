import { handleApi, processReview } from "./api";
import { authFor } from "./auth";
import { databaseForInvocation } from "./database";
import { personalCollectionEnabled, personalCollectionUnavailable } from "./data-policy";
import type { Env } from "./env";
import { json, serverUnavailable } from "./http";

function isExpectedServiceError(error: unknown): boolean {
  return error instanceof Error && /connect|database|ECONNREFUSED|timeout/i.test(error.message);
}

function hasReviewId(value: unknown): value is { reviewId: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "reviewId" in value && typeof value.reviewId === "string";
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname === "/api/health" && request.method === "GET") return json({ status: "ok" });
    if (url.pathname === "/api/personal-availability" && request.method === "GET") {
      return json({ collectionEnabled: personalCollectionEnabled(env) });
    }
    if (!personalCollectionEnabled(env)) return serverUnavailable(personalCollectionUnavailable);

    let pool: ReturnType<typeof databaseForInvocation> | undefined;
    try {
      pool = databaseForInvocation(env);
      if (url.pathname.startsWith("/api/auth/")) {
        return await authFor(env, pool).handler(request);
      }
      return await handleApi(request, env, ctx, pool);
    } catch (error) {
      if (isExpectedServiceError(error)) return serverUnavailable("The data service is unavailable. Nothing was recorded.");
      return json({ error: "The request could not be completed. Nothing new was published." }, { status: 500 });
    } finally {
      await pool?.end();
    }
  },

  async queue(batch, env): Promise<void> {
    const pool = databaseForInvocation(env);
    try {
      for (const message of batch.messages) {
        const body = message.body;
        if (!hasReviewId(body)) {
          message.ack();
          continue;
        }
        try {
          await processReview(body.reviewId, env, pool);
          message.ack();
        } catch {
          // A transient database failure is retried by Cloudflare Queues. The
          // review record itself keeps the frozen evidence set and remains the
          // recovery source if dispatch was lost after an attempt completed.
          message.retry();
        }
      }
    } finally {
      await pool.end();
    }
  },
} satisfies ExportedHandler<Env>;
