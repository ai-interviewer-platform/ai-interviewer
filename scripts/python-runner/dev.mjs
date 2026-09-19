import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { prepareDocker, createDockerRunner } from "./docker.mjs";
import { createRunnerServer } from "./server.mjs";

const image = await prepareDocker();
const token = randomBytes(32).toString("hex");
const server = createRunnerServer(createDockerRunner(image), token);
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(8791, "127.0.0.1", resolveListen); });
const proxy = spawn(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "dev", "--config", "runner/wrangler.jsonc", "--var", `LOCAL_RUNNER_TOKEN:${token}`], { stdio: "inherit" });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  proxy.kill("SIGTERM");
  // Let in-flight execution finish and remove its container before exiting.
  server.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
proxy.on("error", () => { process.exitCode = 1; stop(); });
proxy.on("exit", code => { if (!stopping) process.exitCode = code || 1; stop(); });
console.log("Isolated Python runner listening on loopback. Start the application with npm run dev:runner.");
