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

**Sample**:
The fictional practice flow that needs no account and records nothing.
_Avoid_: prototype, demo

### Measurement

**Document**:
One page load of the application. A random identifier links the measurement events of one Document; a reload or new tab starts a new one.
_Avoid_: visitor, user, session

**Measurement event**:
One allowlisted record of a page view, interaction or outcome. It never identifies a person.
_Avoid_: tracking, analytics hit

### Site feedback

**Feedback response**:
An anonymous answer to the contextual question of one page: a preset, a comment, or both. It is not a Correction and does not change a Finding.
_Avoid_: review, rating

### Content research

**Source observation**:
A description of visible content or a caption tied to its original source and a region or time range. It does not establish performance.

**Content hypothesis**:
A proposed explanation of how an observed structure might help communicate Coursay. It is not a measured outcome.

**Campaign brief**:
A proposal linking source observations, supported product facts, an original script and a measurement definition. Approval records human review, the owner's production and distribution choices, and the actual launch action.

**Experiment outcome**:
An operator-reported measurement and feedback, with an evidence reference and a proposed change for the next campaign brief.
