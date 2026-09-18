# Local Python runner

This is the backend development implementation of the existing `PYTHON_RUNNER`
contract. Product/security authority remains
[product and architecture](product-and-architecture.md). It does not implement
hosted execution, hidden tests, reviews, or frontend changes.

## Start locally

Requirements: Node and installed project dependencies, Docker with a running
**Linux** engine, and the existing local PostgreSQL setup for personal API tests.
On Windows/WSL, start Docker Desktop and enable integration for the distro running
Node. `docker info` must succeed there. The controller checks that Docker reports
memory, swap, PID, CPU-quota and seccomp support; it refuses to run without them.

From the repository root:

```sh
npm run runner:build
```

Then leave these running in two terminals:

```sh
# Terminal 1: loopback controller and its dedicated proxy Worker
npm run runner:dev
```

```sh
# Terminal 2: the existing app with the opt-in binding
npm run dev:runner
```

`npm run dev` keeps its existing behavior without a runner. `dev:runner` selects
`env.runner` in `wrangler.jsonc`, which binds `PYTHON_RUNNER` to
`ai-interviewer-python-runner`. The existing local `.dev.vars` fallback supplies
application configuration; collection must already be approved for fictional
local testing. This feature does not change that gate or database credentials.

Ports: app 8787, proxy 8790, controller 8791 (loopback only). The controller
launcher generates an ephemeral bearer token and injects it into the proxy.
It is never passed to candidate code. Do not expose these local services through
a tunnel. Stop with Ctrl+C; the controller drains active work and removes its
container. After an abrupt host/process failure, inspect `docker ps -a` for
containers named `interviewer-python-*` and remove those abandoned runner
containers before restarting.

`PYTHON_RUNNER_DOCKER` may specify a Docker executable path. There is no host
Python fallback. Build uses only `runner/` as context, with a deny-by-default
`.dockerignore`; it does not send `.dev.vars` or application files to Docker.
At startup the controller resolves the built image to its immutable image ID.
Rebuild and restart to use a new image. No images are pulled during execution.

## Architecture and isolation

```text
main Worker: runCode()
  -> PYTHON_RUNNER.fetch(Request)
  -> local proxy Worker (no application secrets or DB bindings)
  -> authenticated HTTP on 127.0.0.1:8791
  -> controller: one fresh Docker container per visible test
  -> controller compares actual JSON with expected JSON
  -> existing API validates and stores the complete result
```

The main Worker and controller never execute candidate Python. Containers have
no network, host bind mounts, Docker socket, application secrets, or persistent
writable storage. They run UID/GID 65534 with a read-only root, dropped Linux
capabilities, `no-new-privileges`, Docker's seccomp policy and a bounded `/tmp`.
Expected answers and test IDs stay outside the candidate process. That process
can return arbitrary JSON, but cannot assign a trusted ID, outcome, or verdict.
The controller treats malformed candidate protocol output as a candidate failure.

Container isolation shares the Docker Linux kernel and is intended for local
fictional practice, not a claim of production multi-tenant sandbox security.
Production still requires an independently deployed runner and isolation review.
Do not deploy the loopback proxy as a production runner. The default deployment
has no runner service binding; the `runner` environment is for development only.
The Python base tag is maintained upstream, not digest-pinned; the resolved local
image ID is used consistently during a controller session.

## Request contract

Only `POST /run`, `Content-Type: application/json` is supported internally:

```json
{
  "attemptId": "fictional-attempt",
  "checkpointId": "fictional-checkpoint",
  "sourceCode": "def sum_odd_positions(values):\n    return sum(values[1::2])\n",
  "entryPoint": "sum_odd_positions",
  "testContract": {
    "arguments": "values: list",
    "return": "JSON-serializable return value",
    "comparison": "exact JSON equality"
  },
  "tests": [
    {"testId": "empty", "inputData": {"args": [[]]}, "expectedOutput": 0},
    {"testId": "values", "inputData": {"args": [[4,7,2,9]]}, "expectedOutput": 16}
  ]
}
```

