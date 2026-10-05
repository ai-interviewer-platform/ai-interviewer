# Development

Run commands from the repository root. Use Node.js 24 (matching CI), npm, and
Docker's Linux engine for Python execution. On PowerShell, `npm.cmd` works if
execution policy blocks `npm.ps1`.

## Browser and Worker

```sh
npm ci
npm run dev
```

Wrangler builds `src/browser/voice-agent.js` and `src/browser/code-editor.js` before serving or deploying.
`public/voice-agent.js` and `public/code-editor.js` are generated and ignored. The sample needs no personal
collection. The configured Hyperdrive binding requires local database setup for
the default Worker preview; the AI binding can call a remote service.

## Local personal practice

```sh
npm run db:local:setup
npm run db:local:start
npm run migrate:postgres
npm run db:local:verify
npm run db:local:verify-auth
```

Review local `.env` and `.dev.vars` before enabling personal collection. Keep test
data fictional. See [deployment policy prerequisites](production-deployment.md#collection-policy-prerequisites).

For Python execution:

```sh
npm run runner:build
npm run runner:dev  # terminal 1
npm run dev:runner  # terminal 2, replaces npm run dev
```

See [the runner guide](../reference/python-runner.md) for prerequisites and
troubleshooting. For live voice, set server-only `DEEPGRAM_API_KEY` in `.dev.vars`.
Review configuration lives in [review processing](../reference/review-processing.md#configuration).

## Generated auth schema

Regenerate `src/db/generated-auth.ts` with Better Auth's CLI; keep its output
tracked and review related migrations:

```sh
npx auth@latest generate --adapter drizzle --dialect postgresql --config ./auth.schema.ts --output ./src/db/generated-auth.ts --yes
```

Applied SQL migrations are immutable and use LF endings. Add a new migration
when changing an applied schema.

## Verification

```sh
npm run check
npm run lint
npm test
npx wrangler deploy --dry-run
```

`check` builds the voice asset before tests import browser modules. Database
integrations use a disposable local PostgreSQL target and `npm run test:postgres`.
Container checks use `npm run test:runner` and `npm run test:runner:api`.
CI's sequence lives in [backend-ci.yml](../../.github/workflows/backend-ci.yml).

With a running preview:

```powershell
$env:APP_URL = 'http://127.0.0.1:8787'
npm run test:browser
npm run test:discovery
node test/browser/security-check.mjs
```

Browser checks prefer Edge, then Playwright Chromium. Select a browser with
`PLAYWRIGHT_CHANNEL` or `PLAYWRIGHT_EXECUTABLE_PATH`. With the local database,
runner, and personal collection enabled, `node test/browser/personal-flow-check.mjs`
exercises sign-up through practice, review, and sign-out. Artifacts stay in ignored
`output/`. Share credentials through the [encrypted handoff](sharing-development-env.md).
