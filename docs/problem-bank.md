# Problem bank

`migrations/0005_problem_bank.sql` adds verified practice problems from two
permissively licensed public datasets. The two authored seed problems in
`0002_application.sql` remain unchanged apart from the line-break repair in
`0004_seed_newlines.sql`.

## Sources and licenses

| Source | License | Attribution | Used |
| --- | --- | --- | --- |
| [MBPP, sanitized subset](https://github.com/google-research/google-research/tree/master/mbpp) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Austin et al., *Program Synthesis with Large Language Models*, Google Research, 2021 | Prompt text, reference solution, and test values |
| [HumanEval](https://github.com/openai/human-eval) | MIT, Copyright (c) OpenAI | Chen et al., *Evaluating Large Language Models Trained on Code*, OpenAI, 2021 | Signature and docstring, canonical solution, and test values |

MBPP prompts gain a generated example line; titles, topics, difficulty,
guidance text, and starter code are derived by the build script. CC BY 4.0
requires this attribution to remain visible to users of the material; keep the
credit in the product's legal or about page before launch. The MIT notice must
travel with copies of the HumanEval material. LeetCode-derived datasets were not
used because their problem statements are not openly licensed.

## Selection rules

`scripts/problem-bank/build.py` keeps a problem only when all of the following hold:

- Every test is a literal call `entry(<literals>) == <literal>` (or a bare/`not`
  boolean call) with no keyword arguments, imports, or tolerance comparisons.
- Arguments survive the runner's JSON transport unchanged: no tuples, sets,
  bytes, non-string dictionary keys, or non-integral floats. Expected values may
  contain tuples, which compare as arrays. Verification applies PostgreSQL
  `jsonb` object-key order (shorter keys first), because that is the order the
  candidate receives; key-order-dependent tests that change meaning are dropped.
- Each value is at most 8 KiB of JSON and at least two tests remain.
- The tests have at least two distinct expected answers, so a constant return
  cannot pass them all.
- The reference solution passes every retained test in a subprocess with a
  5-second timeout, using the runner's exact JSON equality (booleans are not
  numbers).

Three tests are `visible` (run by **Run visible tests** and shown to the
candidate), chosen to cover as many distinct expected answers as possible; the
rest are stored as `hidden` for a future submission check.
Every problem uses the `positional JSON arguments` runner contract.

Topic and difficulty are keyword and code-size heuristics. They are adequate for
filtering but should be reviewed before being presented as curriculum. Related
problems are not generated because the product treats relationships as authored.

Verified on 2026-09-24: all 472 bank problems plus the two authored problems
pass with their reference solutions through the real Docker runner, and no
untouched starter code passes.

## Regenerate and verify

```sh
# Downloads the pinned files (sha256-checked), executes references only in a
# network-less python:3.12 container, and rewrites migrations/0005_problem_bank.sql.
node scripts/problem-bank/build.mjs

# Runs each active problem's reference through the real Docker runner and
# checks that untouched starter code does not pass (~25 minutes for all).
npm run runner:build
DATABASE_URL=... node scripts/problem-bank/verify-runner.mjs
PROBLEM_FILTER='mbpp-1%' DATABASE_URL=... node scripts/problem-bank/verify-runner.mjs
```

`0005_problem_bank.sql` is recorded by checksum once applied. To change the bank
after it reaches a database, add a new migration (new problem IDs or revisions)
rather than regenerating this file; the migration runner rejects edited files.
