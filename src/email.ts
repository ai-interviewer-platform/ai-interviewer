import type { Env } from "./env";

// Password reset and email verification are on only when both values are set.
export function emailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

// Plain text only, so no user-provided value is ever interpreted as HTML.
export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (!emailConfigured(env)) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
  });
  if (!response.ok) throw new Error(`Email delivery failed with status ${response.status}.`);
}

export function passwordResetText(appUrl: string, token: string): string {
  return `Someone asked to reset the password for your Coursay account.\n\nOpen this link within one hour to choose a new password:\n${appUrl}/#personal?reset=${encodeURIComponent(token)}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`;
}

export function verificationText(appUrl: string, token: string): string {
  return `Confirm your email address for Coursay:\n${appUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent("/#personal")}\n\nIf you did not create an account, ignore this email.`;
}
