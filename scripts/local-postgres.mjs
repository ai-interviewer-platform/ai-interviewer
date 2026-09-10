import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
const stateRoot = resolve(root, ".local", "postgres-18");
const dataDirectory = resolve(stateRoot, "data");
const credentialPath = resolve(stateRoot, "credentials.json");
const logPath = resolve(stateRoot, "postgres.log");
const devVarsPath = resolve(root, ".dev.vars");
const postgresBin = process.env.POSTGRES_BIN ?? "C:\\Program Files\\PostgreSQL\\18\\bin";
// The installed system cluster occupies 5432; setup verifies 5433 is free.
const port = Number(process.env.LOCAL_POSTGRES_PORT ?? "5433");
const appRole = "ai_interviewer_app";
const databaseName = "ai_interviewer";

function executable(name) {
  return resolve(postgresBin, process.platform === "win32" ? `${name}.exe` : name);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env ?? process.env,
      detached: options.detached === true,
      stdio: options.detached === true
        ? "ignore"
        : [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    if (options.input !== undefined) child.stdin.end(options.input);
    child.on("error", rejectRun);
    // PostgreSQL's Windows launcher leaves inherited pipe handles open in the
    // detached server process, so waiting for `close` would never settle even
    // after pg_ctl itself exits successfully.
    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) {
        resolveRun({ code, stdout, stderr });
        return;
      }
      rejectRun(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function portAcceptsConnections() {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(750);
    socket.once("connect", () => { socket.destroy(); resolvePort(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePort(false); });
    socket.once("error", () => resolvePort(false));
  });
}

function connectionString(password, database = databaseName, user = appRole) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
}

async function readCredentials() {
  return JSON.parse(await readFile(credentialPath, "utf8"));
}

async function initializeCluster() {
  if (await exists(resolve(dataDirectory, "PG_VERSION"))) return readCredentials();
  if (await portAcceptsConnections()) {
    throw new Error(`Port ${port} is already in use. Set LOCAL_POSTGRES_PORT to an available, fixed port and retry.`);
  }
  await mkdir(stateRoot, { recursive: true });
  const credentials = {
    administratorPassword: randomBytes(32).toString("base64url"),
    applicationPassword: randomBytes(32).toString("base64url"),
  };
  const initializationPasswordPath = resolve(stateRoot, "initdb-password.tmp");
  await writeFile(initializationPasswordPath, `${credentials.administratorPassword}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await run(executable("initdb"), [
      "--pgdata", dataDirectory,
      "--username", "postgres",
      "--encoding", "UTF8",
      "--auth-local", "scram-sha-256",
      "--auth-host", "scram-sha-256",
      "--pwfile", initializationPasswordPath,
    ]);
  } finally {
    await unlink(initializationPasswordPath).catch(() => undefined);
  }
  await writeFile(
    resolve(dataDirectory, "postgresql.auto.conf"),
    `listen_addresses = '127.0.0.1'\nport = ${port}\nssl = off\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(credentialPath, `${JSON.stringify(credentials)}\n`, { encoding: "utf8", mode: 0o600 });
  return credentials;
}

async function clusterStatus() {
  if (!(await exists(resolve(dataDirectory, "PG_VERSION")))) return false;
  const result = await run(executable("pg_ctl"), ["status", "--pgdata", dataDirectory], { allowFailure: true });
  return result.code === 0;
}

async function startCluster() {
  if (!(await exists(resolve(dataDirectory, "PG_VERSION")))) throw new Error("Run `npm run db:local:setup` first.");
  if (await clusterStatus()) return;
  if (await portAcceptsConnections()) throw new Error(`Port ${port} is in use by another process.`);
  await run(executable("pg_ctl"), ["start", "--pgdata", dataDirectory, "--log", logPath, "--wait"], { detached: true });
}

async function stopCluster() {
  if (!(await clusterStatus())) return false;
  await run(executable("pg_ctl"), ["stop", "--pgdata", dataDirectory, "--mode", "fast", "--wait"]);
  return true;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function ensureDatabase(credentials) {
  const administrator = new pg.Client({
    connectionString: connectionString(credentials.administratorPassword, "postgres", "postgres"),
  });
  await administrator.connect();
  try {
    const role = await administrator.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [appRole]);
    if (role.rowCount === 0) {
      await administrator.query(`CREATE ROLE ${appRole} LOGIN PASSWORD ${quoteLiteral(credentials.applicationPassword)}`);
    }
    const database = await administrator.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (database.rowCount === 0) {
      await administrator.query(`CREATE DATABASE ${databaseName} OWNER ${appRole}`);
    }
  } finally {
    await administrator.end();
  }
}

async function writeLocalEnvironment(credentials) {
  const existing = await readFile(devVarsPath, "utf8").catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  const authSecret = existing.match(/^BETTER_AUTH_SECRET=(.+)$/m)?.[1] ?? randomBytes(48).toString("base64url");
  const managedVariables = new Set([
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "PERSONAL_DATA_COLLECTION_APPROVED",
  ]);
  const retainedVariables = existing.split(/\r?\n/).filter((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    return match !== null && !managedVariables.has(match[1]);
  });
  const contents = [
    `DATABASE_URL=${connectionString(credentials.applicationPassword)}`,
    "BETTER_AUTH_URL=http://localhost:8787",
    `BETTER_AUTH_SECRET=${authSecret}`,
    "PERSONAL_DATA_COLLECTION_APPROVED=false",
    ...retainedVariables,
    "",
  ].join("\n");
  await writeFile(devVarsPath, contents, { encoding: "utf8", mode: 0o600 });
}

async function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const credentials = await readCredentials();
  return connectionString(credentials.applicationPassword);
}

async function migrate(databaseUrl) {
  await run(process.execPath, [resolve(root, "scripts", "apply-migrations.mjs")], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

async function verify(databaseUrl) {
  await run(process.execPath, [resolve(root, "scripts", "verify-postgres.mjs")], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

async function setup() {
  for (const name of ["initdb", "pg_ctl", "psql"]) {
    if (!(await exists(executable(name)))) throw new Error(`PostgreSQL executable not found: ${executable(name)}`);
  }
  const credentials = await initializeCluster();
  await startCluster();
  await ensureDatabase(credentials);
  await writeLocalEnvironment(credentials);
  const databaseUrl = connectionString(credentials.applicationPassword);
  await migrate(databaseUrl);
  await migrate(databaseUrl);
  await verify(databaseUrl);
  console.log(`Local PostgreSQL is ready on 127.0.0.1:${port}; both migrations and live invariant checks passed.`);
}

const action = process.argv[2] ?? "status";
if (action === "setup") await setup();
else if (action === "start") { await startCluster(); console.log(`Local PostgreSQL is running on 127.0.0.1:${port}.`); }
else if (action === "stop") console.log(await stopCluster() ? "Local PostgreSQL stopped." : "Local PostgreSQL was not running.");
else if (action === "status") console.log(await clusterStatus() ? `Local PostgreSQL is running on 127.0.0.1:${port}.` : "Local PostgreSQL is stopped or not initialized.");
else if (action === "verify") { await verify(await readDatabaseUrl()); console.log("Live PostgreSQL verification passed."); }
else throw new Error(`Unknown action: ${action}`);
