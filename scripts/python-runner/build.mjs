import { spawn } from "node:child_process";
import { imageTag } from "./docker.mjs";
const child = spawn(process.env.PYTHON_RUNNER_DOCKER ?? "docker", ["build", "--tag", imageTag, "runner"], { stdio: "inherit" });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
