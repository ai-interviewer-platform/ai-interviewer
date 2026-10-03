// The Submission check (CONTEXT.md): the hidden test cases against the Submission,
// run by the existing Runner when an Attempt finishes. It keeps only an outcome
// category for each hidden test (docs/adr/0002): never inputs, expected values,
// output, stdout, stderr, or error message text.
import type { Pool } from "pg";
import type { Env } from "./env";
import { runnerFor, type RunnerResult } from "./runner";

export type SubmissionCheckState = "checked" | "unavailable" | "no hidden tests";

export type SubmissionCheck =
  | { state: "checked"; status: "passed" | "failed"; runnerVersion: string; harnessVersion: string; results: Array<{ testId: string; category: string }> }
  | { state: "unavailable" }
  | { state: "no hidden tests" };

// What a response shows: no hidden test definitions, and no counts unless checked.
export type SubmissionCheckSummary = { state: SubmissionCheckState; passed: number | null; total: number | null; failures: Record<string, number> };

// Built-in Python exception class names that are safe to show. Any other name,
// including a candidate-defined class, is "other error".
const BUILTIN_EXCEPTIONS = new Set([
  "Exception", "ArithmeticError", "AssertionError", "AttributeError", "FloatingPointError", "ImportError", "IndentationError", "IndexError",
  "KeyError", "LookupError", "MemoryError", "ModuleNotFoundError", "NameError", "NotImplementedError", "OverflowError", "RecursionError",
  "RuntimeError", "StopIteration", "SyntaxError", "TabError", "TypeError", "UnboundLocalError", "UnicodeDecodeError", "UnicodeEncodeError",
  "UnicodeError", "ValueError", "ZeroDivisionError",
]);

// Takes only the class name of the last exception in a harness traceback. The name
// counts only when the traceback reaches candidate code, so a missing callable or a
// non-JSON return value (raised by the harness itself) is "other error".
function builtinException(error: string): string | null {
  const blocks = error.split("Traceback (most recent call last):\n");
  if (blocks.length < 2) return null;
  const lines = blocks.at(-1)!.split("\n");
  if (!lines.some((line) => line.startsWith('  File "candidate.py"'))) return null;
  const name = /^([A-Za-z]+)(?::|$)/.exec(lines.find((line) => line && !/^\s/.test(line)) ?? "")?.[1];
  return name && BUILTIN_EXCEPTIONS.has(name) ? name : null;
}

function category(test: RunnerResult["testResults"][number]): string {
  if (test.outcome === "passed") return "passed";
  if (test.outcome === "failed" && test.error === undefined) return "wrong answer";
  if (test.error === "Execution timeout") return "timeout";
  return (test.outcome === "failed" && test.error && builtinException(test.error)) || "other error";
}

// A runner_error at any point, or exhausted runner memory (docs/adr/0002), is no result:
// partial results are discarded.
function categorized(result: RunnerResult): SubmissionCheck {
  if (result.status === "runner_error" || result.testResults.some((test) => test.error === "Memory limit exceeded")) return { state: "unavailable" };
  const results = result.testResults.map((test) => ({ testId: test.testId, category: category(test) }));
  return { state: "checked", status: results.every((test) => test.category === "passed") ? "passed" : "failed", runnerVersion: result.runnerVersion, harnessVersion: result.harnessVersion, results };
}

// Runs the hidden tests of the Attempt's Problem against the Submission source. Call it
// outside any transaction. It never throws for a Runner failure: finishing is never blocked.
export async function runSubmissionCheck(pool: Pool, env: Env, input: { attemptId: string; problemId: string; checkpointId: string; sourceCode: string }): Promise<SubmissionCheck> {
  const content = await pool.query<{ id: string; entry_point: string; test_contract: unknown; input_data: unknown; expected_output: unknown }>(
    `SELECT p.entry_point, p.test_contract, tc.id, tc.input_data, tc.expected_output
       FROM problems p JOIN test_cases tc ON tc.problem_id = p.id
      WHERE p.id = $1 AND tc.visibility = 'hidden'
      ORDER BY tc.id`,
    [input.problemId],
  );
  if (!content.rows.length) return { state: "no hidden tests" };
  const runner = runnerFor(env);
  if (!runner) return { state: "unavailable" };
  const outcome = await runner.run({
    attemptId: input.attemptId, checkpointId: input.checkpointId, sourceCode: input.sourceCode, entryPoint: content.rows[0].entry_point, testContract: content.rows[0].test_contract,
    tests: content.rows.map(({ id: testId, input_data: inputData, expected_output: expectedOutput }) => ({ testId, inputData, expectedOutput })),
  });
  return outcome.status === "completed" ? categorized(outcome.result) : { state: "unavailable" };
}

type StoredCheck = { check_state: SubmissionCheckState; tests_passed: number | null; test_results: Array<{ testId: string; category: string }> };

function summary(row: StoredCheck): SubmissionCheckSummary {
  if (row.check_state !== "checked") return { state: row.check_state, passed: null, total: null, failures: {} };
  const failures: Record<string, number> = {};
  for (const { category: name } of row.test_results) if (name !== "passed") failures[name] = (failures[name] ?? 0) + 1;
  return { state: "checked", passed: row.tests_passed, total: row.test_results.length, failures };
}

// The recorded Submission check of an Attempt, or null when it has none.
export async function loadSubmissionCheck(pool: Pool, attemptId: string): Promise<SubmissionCheckSummary | null> {
  const result = await pool.query<StoredCheck>("SELECT check_state, tests_passed, test_results FROM code_runs WHERE attempt_id = $1 AND run_kind = 'submission'", [attemptId]);
  return result.rows[0] ? summary(result.rows[0]) : null;
}
