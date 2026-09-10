import { Pool } from "pg";
import type { Env } from "./env";

// Hyperdrive pools the origin connections. This object is intentionally
// created inside each Worker invocation, never retained in module scope.
export function databaseForInvocation(env: Env): Pool {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Database connection is not configured. Provide HYPERDRIVE in Cloudflare or DATABASE_URL for local development.");
  }
  return new Pool({ connectionString });
}
