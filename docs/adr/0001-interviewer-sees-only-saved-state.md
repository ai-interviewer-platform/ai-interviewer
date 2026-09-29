# The Interviewer sees only saved state

The text and voice Interviewers read the saved Draft, Checkpoints, and Runs, never the unsaved text in the candidate's editor. Everything an Interviewer reacted to is then a recorded Event, so a Review can cite the exact code behind each reply, and the Evidence never claims the Interviewer saw code that the Attempt timeline does not hold. The client saves a changed Draft before each candidate request (message, Help request, run, finish) instead of sending editor text.

## Consequences

- During a voice Attempt, the Interviewer can be behind unsaved edits until the next save. This is accepted: the voice context tells the model that unsaved changes are unavailable.
- Do not "fix" stale Interviewer context by sending live editor text. Save the Draft first.
