# The Submission check records outcome categories only

Finishing an Attempt runs its hidden test cases against the Submission before the Attempt completes, so the Submission check sits inside the frozen Evidence that the Review may cite. For each hidden test it stores only an outcome category: passed, wrong answer, an allowlisted built-in Python exception class name, timeout, or other error. It never stores actual output, stdout, stderr, or error message text, because any of these can echo hidden inputs or expected values, and whatever is stored reaches the browser through the account export, the Review provider, and the Findings it writes. If the runner is unavailable or fails part-way, the Attempt still completes and the check is recorded as unavailable, with no partial counts, because a runner failure must never look like a verdict and must not block finishing.

## Consequences

- Do not "improve" the Submission check by keeping runner messages or outputs. The discarded detail cannot be recovered for earlier Attempts, and keeping it would put hidden tests off the server.
- An Attempt finished during a runner outage never gets a Submission check: Evidence is frozen at completion.
- Candidate code that exhausts the runner's memory is reported as unavailable, not as a failure, because the runner cannot tell it apart from an infrastructure failure.
