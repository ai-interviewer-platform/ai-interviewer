import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { executionResult } from "../../scripts/python-runner/contract.mjs";
import { dockerCommand } from "../../scripts/python-runner/docker.mjs";

// Real hosted image and sandbox server. --network=none mirrors enableInternet = false,
// so the Durable Object's role is played by a client inside the container.
// Intentionally fails, never skips, when Docker is unavailable.
const tag = "ai-interviewer-python-hosted:test";
const name = `interviewer-hosted-${randomUUID()}`;
const client = "import sys, urllib.request; sys.stdout.write(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8080/exec', data=sys.stdin.buffer.read(), method='POST'), timeout=30).read().decode())";
const item = { testId: "values", inputData: { args: [[4, 7, 2, 9]] }, expectedOutput: 16 };

async function exec(sourceCode) {
  const response = await dockerCommand(["exec", "-i", name, "python3", "-c", client], { input: JSON.stringify({ sourceCode, entryPoint: "solve", args: item.inputData.args }), timeoutMs: 30_000 });
  assert.equal(response.code, 0, response.stderr);
  return JSON.parse(response.stdout);
}
const run = async sourceCode => executionResult(item, await exec(sourceCode));

before(async () => {
  const built = await dockerCommand(["build", "--quiet", "--file", "runner/hosted.Dockerfile", "--tag", tag, "runner"], { timeoutMs: 600_000 });
  assert.equal(built.code, 0, `Docker must be running to build the hosted image: ${built.stderr}`);
  assert.equal((await dockerCommand(["run", "--detach", "--name", name, "--network=none", tag])).code, 0);
  for (let tries = 0; (await dockerCommand(["exec", name, "python3", "-c", "import socket; socket.create_connection(('127.0.0.1', 8080))"])).code !== 0; tries++) {
    assert.ok(tries < 50, "sandbox server did not start");
    await delay(100);
  }
});
after(() => dockerCommand(["rm", "--force", name]));

test("correct and incorrect solutions are judged outside the container", async () => {
  assert.deepEqual((await run("def solve(values):\n    return sum(values[1::2])")).outcome, { testId: "values", outcome: "passed", actualOutput: 16 });
  assert.deepEqual((await run("def solve(values):\n    return -1")).outcome, { testId: "values", outcome: "failed", actualOutput: -1 });
});

test("syntax errors and memory exhaustion fail as candidate errors", async () => {
  assert.match((await run("def solve(:")).outcome.error, /SyntaxError/);
  assert.match((await run("def solve(values):\n    return len(bytearray(512 << 20))")).outcome.error, /MemoryError/);
});

test("CPU loops and sleeping code are stopped within the wall limit", async () => {
  for (const source of ["def solve(values):\n    while True: pass", "import time\ndef solve(values):\n    time.sleep(30)"]) {
    const start = Date.now();
    assert.match((await run(source)).outcome.error, /timeout|exited/);
    assert.ok(Date.now() - start < 8000);
  }
  assert.equal((await exec("import time\ndef solve(values):\n    time.sleep(30)")).timedOut, true);
});

test("huge output is capped at every layer", async () => {
  assert.match((await run("def solve(values):\n    print('a' * 20000)\n    return 16")).outcome.error, /Output/);
  assert.equal((await run("def solve(values):\n    while True: print('x' * 1000)")).outcome.outcome, "failed");
  const flooded = await exec("import os\ndef solve(values):\n    for fd in range(3, 8):\n        try: os.write(fd, b'x' * 300000)\n        except OSError: pass");
  assert.equal(flooded.oversized, true);
  assert.equal(executionResult(item, flooded).outcome.error, "Output limit exceeded");
});

test("fork bombs hit NPROC and leave nothing running for the next test", async () => {
  assert.equal((await run("import os\ndef solve(values):\n    while True: os.fork()")).outcome.outcome, "failed");
  await run("import os, time\ndef solve(values):\n    if os.fork() == 0:\n        os.setsid()\n        os.closerange(0, 64)\n        time.sleep(60)\n    return 16");
  const survivors = "import os\ndef solve(values):\n    return [p for p in os.listdir('/proc') if p.isdigit() and int(p) != os.getpid() and os.stat('/proc/' + p).st_uid == 65534]";
  assert.deepEqual((await run(survivors)).outcome.actualOutput, []);
  assert.equal((await run("def solve(values):\n    return sum(values[1::2])")).outcome.outcome, "passed");
});

test("candidate runs as nobody without network, secrets or writable system paths", async () => {
  const source = `import os, socket
def solve(values):
    s = socket.socket()
    s.settimeout(0.5)
    try:
        s.connect(('1.1.1.1', 80))
        network = True
    except OSError:
        network = False
    denied = []
    for path in ['/etc/pwned', '/tmp/pwned', '/harness.py', '/sandbox.py']:
        try:
            open(path, 'w').write('x')
        except OSError:
            denied.append(path)
    open('scratch.txt', 'w').write('ok')
    return [os.getuid(), os.getgid(), network, denied, sorted(os.environ), os.system('touch /etc/pwned-by-shell') != 0]`;
  const { outcome } = await run(source);
  assert.deepEqual(outcome.actualOutput.slice(0, 4), [65534, 65534, false, ["/etc/pwned", "/tmp/pwned", "/harness.py", "/sandbox.py"]]);
  assert.ok(outcome.actualOutput[4].every(key => ["PATH", "TMPDIR", "LC_CTYPE"].includes(key)), JSON.stringify(outcome.actualOutput[4]));
  assert.equal(outcome.actualOutput[5], true);
  const shell = await exec("import os\ndef solve(values):\n    os.system('id -u')\n    return 16");
  assert.match(JSON.parse(shell.stdout).stdout, /^65534$/m);
});

test("each execution starts in a fresh, empty directory", async () => {
  await run("def solve(values):\n    open('left-behind', 'w').write('x')\n    return 16");
  const { outcome } = await run("import os\ndef solve(values):\n    return [os.listdir('.'), os.getcwd().startswith('/tmp/')]");
  assert.deepEqual(outcome.actualOutput, [[], true]);
});
