import { betterAuth, type BetterAuthOptions } from "better-auth";
import { isAPIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Env } from "./env";
import * as schema from "./db/generated-auth";
import { emailConfigured, passwordResetText, sendEmail, verificationText } from "./email";
import { consumeRate } from "./security";

type AuthInstance = ReturnType<typeof betterAuth>;

function authOptions(pool: Pool, env: Env): BetterAuthOptions {
  // Links are built from BETTER_AUTH_URL only, never from the request host.
  const appUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const email = emailConfigured(env);
  return {
    database: drizzleAdapter(drizzle(pool, { schema }), {
      provider: "pg",
      schema,
    }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    rateLimit: {
      enabled: true,
      customStorage: { consume: (key, rule) => consumeRate(pool, `auth:${key}`, rule.window, rule.max) },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: email,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: email
        ? ({ user, token }) => sendEmail(env, user.email, "Reset your Coursay password", passwordResetText(appUrl, token))
        : undefined,
    },
    emailVerification: email
      ? {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: ({ user, token }) => sendEmail(env, user.email, "Confirm your Coursay email", verificationText(appUrl, token)),
      }
      : undefined,
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
      // Session reads stay database-backed so revocation is observed.
      cookieCache: { enabled: false },
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
  };
}

export function authFor(env: Env, pool: Pool): AuthInstance {
  return betterAuth(authOptions(pool, env));
}

export async function authenticatedUserId(request: Request, env: Env, pool: Pool): Promise<string | null> {
  const session = await authFor(env, pool).api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

export async function passwordMatches(request: Request, env: Env, pool: Pool, password: string): Promise<boolean> {
  try {
    await authFor(env, pool).api.verifyPassword({ body: { password }, headers: request.headers });
    return true;
  } catch (error) {
    if (isAPIError(error)) return false;
    throw error;
  }
}
