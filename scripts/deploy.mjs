// The one production deploy: origin/main, a migrated and verified database, then the Worker.
// DATABASE_URL must be the direct production migration URL in the process environment.
// This script never reads .dev.vars, so a local database cannot satisfy the migration gate.
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const node = (...args) => execFileSync(process.execPath, args, { stdio: "inherit" });

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the direct production migration URL.");
git("fetch", "--quiet", "origin", "main");
if (git("status", "--porcelain")) throw new Error("Commit or stash local changes before deploying.");
const sha = git("rev-parse", "HEAD");
if (sha !== git("rev-parse", "origin/main")) throw new Error("Deploy only origin/main: check out main and pull.");

node("scripts/apply-migrations.mjs");
node("scripts/verify-postgres.mjs");
// GIT_SHA is reported by GET /api/health, so the live revision is one request away.
node("node_modules/wrangler/bin/wrangler.js", "deploy", "--env=", "--var", `GIT_SHA:${sha}`);