This version supports exactly the authored contract above: one positional list,
a top-level named callable, synchronous execution, JSON-serializable return,
and exact JSON equality (object key order is irrelevant, array order matters,
booleans are distinct from numbers). Python integers beyond JavaScript's safe
integer range cannot be represented losslessly through this existing JSON API.
No expressions, dotted entry points, dunder entry points, keyword arguments,
stdin programs, async functions, third-party packages or alternate comparators
are supported. Unsupported request shapes/contracts are rejected, never evaluated.
Entry points use ASCII identifiers up to 128 characters. IDs must be nonempty
strings up to 256 characters, and each requested test ID must be unique.

## Response contract

```json
{
  "status": "passed",
  "testResults": [
    {"testId": "empty", "outcome": "passed", "actualOutput": 0},
    {"testId": "values", "outcome": "passed", "actualOutput": 16}
  ],
  "stdout": "",
  "stderr": "",
  "executionTimeMs": 250,
  "runnerVersion": "docker-python-local-v1",
  "harnessVersion": "json-positional-v1"
}
```

Every accepted test ID appears exactly once. Incorrect values, syntax/runtime
exceptions, missing callables, non-JSON return values, process exits, execution
limits and excessive output produce `status: "failed"`; affected tests have
`outcome: "failed"` and an `error` where applicable. No incorrect-answer error is
invented when actual JSON is simply unequal; inspect `actualOutput`.

Container/transport/cleanup failures and controller overload produce
`status: "runner_error"` with `runnerError`; unexecuted tests are `skipped`.
Earlier completed tests may be retained if later infrastructure fails. Cleanup
failure disables further execution until the controller is restarted. A runner
failure is never converted into an incorrect-answer verdict.

Malformed requests receive HTTP 400, unauthorized/browser-origin requests 403,
unsupported routes 404, excessive bodies 413, wrong content type 415, and an
unexpected controller failure 503. No stack traces or Docker diagnostics are
sent to the application for infrastructure errors.

## Resource limits

| Resource | Limit |
| --- | --- |
| Request / final response | 256 KiB |
| Candidate source | 64 KiB UTF-8 |
| Tests per run | 1–16, sequential, fresh container for each |
| Concurrent runs per controller | 1; additional requests return `runner_error` |
| Per-test wall time | 5 seconds for container start/attached execution |
| CPU | 1 CPU quota, 2 CPU seconds per process |
| Memory / total memory plus swap | 128 MiB / 128 MiB |
| Processes / open files | 32 / 64 |
| Writable `/tmp` | 16 MiB, noexec/nosuid |
| File size / core dumps | 64 KiB / disabled |
| Candidate stdout, stderr, actual return | 8 KiB each per test |
| Stored stdout/stderr | Aggregated in test order, truncated to 8 KiB each |
| Docker CLI output | 256 KiB per command; excess kills command and container |
| Run scheduling deadline | 60 seconds, then remaining tests are skipped |
| Container management command | 10 seconds each, including cleanup |
| Proxy / API request signal | 90 / 95 seconds |

Execution time is elapsed controller wall time including container startup and
cleanup, not pure Python CPU time. Docker management/cleanup can extend a run
past its scheduling deadline. If a process is forcibly killed, buffered Python
output may be unavailable; the result still reports the failure. Output streams
can contain candidate-authored text and must be displayed as text, not HTML.

## Public API behavior for frontend developers

Save the draft first using the existing optimistic draft revision contract.
Then call the existing authenticated endpoint:

```http
POST /api/attempts/:id/run
Origin: http://localhost:8787
Content-Type: application/json
Cookie: <existing session cookie>

{"sourceId":"unique-run-event-id","sourceOrder":2,"occurrenceOffsetMs":1000}
```

The API selects the saved source and server-owned **visible** tests. It creates
an immutable run checkpoint before invoking the runner. Success retains the
existing response shape: `{runId, checkpointId, status, testsPassed, testsFailed,
testResults}`. `status` may be `passed`, `failed`, or `runner_error`; HTTP 200
alone does not mean code passed.

