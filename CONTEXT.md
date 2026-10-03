# Coursay

Coursay records a candidate's Python interview practice and reviews it only against what was recorded.

## Language

### Practice

**Problem**:
An authored Python exercise with a prompt, starter code, and visible and hidden test cases.
_Avoid_: question, task

**Candidate**:
The person who practices a Problem.
_Avoid_: student, user (outside account matters)

**Attempt**:
One candidate's practice on one Problem, from setup to completion.
_Avoid_: session (a sign-in session is a different thing)

**Interviewer**:
The AI that talks with the candidate during an Attempt, in either Mode.
_Avoid_: bot, agent, coach (coach is a Mode, not a role)

**Interviewer turn**:
One Interviewer reply to a Candidate's message or Help request, in either Input mode.
It is recorded as a Transcript segment.
_Avoid_: completion, model call

**Coding context**:
The saved Draft, Checkpoints, Runs with their output, and Help requests of an Attempt
that an Interviewer turn may use. Unsaved changes and hidden test cases are never part of it.
_Avoid_: editor state, live code

**Mode**:
How the Interviewer behaves in an Attempt: **mock** (interview conditions) or **coach** (guided practice).

**Input mode**:
How the candidate talks to the Interviewer in an Attempt: **text** or **voice**.

**Draft**:
The editable code of an Attempt. It changes until the Attempt completes, and the Interviewer sees only its saved version.
_Avoid_: current code, buffer

**Checkpoint**:
A frozen copy of the Draft, made for a run, a save, a submission, or a retry source.
_Avoid_: snapshot, version

**Submission**:
The Checkpoint made when the candidate finishes an Attempt.

**Run**:
The outcome of the visible test cases against one Checkpoint.
_Avoid_: execution, test result

**Submission check**:
The outcome of the hidden test cases against the Submission, recorded before the Attempt completes. It is a recorded observation of those tests only, not proof of correctness; it can be unavailable, and a Problem without hidden tests has none.
_Avoid_: grade, score, hidden run

**Help request**:
A candidate's request for a clarification, a hint, or an explanation during an Attempt.
_Avoid_: assistance

**Retry**:
A new coach Attempt that starts from a Checkpoint of an earlier Attempt.

### Record

**Attempt timeline**:
The ordered, append-only record of an Attempt, made of Events.
_Avoid_: history, log

**Event**:
One entry in an Attempt timeline.
_Avoid_: action, log entry

**Transcript segment**:
One utterance by the candidate or the Interviewer in an Attempt.

**Evidence**:
The Events of a completed Attempt that a Review may cite. Evidence never changes after the Attempt completes.
_Avoid_: data, logs

### Review

**Review**:
An AI evaluation of the Evidence of one completed Attempt.
_Avoid_: grade, score

**Finding**:
One claim in a Review that cites Evidence.
_Avoid_: feedback item

**Correction**:
A candidate's dispute of a Finding.
_Avoid_: appeal

### Voice

**Voice reservation**:
A budget of voice seconds held for one voice connection to an Attempt.

### Surfaces

**Personal practice**:
Practice whose Attempts and Evidence belong to the signed-in Candidate.
_Avoid_: live demo, real mode

**Sample**:
The fictional practice flow that needs no account and records nothing.
_Avoid_: prototype, demo

### Access and consent

**Account**:
The identity a Candidate uses to access their personal practice records.

**Sign-in session**:
An authenticated period of access to an Account; it can span multiple Attempts.
_Avoid_: Attempt, practice session

**Site collection**:
The records collected on the public site independently of any Account: Measurement
events, Feedback responses, Bug reports and Waitlist entries.
_Avoid_: analytics, telemetry

**Collection policy**:
The approved purpose, disclosures, access, retention, and deletion rules for a
particular kind of collected record. Approval for one kind does not approve another.

**Operator**:
The person authorized to inspect aggregate reports and privately triage collected
feedback, bug reports, and waitlist records.
_Avoid_: Interviewer, Candidate

**Waitlist entry**:
A person's consented request for contact about Coursay. It is separate from an
Account and grants no access to personal practice.

**Withdrawal receipt**:
The proof given when joining the waitlist that permits withdrawal of that entry.
_Avoid_: password, sign-in token

### Measurement

**Document**:
One page load of the application. A random identifier links the measurement events of one Document; a reload or new tab starts a new one.
_Avoid_: visitor, user, session

**Measurement event**:
One allowlisted record of a page view, interaction or outcome. It never identifies a person.
_Avoid_: tracking, analytics hit

**Landing experiment**:
A pre-registered randomized comparison of a control and one treatment wording of the landing page, assigned by Document. Its result is an interval or an inconclusive result, never an automatic winner.
_Avoid_: A/B winner, split test

**Variant**:
The control or the treatment of a Landing experiment. Its version changes with its copy.

**Eligible exposure**:
A Document that showed its assigned Variant and is neither automated nor internal. Only eligible exposures enter the comparison.

### Site feedback

**Feedback response**:
An anonymous answer to the contextual question of one page: a preset, a comment, or both. It is not a Correction and does not change a Finding.
_Avoid_: review, rating

**Bug report**:
A private report of what someone expected and what happened instead, with allowlisted diagnostics and an optional reply address. It is triaged by the operator, never posted publicly.
_Avoid_: ticket, issue (the issue tracker is a different thing)

### Content research

**Source observation**:
A description of visible content or a caption tied to its original source and a region or time range. It does not establish performance.

**Content hypothesis**:
A proposed explanation of how an observed structure might help communicate Coursay. It is not a measured outcome.

**Campaign brief**:
A proposal linking source observations, supported product facts, an original script and a measurement definition. Approval records human review, the owner's production and distribution choices, and the actual launch action.

**Experiment outcome**:
The comparison of each Content hypothesis of a Campaign brief with an imported aggregate report and self-selected feedback, with a revised recommendation and unresolved explanations. Its counts are site-wide for the window: campaign attribution is unknown, and it does not show that the brief caused them.

**Aggregate report**:
The Coursay operator report downloaded for content planning. Content planning imports only its allowlisted counts and identifiers.
_Avoid_: export, dump
