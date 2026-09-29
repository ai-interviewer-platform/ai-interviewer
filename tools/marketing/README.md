# Local marketing research

Local workflow for [01](https://github.com/ai-interviewer-platform/ai-interviewer/issues/17), with embedding CLI foundation for [02](https://github.com/ai-interviewer-platform/ai-interviewer/issues/18). Ticket 01 remains open for real ad/short-form/long-form coverage validation. Ticket 02's retrieval UI integration remains open.

## Keys

Copy `tools/marketing/config.example.env` to `.env.marketing.local` at the repository root. That file and `.local/` are gitignored. Run commands from this checkout. Never upload this environment file or put keys in GitHub issues.

| Variable | Supply |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio Gemini API key |
| `DASHSCOPE_API_KEY` | Alibaba Model Studio API key for the chosen region |
| `DASHSCOPE_BASE_URL` | Alibaba HTTPS origin; example template uses Singapore DashScope |
| `GEMINI_COVERED_USAGE_CONFIRMED` | `true` after checking this model's free access |
| `DASHSCOPE_COVERED_USAGE_CONFIRMED` | `true` after checking this model's remaining quota/coupon |
| `EXA_API_KEY` | Existing Exa account; direct discovery |
| `FIRECRAWL_API_KEY` | Existing Firecrawl account; direct page extraction |
| `QWEN_COVERED_USAGE_CONFIRMED` | `true` after checking Qwen3.8-max coupon/quota coverage |
| `MONID_CLI_PATH` | Installed `@monid-ai/cli/dist/index.js` absolute path; CLI handles the Jev-only key |

The confirmation flags record operator acknowledgement, **not a billing guarantee**. Enable provider-side free-quota-only protection where available; verify expiry/remaining coverage before running. No retries, provider fallback or automatic background calls. Ctrl+C cancels the current HTTP request; a provider may already have processed it. Keys stay in this local process. Monid remains exclusively for Jev, using its existing CLI credential store.

## Commands

```powershell
npm run marketing -- serve
npm run marketing -- smoke gemini
npm run marketing -- smoke tongyi
npm run marketing -- add gemini path/to/source.json
npm run marketing -- search gemini "coding interview demo"
npm run marketing -- list
```

`serve` prints an OS-assigned `http://127.0.0.1:PORT` address. Open that exact address. Host/origin checks reject other origins; no production route, API or research asset is added. Keys never reach the browser. Ctrl+C cancels local in-flight work; already-submitted provider jobs may still complete and consume credits.

The browser supports topic or blank-context discovery, operator-entered source count, streamed progress, cancellation, restart/resume, manual public page/image/video import, sorting/filtering, JSON export and append-only human judgment history. Source count is an operator choice, not a dollar cap. Exa/Firecrawl/Qwen costs are not inferred from tokens; actual available receipts are retained. Successful stages are reused on resume. An uncertain Jev submission requires its existing run ID from Monid history, avoiding an automatic duplicate bill.

Automated page acquisition requests markdown, links and screenshot from Firecrawl with ads enabled. Page screenshots are explicitly distinct from native images and video frames. A discovered direct video URL can be analyzed automatically; other media links remain unverified and can be imported explicitly. Video observations preserve parent source identity and time ranges. Audio/captions are not transcribed by this implementation. Unsupported URLs and missing media remain visible; usable page text is retained. There is no claim of access to a platform's private ad corpus or of complete video coverage from thumbnails. Repeated captures retain the same source ID across runs; individual runs retain their own provenance.

Smoke sends synthetic text and a synthetic PNG separately: this verifies both text and image request shapes. It prints model, dimension, usage when supplied and latency; never vectors or keys. A missing key/coverage confirmation fails before a request.

`source.json` contains:

```json
{
  "source": {
    "id": "operator-source-id",
    "segmentId": "opening-frame",
    "url": "https://example.com/original-creative",
    "evidence": {"observations": ["Observed hook copy"], "coverage": "single frame; audio unknown"},
    "labels": {"hook": "unknown"}
  },
  "input": {"modality": "image", "mimeType": "image/png", "data": "BASE64_OF_AUTHORIZED_IMAGE"}
}
```

Use only authorized public research material; no candidate recordings/code. Text input: `{ "modality": "text", "text": "...", "title": "..." }`. Gemini video: base64 `data` and `mimeType`. Tongyi video: `{ "modality": "video", "url": "https://..." }`; Alibaba fetches that public media URL. Image input uses base64 with both providers. Inputs must fit provider media/token limits; this slice does not segment, transcribe or download media automatically.

## Architecture

```text
Local operator / future local acquisition workflow
                  |
       source + segment + evidence + Jev labels
                  |
          shared embedding interface
          /                       \
 Gemini Developer API       Alibaba DashScope
 gemini-embedding-2         tongyi-embedding-vision-plus
          \                       /
  immutable local records, separated by vector space
                  |
  same-model query -> ranked source links + evidence
```

One independent text/image/video input per request. No pretend fusion of Tongyi independent vectors. Each record retains provider, model ID, encoding version, actual dimensions, modality, input hash, timestamp, source and segment. Model IDs are provider aliases; timestamps do not pin the provider's hidden weights. Re-embedding appends a revision; failures append explicit unavailability without destroying prior records. Search returns compatible revisions only, including their IDs; old revisions remain inspectable. Switching providers requires embedding the material in that provider's space. Similarity is not evidence of conversion. Vectors are never passed to Jev.

The server binds only to IPv4 loopback; only its explicit UI files and research API routes are served. `tools/marketing` and `.local` are outside the Worker's `src` graph and `public` assets. Deployment dry-run verified the production bundle excludes this tool.

## Verification and sources

`node --test test/marketing-embeddings.test.mjs` exercises provider HTTP contracts, configuration gates, persistent retrieval and failure lineage with external HTTP fixtures. These are not live-provider proof.

Live verification, 2026-09-29, after keys and coverage confirmations were supplied locally:

| Endpoint | Result |
|---|---|
| Alibaba `tongyi-embedding-vision-plus` | Text and PNG succeeded; each returned 1,152 dimensions. Usage: 4 text input tokens; 66 image input tokens. Billing amount not returned. |
| Google `gemini-embedding-2` | Text request returned HTTP 402 / RESOURCE_EXHAUSTED: prepaid credits depleted. Image call not attempted after failure. Adapter fixture tests pass; live embedding unverified. No top-up or fallback performed. |
| Monid `typesafe /systemone`, `jev-1.13.0` | HTTP 200; synthetic CTA correctly classified as practice. 347 input tokens; reported charge 15 microdollars ($0.000015). |

Use Tongyi while Gemini billing remains blocked. Successful responses prove endpoint/model access, not continuing free entitlement or marketing prediction quality.

Ticket 01 live verification, 2026-09-29: synthetic Qwen3.8-max vision succeeded (1,414 tokens), then Exa → Firecrawl → Qwen3.8-max → Jev completed on `https://github.com/varunshetty1893/AI-Interviewr`. Exa reported $0.007; Qwen used 5,390 tokens under the owner's confirmed coupon; Jev reported $0.000389. Firecrawl did not return a billing receipt. This was a related repository page, **not proof of an ad, short-form clip or accessible full video**. The UI records page-screenshot coverage; media-specific live acceptance remains open. Fetching the existing Monid run by ID also passed, without another inference submission.

Browser fixtures verify blank-query discovery, source links, evidence inspection, corrections and responsive layout. API fixtures verify origin/host isolation and shutdown cancellation. Workflow fixtures cover missing media reacquisition, malformed/provider errors, source deduplication, source/time lineage and uncertain-submission protection. Evidence screenshots are generated under ignored `.local/marketing/`.

- [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings): native media, retrieval instructions, one vector per content.
- [Alibaba multimodal embeddings](https://www.alibabacloud.com/help/en/model-studio/multimodal-embedding-api-reference): native request/response; Tongyi independent inputs.
- [Alibaba regions](https://www.alibabacloud.com/help/en/model-studio/regions): region-bound keys and hosts. The embedding page has inconsistent region wording; actual account access must be smoke-tested.
- [Exa search](https://exa.ai/docs/reference/search) and [Firecrawl scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape): direct source discovery/extraction contracts.
- [Qwen vision](https://www.alibabacloud.com/help/en/model-studio/vision): image/video content types; video frames do not include audio understanding.

Next skill route: `/implement` drives `/tdd` and `/code-review`. Ticket 01 also uses `/monid` for Jev only and `/error-handling-patterns` for resumable stages. Ticket 02 uses `/codebase-design` for retrieval and lineage. No need to restart Wayfinder.
