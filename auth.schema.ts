import { betterAuth } from "better-auth";

/**
 * This config is intentionally database-free so Better Auth's CLI can generate
 * the PostgreSQL schema before hosted Hyperdrive credentials exist. The Worker
 * supplies its PostgreSQL pool at runtime in src/auth.ts.
 */
export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
  },
  user: {
    modelName: "users",
    fields: {
      name: "display_name",
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    additionalFields: {
      default_input_mode: {
        type: ["text", "voice"],
        required: false,
        defaultValue: "text",
        input: false,
      },
      default_save_audio: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  session: {
    modelName: "auth_sessions",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    cookieCache: {
      enabled: false,
    },
  },
  account: {
    modelName: "auth_accounts",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "auth_verifications",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
});
