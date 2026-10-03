# Repository guide

Start with [CONTEXT.md](../CONTEXT.md) for domain terms. Use this guide to choose
where to read or file material. Commands and dependencies live in
[package.json](../package.json); deployment wiring lives in [wrangler.jsonc](../wrangler.jsonc).

## Source ownership

| Folder | Responsibility |
| --- | --- |
| `public/` | Served browser HTML, styles, scripts, and assets |
| `src/` | Worker API, authentication, persistence, interview and review services |
| `src/browser/` | Browser source requiring bundling; builds into `public/` |
| `src/db/` | Generated Better Auth schema; regenerate rather than hand-edit |
| `runner/` | Python sandbox, container definitions, runner Worker configuration |
| `migrations/` | Ordered, checksummed database changes; preserve applied filenames and bytes |
| `scripts/` | Development, database, migration, and runner commands |
| `test/` | Unit/contract tests and backend integrations; browser and runner suites in named subfolders |
| `tools/marketing/` | Operator content-research tool and colocated usage/reference docs |
| `.github/workflows/` | CI and encrypted environment handoff |
| `.claude/skills/` | Shared installed Neon skills, recorded in `skills-lock.json` |

Root files are entry points, agent instructions, or tool-discovered configuration.
`auth.schema.ts`, `drizzle.config.ts`, and `neon.ts` stay beside that configuration.
Runtime assets keep their URLs; this layout does not require moving application modules.

## Documentation

| Location | Owns |
| --- | --- |
| [CONTEXT.md](../CONTEXT.md) | Domain glossary only: terms, meaning, preferred vocabulary |
| [product/contract.md](product/contract.md) | Durable product and trust boundaries |
| `product/` | [Waitlist](product/landing-waitlist.md), [measurement](product/measurement.md), [feedback](product/contextual-feedback.md), [bug reports](product/bug-reports.md), [experiments](product/landing-experiments.md) |
| `reference/` | [API](reference/backend-api.md), [reviews](reference/review-processing.md), [runner](reference/python-runner.md), [problem sources/licenses](reference/problem-bank.md) |
| `operations/` | [Development](operations/development.md), [deployment](operations/production-deployment.md), [environment sharing](operations/sharing-development-env.md) |
| `design/` | [Visual/motion rules](design/design-system.md), brand sources in `brand/`, original design specimen in `reference/` |
| `adr/` | Hard-to-reverse decisions and rationale; [saved-state boundary](adr/0001-interviewer-sees-only-saved-state.md), [Submission check categories](adr/0002-submission-check-records-outcome-categories-only.md) |
| `agents/` | [Domain-doc use](agents/domain.md), [issue tracker](agents/issue-tracker.md), [triage labels](agents/triage-labels.md) |
| [archive/](archive/README.md) | Dated audits and superseded status records; historical evidence only |

The design specimen and its original image/PDF attachments are reference assets,
not another app or a second design policy. Original capture names preserve their
provenance. Use [design-system.md](design/design-system.md) for maintained rules.

## Filing and naming

- Extend the existing topic document when its responsibility already fits.
- Use lowercase, hyphenated names for authored docs. Keep conventional entry
  names (`README.md`, `AGENTS.md`, `CONTEXT.md`) and tool-required names.
- Keep definitions in `CONTEXT.md`, procedures in `operations/`, and interface
  contracts in `reference/`. Link to authority instead of copying it.
- Record work status in the issue tracker. Use ignored `.scratch/` for local
  plans and handoffs. Archive useful evidence with its original date;
  do not present it as current readiness.
- Update callers and relative links when moving files. Commands run from the
  repository root unless the procedure explicitly says otherwise.
- Update the owning doc when a contract changes. Keep release status and test
  counts out of permanent reference material.

## What belongs in Git

Track maintained source, migrations, lockfiles, shared configuration, sanitized
examples, tests, and intentional design/brand references. The generated auth
schema stays tracked because migrations and application types depend on it.

Keep secrets and machine state local: `.env*` except the root `.env.example`,
`.dev.vars*` except the root example, `.neon`, `.local/`, `.wrangler/`, dependency
installs, `.scratch/`, `.firecrawl/`, `.playwright-cli/`, and `output/` are ignored.
`public/voice-agent.js` is rebuilt by Wrangler or `npm run build:voice`;
worker type declarations and design thumbnails are generated.

Before committing, inspect `git status --short` and the staged diff. Ignore rules
do not remove already-tracked files: `git rm --cached -- <path>` stops tracking
an artifact while keeping its local copy. Do not force-add secrets or generated
output. Removing a file from tracking does not remove its history.
