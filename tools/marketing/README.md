# Local marketing research

Local workflow for [01](https://github.com/ai-interviewer-platform/ai-interviewer/issues/17), with integrated multimodal retrieval for [02](https://github.com/ai-interviewer-platform/ai-interviewer/issues/18). See [operator workflow](OPERATIONS.md) for captions, indexing, retrieval and evaluation; [coverage evidence](COVERAGE.md) separates live proof from fixtures.

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

The confirmation flags record operator acknowledgement, **not a billing guarantee**. Enable provider-side free-quota-only protection where available; verify expiry/remaining coverage before running. No automatic model-provider fallback or background research. Acquisition can fall back from Firecrawl to a configured public-video extractor. Ctrl+C cancels the current HTTP request; a provider may already have processed it. Keys stay in this local process. Monid remains exclusively for Jev, using its existing CLI credential store.

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

Automated acquisition requests markdown, links, screenshot and video from Firecrawl with ads enabled. Public social posts can fall back to platform-specific yt-dlp extraction; local config, cookies and plugins are not used. If video extraction fails, a page-only capture is explicitly labeled. Page screenshots are explicitly distinct from native images and video frames. Native video URLs are followed automatically when supplied by Firecrawl or the extractor. The first extracted creative is analyzed; remaining links stay inspectable for import. Signed video URLs can expire. Video observations preserve parent source identity and time ranges. Available public captions are extracted separately and passed to Jev with timed provenance; missing captions remain explicit. Unsupported URLs and missing media remain visible; usable page text is retained. There is no claim of access to a platform's private ad corpus or of complete video coverage from thumbnails. Repeated captures retain the same source ID across runs; individual runs retain their own provenance.

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

Use only authorized public research material; no candidate recordings/code. Text input: `{ "modality": "text", "text": "...", "title": "..." }`. Gemini video: base64 `data` and `mimeType`. Tongyi video: `{ "modality": "video", "url": "https://..." }`; Alibaba fetches that public media URL. Image input uses base64 with both providers. Embedding CLI inputs must fit provider limits. The research UI separately segments local videos for Qwen vision; available publisher/automatic caption evidence is kept separate from visual observations.

## Architecture

```text
Local discovery / operator imports
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

## Reference dashboard and native video

See [reference contract](REFERENCE.md). The local UI reproduces the supplied demo layout and visible animations with actual run counters, twelve Jev judgments, category distributions, review cards and a final summary. Open **Research controls** to discover sources, import a public URL, supply its optional linked landing page, upload a video or reopen history. Click a tile to stop following newest results; use **Follow newest** to resume. **Evidence & review** contains timestamps, provenance and categorical/numeric human corrections. Timestamp buttons seek the selected video.

Set `FFMPEG_PATH` to an installed FFmpeg executable for uploads. Install the optional public-video extractor with `python -m pip install yt-dlp`, then set `YTDLP_PYTHON` to that Python executable. For a private `pip --target` installation, set `YTDLP_PYTHONPATH` to the target directory. These tools remain local, outside the production Worker.

Uploads retain original bytes under ignored `.local/marketing/research/media/`; H.264 playback and JPEG posters are served only through validated media IDs with byte-range support. FFmpeg's file/pipe protocol allowlist prevents local uploads from causing network fetches. Oversized videos are bisected only when measured base64 size reaches Alibaba's 10 MB limit or duration exceeds two hours. Segment offsets refer to the original timeline. A segment shorter than the provider's two-second minimum is rejected. Successfully analyzed segments persist for resume. Qwen observes sampled frames, not every frame or audio. Originals are never deleted automatically.

Advertiser counts require observed brand evidence. Durability scores mean evergreen relevance, not observed time in market. Homepage match stays unknown without a separate page capture. Human review flags unknown/missing evidence, with no confidence cutoff. Costs contain available Exa/Jev receipts only and are labeled partial; elapsed/rate includes acquisition and vision, not just Jev inference.

Run `node --test test/marketing-*.test.mjs`; set `FFMPEG_PATH` in the test process to include the real codec/upload/playback/browser-seeking test. Other tests use external HTTP/process fixtures. Live checks are documented separately from fixture proof. No private ad-library access or paid speech transcription is claimed.

### Native video and design verification (2026-09-29)

- Supplied 48.27-second reference upload: four size-derived segments, 47 timestamped observations from Qwen3.8-max, all twelve Jev judgments. Jev receipt: $0.000752. Run `a7869dca-c331-4fd5-8499-202d1d39f35b`. The original large inline Jev input exceeded Windows' command-line limit; verified pre-launch failure, recovered with `--input-file`, reused saved vision evidence.
- Public online video `https://www.youtube.com/watch?v=BUst9tSsTQE`: Firecrawl native video → Qwen → Jev completed; 23 timestamped observations, twelve judgments, Jev receipt $0.000306. This is a 5m14s Grammarly tutorial, not ad-performance evidence. Run `772c3e79-d4ba-4ac8-b57a-1ae3f61c6928`.
- Original X reference: Firecrawl returned HTTP 500; configured yt-dlp recovered the native 48.266-second public video and original-post metadata. This separately proves acquisition fallback.
- Updated to supplied `Video Analysis.dc.html` design/motion system; rendering runtime `support.js` not shipped. Desktop/mobile screenshots, summary, reduced motion, native playback/seek, categorical/numeric corrections and axe accessibility check passed. Full suite: 100 passed; typecheck, lint and targeted checks after the file-input fix passed. Standards and Spec review findings resolved.

These earlier checks are supplemented by COVERAGE.md. The operator UI now connects research outputs to embedding retrieval and evaluation. The tool remains loopback-only.

## Strategy and scripts (Ticket 03)

Open **Strategy & scripts**, enter goal/audience, choose supported product facts and saved source evidence, then **Generate draft**. Library results also offer **Use in strategy**. Generation uses direct Alibaba `STRATEGY_MODEL` (default owner-requested `qwen3.8-max`), independently from Jev and the vision adapter. `STRATEGY_PROVIDER=qwen` is currently supported; no Astra endpoint or Monid generation route is assumed. Existing `DASHSCOPE_API_KEY`, matching host and `QWEN_COVERED_USAGE_CONFIRMED` apply.

Every brief saves original source/region/time snapshots, product proof, explicitly labelled hypotheses, original hook/script, creative notes, measurement definition and assumptions. A separate Qwen claim audit checks unsupported product claims, invented performance, broken evidence and copied scripts. Broken IDs and unsupported fact references are also rejected deterministically. A structured proposed launch action is bound to the owner choice and live landing action; the audit also rejects CTA wording that implies a different action. Model audits are fallible; successful audits still require human review. Rejected proposals remain visible and exportable for diagnosis.

CTA/distribution remain proposed until the operator records reviewer/rationale, selected format, channel/community access, organic/paid sequencing and CTA. Approval checks `STRATEGY_LAUNCH_BASE_URL` against the actual Coursay `/api/landing-config` and `/api/site-config`: an unset/different primary action, disabled waitlist or unavailable personal practice blocks approval. Leave this URL unset while planning. Changing the proposed format/channel/CTA requires a new brief. **Export review artifact** never publishes; there is no publishing endpoint.

Record outcomes as described in Ticket 09 below. Select that previous experiment when generating again; its recorded outcomes enter the next proposal. No cadence, ad spend, hiring gains or additional language support is implied.

Briefs and review/outcome history persist under `research/strategy/`; configured Cloudflare sync runs after each mutation. The UI reports verified/pending/local-only archive state. The research UI and APIs remain loopback-only and outside public assets.

## Measured outcomes (Ticket 09)

This capability stays in the local developer tool. The live Coursay deployment only gains **Download aggregate report (JSON)** on its private `#operator` page; no research UI, API or data enters the Worker.

1. In Coursay `#operator`, load the measurement report for an explicit window and download the aggregate report.
2. In **Strategy & scripts**, open the brief and use **Compare outcomes for the next brief**: import the file, compare each hypothesis with what the aggregates show and with the self-selected feedback, assess it as consistent, inconsistent or inconclusive, then record a revised recommendation and the unresolved explanations.
3. Select the brief as the previous experiment and generate again. The revised brief records `previousId` and `basedOnOutcomes`, the outcome IDs it used.

The import accepts only the Coursay report. It keeps the window, the landing documents and steps with their denominator, the personal cohort, waitlist counts, and feedback theme counts (preset answer and operator category), each with its definition. A report with any other key at any level, a non-count value or free text in an identifier is rejected; the report's free-text limitations are not imported. Feedback comments, bug reports, waitlist emails, heatmaps, raw events and experiment data never enter the tool, and personal records stay in Coursay. Creative sources stay in the research records.

Coursay records no campaign attribution, so every count is site-wide for the window and the outcome records `campaign: unknown`; no join to the brief is made. Each outcome states that it is observational: a change in counts, a heatmap pattern or self-selected feedback does not show that the brief caused it. The generation and claim-audit prompts carry the same rule. An inconclusive assessment is a valid result.

`node --test test/marketing-strategy.test.mjs` demonstrates outcome → revised brief lineage with a fixture report and the rejection cases. `test/experiment-integration.mjs` imports a report downloaded from the real Coursay operator page.
