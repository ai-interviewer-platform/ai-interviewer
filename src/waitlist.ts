import type { Env } from './env';
import { experimentConfig } from './experiment';
import { badRequest, isEmailAddress, json } from './http';
import { measurementEnabled } from './measurement';
import { collectionApproved } from './operator';
import { limits } from './security';
import type { CollectionPolicy, SiteInput } from './site-collection';

type Policy = { version: string; contactPurpose: string; operator: string; contact: string; retention: string; processors: string; emailProvider: 'none'; confirmation: 'browser_receipt'; deletion: string };

function noticePolicy(env: Env): Policy | null {
  try {
    const value = JSON.parse(env.WAITLIST_POLICY || 'null');
    if (value && ['version', 'contactPurpose', 'operator', 'contact', 'retention', 'processors', 'deletion'].every(key => typeof value[key] === 'string' && value[key].trim()) && value.emailProvider === 'none' && value.confirmation === 'browser_receipt') {
      return { version: value.version, contactPurpose: value.contactPurpose, operator: value.operator, contact: value.contact, retention: value.retention, processors: value.processors, emailProvider: 'none', confirmation: 'browser_receipt', deletion: value.deletion };
    }
  } catch { /* Invalid or incomplete policy keeps collection closed. */ }
  return null;
}

// An invalid or incomplete notice policy keeps the waitlist closed.
function waitlistEnabled(env: Env) {
  return collectionApproved(env.WAITLIST_COLLECTION_APPROVED, env) && noticePolicy(env) !== null;
}

// The landing page content. Whether the waitlist collects is in the site configuration.
function landingConfig({ env }: SiteInput) {
  const primaryAction = ['waitlist', 'personal_practice'].includes(env.LANDING_PRIMARY_ACTION || '') ? env.LANDING_PRIMARY_ACTION : null;
  return json({ primaryAction, policy: noticePolicy(env), experiment: experimentConfig(env, measurementEnabled(env)) });
}

async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function join({ body, env, database }: SiteInput) {
  const version = noticePolicy(env)!.version;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isEmailAddress(email)) return badRequest('Enter an email address, such as name@example.com.');
  if (body.consent !== true) return badRequest('Agree to the stated contact purpose to join.');
  if (body.policyVersion !== version) return json({ error: 'The waitlist notice changed. Reload it before joining.' }, { status: 409 });
  const receipt = crypto.randomUUID();
  await database().query(`WITH added AS (
    INSERT INTO waitlist_entries (id,email,receipt_hash,policy_version) VALUES ($1,$2,$3,$4)
    ON CONFLICT (email) DO NOTHING RETURNING policy_version
  ) INSERT INTO waitlist_outcomes (id,name,policy_version) SELECT $5,'waitlist_joined',policy_version FROM added`, [crypto.randomUUID(), email, await hash(receipt), version, crypto.randomUUID()]);
  // Identical response for new and existing addresses. A duplicate receipt grants no record access.
  return json({ accepted: true, receipt });
}

async function withdraw({ body, database }: SiteInput) {
  if (typeof body.receipt !== 'string' || !body.receipt) return badRequest('Provide the receipt saved when you joined.');
  await database().query(`WITH removed AS (
    DELETE FROM waitlist_entries WHERE receipt_hash=$1 RETURNING policy_version
  ) INSERT INTO waitlist_outcomes (id,name,policy_version) SELECT $2,'waitlist_withdrawn',policy_version FROM removed`, [await hash(body.receipt), crypto.randomUUID()]);
  return json({ withdrawn: true });
}

async function records({ database }: SiteInput) {
  const pool = database();
  const records = await pool.query('SELECT id, email, policy_version, created_at FROM waitlist_entries ORDER BY created_at');
  const outcomes = await pool.query('SELECT id, name, occurred_at, policy_version FROM waitlist_outcomes ORDER BY occurred_at');
  return json({ records: records.rows, outcomes: outcomes.rows });
}

async function erase({ body, database }: SiteInput) {
  if (body.action !== 'delete' || typeof body.id !== 'string' || !body.id) return badRequest('Choose a record to delete.');
  await database().query('DELETE FROM waitlist_entries WHERE id=$1', [body.id]);
  return json({ deleted: true });
}

export const waitlistPolicy: CollectionPolicy = {
  configKey: 'waitlistEnabled',
  enabled: waitlistEnabled,
  routes: {
    'GET /api/landing-config': { handle: landingConfig },
    'POST /api/waitlist': { handle: join },
    // A receipt holder can always leave, even after the waitlist closes.
    'POST /api/waitlist/withdraw': { handle: withdraw, openWhenClosed: true },
    'GET /api/waitlist/records': { handle: records, operator: true },
    'POST /api/waitlist/records': { handle: erase, operator: true },
  },
  bytes: limits.waitlistBytes,
  perMinute: limits.waitlistPerMinute,
  rateKey: 'waitlist',
  closed: 'The waitlist is not accepting email addresses yet.',
  busy: 'The waitlist is busy. Try again in a minute.',
  unavailable: 'Unable to save this request. Keep your details and try again.',
};
