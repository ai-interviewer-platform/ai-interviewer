import type { Env } from './env';
import { json } from './http';

// One private operator token guards every operator API. It keeps the name it had
// when the waitlist was its only user.
export function isOperator(request: Request, env: Env): boolean {
  return Boolean(env.WAITLIST_OPERATOR_TOKEN) && request.headers.get('authorization') === `Bearer ${env.WAITLIST_OPERATOR_TOKEN}`;
}

export function operatorRequired(): Response {
  return json({ error: 'Operator access required.' }, { status: 401 });
}
