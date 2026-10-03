import type { Pool } from 'pg';
import { bugReportPolicy } from './bug-reports';
import type { Env } from './env';
import { feedbackPolicy } from './feedback';
import { badRequest, boundedRequest, checkOrigin, json, notFound, requestBody, serverUnavailable } from './http';
import { measurementPolicy } from './measurement';
import { isOperator } from './operator';
import { consumeRate, siteRateLimitKey } from './security';
import { waitlistPolicy } from './waitlist';

// What a Site collection handler receives once the gate has passed.
export type SiteInput = { body: Record<string, unknown>; url: URL; env: Env; database: () => Pool; userAgent: string };

type Route = {
  handle(input: SiteInput): Promise<Response> | Response;
  // Operator routes need the Operator token and stay open while collection is closed.
  operator?: true;
  // A public write that stays open while collection is closed, such as waitlist withdrawal.
  openWhenClosed?: true;
};

// The Collection policy of one Site collection kind. Routes are keyed by "METHOD /path".
export type CollectionPolicy = {
  configKey: 'measurementEnabled' | 'feedbackEnabled' | 'bugReportsEnabled' | 'waitlistEnabled';
  enabled(env: Env): boolean;
  routes: Record<string, Route>;
  bytes: number;
  perMinute: number;
  rateKey: Parameters<typeof siteRateLimitKey>[0];
  closed: string;
  busy: string;
  unavailable: string;
};

const policies: CollectionPolicy[] = [measurementPolicy, feedbackPolicy, bugReportPolicy, waitlistPolicy];

// The one gate for Site collection, in a fixed order: route, Operator token or collection
// flag, origin, body limit, JSON body, project-wide rate limit, handler. Returns null for
// paths outside Site collection. Site collection never reads the Sign-in session.
export async function siteCollectionRequest(request: Request, env: Env, database: () => Pool): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/site-config' && request.method === 'GET') return json(Object.fromEntries(policies.map(policy => [policy.configKey, policy.enabled(env)])));
  const policy = policies.find(candidate => Object.keys(candidate.routes).some(key => key.endsWith(` ${url.pathname}`)));
  if (!policy) return null;
  const route = policy.routes[`${request.method} ${url.pathname}`];
  if (!route) return notFound();
  const write = request.method !== 'GET';
  if (route.operator && !isOperator(request, env)) return json({ error: 'Operator access required.' }, { status: 401 });
  if (!route.operator && write && !route.openWhenClosed && !policy.enabled(env)) return serverUnavailable(policy.closed);
  const originError = checkOrigin(request, env.BETTER_AUTH_URL);
  if (originError) return originError;
  let body: Record<string, unknown> = {};
  if (write) {
    const bounded = await boundedRequest(request, policy.bytes);
    if (bounded instanceof Response) return bounded;
    const parsed = await requestBody(bounded);
    if (!parsed) return badRequest('Send a JSON request.');
    body = parsed;
  }
  try {
    if (write && !route.operator && !(await consumeRate(database(), siteRateLimitKey(policy.rateKey), 60, policy.perMinute)).allowed) return json({ error: policy.busy }, { status: 429 });
    return await route.handle({ body, url, env, database, userAgent: request.headers.get('user-agent') ?? '' });
  } catch {
    return serverUnavailable(route.operator ? 'Records are unavailable. Try again.' : policy.unavailable);
  }
}
