import assert from "node:assert/strict";
import { test } from "node:test";
import { createDockerRunner, prepareDocker } from "../../scripts/python-runner/docker.mjs";
import { fixture } from "./fixtures.mjs";

// Intentionally fail, never skip, when Docker or the prepared image is missing.
const run = createDockerRunner(await prepareDocker());
const cases = [
  ["correct solution and multiple cases", undefined, "passed"],
  ["incorrect solution", "def solve(values):\n    return -1", "failed"],
  ["syntax error", "def solve(:", "failed", /SyntaxError/],
  ["runtime exception", "def solve(values):\n    raise ValueError('fictional error')", "failed", /ValueError/],
  ["infinite loop", "def solve(values):\n    while True: pass", "failed", /timeout|exited/],
  ["missing entry point", "other = 1", "failed", /Entry point/],
  ["noncallable entry point", "solve = 1", "failed", /Entry point/],
  ["oversized stdout", "def solve(values):\n    print('a' * 20000)\n    return 0", "failed", /Output/],
  ["oversized return", "def solve(values):\n    return 'x' * 20000", "failed", /8 KiB/],
  ["crash", "import os\nos._exit(7)", "failed", /exited/],
  ["stdout flood", "def solve(values):\n    while True: print('x' * 1000)", "failed"],
  ["non-JSON return", "def solve(values):\n    return {1,2}", "failed", /serializable/],
  ["nonfinite return", "def solve(values):\n    return float('nan')", "failed", /JSON/],
];
for (const [name, source, status, error] of cases) {
  test(name, async () => {
    const request = fixture(source);
    const result = await run(request);
    assert.equal(result.status, status, JSON.stringify(result));
    assert.deepEqual(result.testResults.map(item => item.testId), request.tests.map(item => item.testId));
    if (error) assert.match(result.testResults[0].error, error);
    assert.ok(Number.isSafeInteger(result.executionTimeMs) && result.executionTimeMs >= 0);
  });
}

test("captures Python and OS-level stdout/stderr", async () => {
  const result = await run(fixture("import os, sys\ndef solve(values):\n    print('hello', flush=True)\n    os.write(1, b'low-level\\n')\n    print('warning', file=sys.stderr)\n    return sum(values[1::2])"));
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.match(result.stdout, /hello\nlow-level/);
  assert.match(result.stderr, /warning/);
});

test("network, host secrets, writable root and cross-test files are unavailable", async () => {
  const source = `import os, socket
from pathlib import Path
def solve(values):
    assert os.getuid() == 65534
    assert not any(key in os.environ for key in ['DATABASE_URL', 'DEEPGRAM_API_KEY', 'BETTER_AUTH_SECRET', 'LOCAL_RUNNER_TOKEN'])
    assert not Path('/var/run/docker.sock').exists()
    assert not Path('/tmp/previous-test').exists()
    Path('/tmp/previous-test').write_text('fictional')
    try:
        Path('/escape').write_text('no')
        raise AssertionError('writable root')
    except OSError:
        pass
    s = socket.socket()
    s.settimeout(0.3)
    try:
        s.connect(('1.1.1.1', 80))
        raise AssertionError('network available')
    except OSError:
        pass
    finally:
        s.close()
    return sum(values[1::2])`;
  const result = await run(fixture(source));
  assert.equal(result.status, "passed", JSON.stringify(result));
});

test("positional contract passes several JSON arguments", async () => {
  const request = { ...fixture("def solve(text, count, options):\n    return [text * count, sorted(options)]"), testContract: { ...fixture().testContract, arguments: "positional JSON arguments" } };
  request.tests = [{ testId: "mixed", inputData: { args: ["ab", 2, { b: 1, a: null }] }, expectedOutput: ["abab", ["a", "b"]] }];
  const result = await run(request);
  assert.equal(result.status, "passed", JSON.stringify(result));
});

test("candidate cannot assign test IDs or verdicts", async () => {
  const result = await run(fixture('def solve(values):\n    return {"testId":"empty", "outcome":"passed", "status":"passed"}'));
  assert.equal(result.status, "failed");
  assert.deepEqual(result.testResults.map(item => item.testId), ["empty", "values"]);
});
