# Coursay

Python interview practice. AI interviewer, saved code and transcripts,
evidence-linked feedback, focused retries.

Try the fictional sample without an account. Personal practice requires a
configured backend and approved data collection.

## Start

```sh
npm ci
npm run dev
```

Wrangler builds the voice client and serves the browser app and API together.
See [development](docs/operations/development.md) for database, runner, voice,
and verification setup.

## Find your way

| Need | Read |
| --- | --- |
| Vocabulary | [Glossary](CONTEXT.md) |
| Folders and filing rules | [Repository guide](docs/README.md) |
| Product boundaries | [Product contract](docs/product/contract.md) |
| API and integrations | [Backend API](docs/reference/backend-api.md) |
| Visual and motion rules | [Design system](docs/design/design-system.md) |
| Deploy and operate | [Deployment](docs/operations/production-deployment.md) |
| Content research | [Marketing tools](tools/marketing/README.md) |

## Check

```sh
npm run check
npm run lint
npm test
```

Commands live in [package.json](package.json). See the
[tracking rules](docs/README.md#what-belongs-in-git) before committing.
