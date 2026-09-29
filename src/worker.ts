import type { Pool } from "pg";
import { betterAuthSessions } from "./auth";
import { databaseForInvocation } from "./database";
import type { Env } from "./env";
import { logOperationalEvent } from "./observability";
import { handleRequest } from "./request-handler";
import { processReview } from "./reviews";
export { VoiceSession } from "./voice-session";

function hasReviewId(value: unknown): value is { reviewId: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "reviewId" in value && typeof value.reviewId === "string";
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    let pool: Pool | undefined;
    try {
      return await handleRequest(request, env, ctx, {
        database: () => (pool ??= databaseForInvocation(env)),
        sessions: (database) => betterAuthSessions(env, database),
      });
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
          // Transient provider/database failures are retried by Cloudflare Queues. The
          // review record itself keeps the frozen evidence set and remains the
          // recovery source if dispatch was lost after an attempt completed.
          logOperationalEvent("warn", "review_queue_retry");
          message.retry();
        }
      }
    } finally {
      await pool.end();
    }
  },
} satisfies ExportedHandler<Env>;
