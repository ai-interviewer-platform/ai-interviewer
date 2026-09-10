import { defineConfig } from "drizzle-kit";

// The Better Auth CLI owns src/db/generated-auth.ts. Drizzle Kit translates
// that generated PostgreSQL schema into the checked-in SQL migration below.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/generated-auth.ts",
  out: "./migrations/auth",
});
