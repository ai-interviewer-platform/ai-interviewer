import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL to the target PostgreSQL connection string.");

const root = resolve(import.meta.dirname, "..");
const authDirectory = resolve(root, "migrations", "auth");
const authFiles = (await readdir(authDirectory)).filter((file) => file.endsWith(".sql")).sort();
// Auth first (application tables reference users), then numbered files in order.
const applicationFiles = (await readdir(resolve(root, "migrations"))).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
const migrationPaths = [
  ...authFiles.map((file) => resolve(authDirectory, file)),
  ...applicationFiles.map((file) => resolve(root, "migrations", file)),
];

const pool = new pg.Pool({ connectionString });
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
    filename text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const path of migrationPaths) {
    const sql = await readFile(path, "utf8");
    const filename = path.slice(root.length + 1).replaceAll("\\", "/");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await pool.query("SELECT checksum FROM app_schema_migrations WHERE filename = $1", [filename]);
    if (applied.rows[0]) {
      if (applied.rows[0].checksum !== checksum) throw new Error(`Migration checksum changed after application: ${filename}`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO app_schema_migrations (filename, checksum) VALUES ($1, $2)", [filename, checksum]);
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
