// One PostgreSQL schema for each test run, migrated in the order of scripts/apply-migrations.mjs.
// A new migration reaches every integration test with no test edit.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import pg from "pg";
import { migrationFiles } from "../scripts/migrations.mjs";

const PROBLEM_BANK = "migrations/0005_problem_bank.sql";

async function connectionString() {
  const value = process.env.DATABASE_URL ?? parseEnv(await readFile(".dev.vars", "utf8").catch(() => "")).DATABASE_URL;
  assert.ok(value, "Set DATABASE_URL to a disposable local PostgreSQL instance.");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname), "Use a local database only.");
  return value;
}

// Returns a pool scoped to a new migrated schema. `problemBank: false` skips the
// problem bank seed for speed; the authored fixture problems stay available.
export async function testDatabase(name, { problemBank = true } = {}) {
  const url = await connectionString();
  const schema = `${name}_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: url });
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    for (const { path, filename } of await migrationFiles()) {
      if (!problemBank && filename === PROBLEM_BANK) continue;
      await pool.query((await readFile(path, "utf8")).replaceAll('"public".', `"${schema}".`));
    }
  } catch (error) {
    await drop();
    throw error;
  }
  async function drop() {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
  return { pool, schema, drop };
}
