import type { Pool } from 'pg';
import { badRequest, json } from './http';

// The newest 200 triage records of a table, filtered by exact allowlisted column values.
export async function listTriageRecords(pool: Pool, table: 'feedback_responses' | 'bug_reports', columns: string, query: URLSearchParams, filters: Record<string, readonly string[]>): Promise<Response> {
  const conditions: string[] = [];
  const values: string[] = [];
  for (const [name, allowed] of Object.entries(filters)) {
    const value = query.get(name);
    if (value === null || value === '') continue;
    if (!allowed.includes(value)) return badRequest(`Unknown ${name}.`);
    values.push(value);
    conditions.push(`${name} = $${values.length}`);
  }
  const records = await pool.query(`SELECT ${columns} FROM ${table} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 200`, values);
  return json({ records: records.rows });
}
