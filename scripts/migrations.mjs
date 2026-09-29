import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// The one migration order: auth migrations first, then numbered application migrations.
// `filename` is the repository-relative path stored in app_schema_migrations.
export async function migrationFiles() {
  const authDirectory = resolve(root, "migrations", "auth");
  const applicationDirectory = resolve(root, "migrations");
  const auth = (await readdir(authDirectory)).filter((file) => file.endsWith(".sql")).sort().map((file) => resolve(authDirectory, file));
  const application = (await readdir(applicationDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort().map((file) => resolve(applicationDirectory, file));
  return [...auth, ...application].map((path) => ({ path, filename: path.slice(root.length + 1).replaceAll("\\", "/") }));
}
