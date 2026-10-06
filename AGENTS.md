# AGENTS.md

When adding or moving repository files, follow [the repository guide](docs/README.md).
Keep domain terms in `CONTEXT.md`, contracts in their owning docs, and work status in the issue tracker.

## Required change workflow

- After all changes are finalized, always run the `ponytail` and `code-review` skills. Complete both before committing. If either review leads to edits, run both again on the finalized changes.
- Always use `write-ste-commit-message` to write commit messages.
- When committing, stage all relevant changes together in the same commit. Keep unrelated changes in separate commits.
- Always use `pr` to write pull request descriptions.

Read and follow each skill's `SKILL.md`. These local paths are shared by Codex and Claude Code on this machine:

- `ponytail`: `C:/Users/caoda/.codex/skills/ponytail/SKILL.md`
- `code-review`: `C:/Users/caoda/.agents/skills/code-review/SKILL.md`
- `write-ste-commit-message`: `C:/Users/caoda/.codex/skills/write-ste-commit-message/SKILL.md`
- `pr`: `C:/Users/caoda/.agents/skills/pr/SKILL.md`

## Agent skills

### Issue tracker

GitHub Issues for `ai-interviewer-platform/ai-interviewer`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
