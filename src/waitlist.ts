import type { Pool } from 'pg';
import type { Env } from './env';
import { experimentConfig } from './experiment';
import { badRequest, boundedRequest, checkOrigin, isEmailAddress, json, requestBody } from './http';
import { measurementEnabled } from './measurement';
import { isOperator, operatorRequired } from './operator';

type Policy = { version: string; contactPurpose: string; operator: string; contact: string; retention: string; processors: string; emailProvider: 'none'; confirmation: 'browser_receipt'; deletion: string };

export function landingConfig(env: Env) {
  let policy: Policy | null = null;
  try {
    const value = JSON.parse(env.WAITLIST_POLICY || 'null');
    if (value && ['version', 'contactPurpose', 'operator', 'contact', 'retention', 'processors', 'deletion'].every(key => typeof value[key] === 'string' && value[key].trim()) && value.emailProvider === 'none' && value.confirmation === 'browser_receipt') {
      policy = { version: value.version, contactPurpose: value.contactPurpose, operator: value.operator, contact: value.contact, retention: value.retention, processors: value.processors, emailProvider: 'none', confirmation: 'browser_receipt', deletion: value.deletion };
    }
  } catch { /* Invalid or incomplete policy keeps collection closed. */ }
  const primaryAction = ['waitlist', 'personal_practice'].includes(env.LANDING_PRIMARY_ACTION || '') ? env.LANDING_PRIMARY_ACTION : null;
  return { primaryAction, waitlistEnabled: env.WAITLIST_COLLECTION_APPROVED === 'true' && policy !== null && Boolean(env.WAITLIST_OPERATOR_TOKEN), policy, experiment: experimentConfig(env, measurementEnabled(env)) };
}

async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function waitlistRequest(request: Request, env: Env, database: () => Pool): Promise<Response> {
  const path = new URL(request.url).pathname;
  const config = landingConfig(env);
  if (path === '/api/landing-config' && request.method === 'GET') return json(config);
  const originError = checkOrigin(request, env.BETTER_AUTH_URL);
  if (originError) return originError;
  const operatorPath = path === '/api/waitlist/records';
  if (operatorPath && !isOperator(request, env)) return operatorRequired();
  if (path === '/api/waitlist' && !config.waitlistEnabled) return json({ error: 'The waitlist is not accepting email addresses yet.' }, { status: 503 });
  const bounded = await boundedRequest(request);
  if (bounded instanceof Response) return bounded;
  try {
    if (operatorPath && request.method === 'GET') {
      const pool = database();
      const records = await pool.query('SELECT id, email, policy_version, created_at FROM waitlist_entries ORDER BY created_at');
      const outcomes = await pool.query('SELECT id, name, occurred_at, policy_version FROM waitlist_outcomes ORDER BY occurred_at');
      return json({ records: records.rows, outcomes: outcomes.rows });
    }
    if (request.method !== 'POST') return json({ error: 'Not found.' }, { status: 404 });
    const body = await requestBody(bounded);
    if (!body) return badRequest('Send a JSON request.');
    if (operatorPath) {
      if (body.action !== 'delete' || typeof body.id !== 'string' || !body.id) return badRequest('Choose a record to delete.');
      await database().query('DELETE FROM waitlist_entries WHERE id=$1', [body.id]);
      return json({ deleted: true });
    }
    if (path === '/api/waitlist') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!isEmailAddress(email)) return badRequest('Enter an email address, such as name@example.com.');
      if (body.consent !== true) return badRequest('Agree to the stated contact purpose to join.');
      if (body.policyVersion !== config.policy!.version) return json({ error: 'The waitlist notice changed. Reload it before joining.' }, { status: 409 });
      const receipt = crypto.randomUUID();
      const id = crypto.randomUUID();
      await database().query(`WITH added AS (
        INSERT INTO waitlist_entries (id,email,receipt_hash,policy_version) VALUES ($1,$2,$3,$4)
        ON CONFLICT (email) DO NOTHING RETURNING policy_version
      ) INSERT INTO waitlist_outcomes (id,name,policy_version) SELECT $5,'waitlist_joined',policy_version FROM added`, [id, email, await hash(receipt), config.policy!.version, crypto.randomUUID()]);
      // Identical response for new and existing addresses. A duplicate receipt grants no record access.
      return json({ accepted: true, receipt });
    }
    if (path === '/api/waitlist/withdraw') {
      if (typeof body.receipt !== 'string' || !body.receipt) return badRequest('Provide the receipt saved when you joined.');
      await database().query(`WITH removed AS (
        DELETE FROM waitlist_entries WHERE receipt_hash=$1 RETURNING policy_version
      ) INSERT INTO waitlist_outcomes (id,name,policy_version) SELECT $2,'waitlist_withdrawn',policy_version FROM removed`, [await hash(body.receipt), crypto.randomUUID()]);
      return json({ withdrawn: true });
    }
    return json({ error: 'Not found.' }, { status: 404 });
  } catch {
    return json({ error: 'Unable to save this request. Keep your details and try again.' }, { status: 503 });
  }
}
