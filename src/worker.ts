import type { Pool } from "pg";
import { betterAuthSessions } from "./auth";
import { databaseForInvocation } from "./database";
import type { Env } from "./env";
import { handleRequest } from "./request-handler";
import { consumeReviews } from "./review-queue";
export { VoiceSession } from "./voice-session";

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
      await consumeReviews(batch.messages, env, pool);
    } finally {
      await pool.end();
    }
  },
} satisfies ExportedHandler<Env>;