Retrieve `/api/attempts/:id?page=0` (and subsequent pages when needed) for the
persisted run's `stdout`, `stderr`, `execution_time_ms`, `runner_error`,
`runner_version`, `harness_version` and `test_results`. The immediate `/run`
response does not add these fields or change the frontend contract.

HTTP 503 with `{error}` means the binding is missing, unreachable, returned a
non-success response, exceeded the response limit, or returned an invalid result.
No test verdict is stored in these cases. A checkpoint already created remains
intact; without a configured binding no checkpoint is created. Existing 400
metadata validation, 401 authentication, 403 ownership/origin, and 429 rate
limits continue to apply. Use a fresh event ID for a new run and do not interpret
infrastructure failures as candidate mistakes. No finish/review flow is required.

## Verification without a frontend

```sh
# Contract/HTTP, real workerd binding, API result tests (no Docker/DB)
node --test test/python-runner*.test.mjs

# Real Python execution and isolation tests; requires built image + Docker
npm run test:runner

# Real API handler -> HTTP controller -> Docker -> temporary PostgreSQL schema
# Reads local DATABASE_URL from the environment or .dev.vars.
npm run test:runner:api

# Both dev terminals + local DB running: real auth and Worker service binding
npm run runner:smoke

npm test
npm run check
npm run lint
npx wrangler deploy --dry-run
```

The PostgreSQL runner test supplies a fictional authenticated identity to the
real API handler; it does not retest Better Auth or the browser. It applies the
existing migrations in a temporary schema, verifies checkpoint/source/result
persistence and malformed-response handling, and removes that schema afterward.
The runner tests fail explicitly if Docker/the image is unavailable; they do not
silently skip execution or fall back to host Python.

`npm run runner:smoke` creates a unique fictional account and attempt through
HTTP, saves and runs correct/incorrect/infinite-loop solutions, verifies stored
results and stdout, then signs out. It retains the fictional account/attempt for
inspection and prints only the attempt ID, never credentials. It does not call
voice, finish or review endpoints.

For manual HTTP verification against both running Workers, use the existing
signup/signin and catalog instructions in [backend API](backend-api.md), create
a fictional text attempt, PATCH its draft with the example solution above, then
POST `/run` with the metadata above and GET the attempt detail. Repeat with
`return -1` and `while True: pass` to observe failed results. Authentication,
collection approval and database migration requirements are unchanged.

## Verification recorded on 2026-09-18

- `npm test`: 24 passed, 1 failed. All 10 new runner contract/API/proxy tests
  passed, including real workerd service-binding transport. The existing browser
  route test failed because `/opt/microsoft/msedge/msedge` is absent.
- `npm run check` and `npm run lint`: passed.
- `npx wrangler deploy --dry-run`: passed. Additional dry-runs of `--env runner`
  and `--config runner/wrangler.jsonc` passed. No deployment was performed.
- Python harness syntax parsing passed without executing candidate code.
- Follow-up startup: launched Docker Desktop directly after its CLI incorrectly
  reported a ready desktop with absent backend pipes. The Linux engine became
  available through the Windows Docker CLI (`PYTHON_RUNNER_DOCKER` override).
- `npm run test:runner`: all 16 real container execution/isolation tests passed.
- `npm run test:runner:api`: passed correct/incorrect execution, actual PostgreSQL
  checkpoint/result persistence, and malformed-response rejection.
- `npm run runner:smoke`: passed the running application's actual authentication,
  Worker service binding, correct/incorrect/timeout execution, and stored output.
- Started a fresh fictional-test PostgreSQL 16 cluster on the configured port
  5433 without changing `.dev.vars` or the existing cluster on 5432. Migrations,
  `scripts/verify-postgres.mjs`, and `test/security-integration.mjs` passed.
  The fresh database requires new test accounts and lives in temporary storage;
  it is not durable production storage.

Local end-to-end runner execution is now verified. The full repository suite
still has the unrelated missing-Edge failure noted above, so overall verification
is not yet green. These local results do not establish hosted production readiness.
