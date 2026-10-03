import type { Env } from './env';

// One private Operator token guards every Operator route. It keeps the name it had
// when the waitlist was its only user.
export function isOperator(request: Request, env: Env): boolean {
  return Boolean(env.WAITLIST_OPERATOR_TOKEN) && request.headers.get('authorization') === `Bearer ${env.WAITLIST_OPERATOR_TOKEN}`;
}

// A Site collection kind collects only while its flag is on and the Operator can reach its records.
export function collectionApproved(flag: string | undefined, env: Env): boolean {
  return flag === 'true' && Boolean(env.WAITLIST_OPERATOR_TOKEN);
}
