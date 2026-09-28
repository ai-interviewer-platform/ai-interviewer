// Runs every active problem's reference solution through the real Docker runner
// with its visible tests, and checks that untouched starter code does not pass.
// Requires DATABASE_URL, Docker, and `npm run runner:build`.
import pg from "pg";
import { validateRequest } from "../python-runner/contract.mjs";
import { createDockerRunner, prepareDocker } from "../python-runner/docker.mjs";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const run = createDockerRunner(await prepareDocker());
const failures = [];
try {
  const { rows } = await pool.query(
    `SELECT p.id, p.entry_point, p.test_contract, p.starter_code, p.reference_solution,
            json_agg(json_build_object('testId', t.id, 'inputData', t.input_data, 'expectedOutput', t.expected_output) ORDER BY t.id) AS tests
       FROM problems p JOIN test_cases t ON t.problem_id = p.id AND t.visibility = 'visible'
      WHERE p.is_active AND NOT p.is_sample AND ($1::text IS NULL OR p.id LIKE $1)
      GROUP BY p.id ORDER BY p.id`,
    [process.env.PROBLEM_FILTER ?? null],
  );
  for (const [index, problem] of rows.entries()) {
    const request = (sourceCode) => ({ attemptId: "problem-bank-check", checkpointId: problem.id, sourceCode, entryPoint: problem.entry_point, testContract: problem.test_contract, tests: problem.tests });
    if (!validateRequest(request(problem.reference_solution))) { failures.push(`${problem.id}: request rejected by runner contract`); continue; }
    const reference = await run(request(problem.reference_solution));
    if (reference.status !== "passed") failures.push(`${problem.id}: reference ${reference.status} ${JSON.stringify(reference.testResults.filter((test) => test.outcome !== "passed")).slice(0, 300)}`);
    const starter = await run(request(problem.starter_code));
    if (starter.status === "passed") failures.push(`${problem.id}: starter code already passes`);
    if (starter.status === "runner_error") failures.push(`${problem.id}: starter runner_error ${starter.runnerError}`);
    if ((index + 1) % 50 === 0) console.log(`${index + 1}/${rows.length} checked, ${failures.length} failures`);
  }
  console.log(failures.length ? failures.join("\n") : `All ${rows.length} reference solutions pass and no starter code passes.`);
  if (failures.length) process.exitCode = 1;
} finally {
  await pool.end();
}
