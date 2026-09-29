# Local marketing research

Provider foundation for [01](https://github.com/ai-interviewer-platform/ai-interviewer/issues/17) and [02](https://github.com/ai-interviewer-platform/ai-interviewer/issues/18). These tickets remain open: automated acquisition, Qwen/Jev workflow and the developer search UI are not implemented by this slice.

## Keys

Copy `tools/marketing/config.example.env` to `.env.marketing.local` at the repository root. That file and `.local/` are gitignored. Run commands from this checkout. Never upload this environment file or put keys in GitHub issues.

| Variable | Supply |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio Gemini API key |
| `DASHSCOPE_API_KEY` | Alibaba Model Studio API key for the chosen region |
| `DASHSCOPE_BASE_URL` | Alibaba HTTPS origin; example template uses Singapore DashScope |
| `GEMINI_COVERED_USAGE_CONFIRMED` | `true` after checking this model's free access |
| `DASHSCOPE_COVERED_USAGE_CONFIRMED` | `true` after checking this model's remaining quota/coupon |

The confirmation flags record operator acknowledgement, **not a billing guarantee**. Enable provider-side free-quota-only protection where available; verify expiry/remaining coverage before running. No retries, provider fallback or automatic background calls. Ctrl+C cancels the current HTTP request; a provider may already have processed it. Keys stay in this local process. Monid remains exclusively for Jev, using its existing CLI credential store.

## Commands

```powershell
npm run marketing -- smoke gemini
npm run marketing -- smoke tongyi
npm run marketing -- add gemini path/to/source.json
npm run marketing -- search gemini "coding interview demo"
npm run marketing -- list
```

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

This CLI has no listener, public routes or assets. `tools/marketing` and `.local` are outside the Worker's `src` graph and `public` assets. The future UI must remain a separate loopback-only developer process, not an authenticated production page.

## Verification and sources

`node --test test/marketing-embeddings.test.mjs` exercises provider HTTP contracts, configuration gates, persistent retrieval and failure lineage with external HTTP fixtures. These are not live-provider proof.

Live verification, 2026-09-29, after keys and coverage confirmations were supplied locally:

| Endpoint | Result |
|---|---|
| Alibaba `tongyi-embedding-vision-plus` | Text and PNG succeeded; each returned 1,152 dimensions. Usage: 4 text input tokens; 66 image input tokens. Billing amount not returned. |
| Google `gemini-embedding-2` | Text request returned HTTP 402 / RESOURCE_EXHAUSTED: prepaid credits depleted. Image call not attempted after failure. Adapter fixture tests pass; live embedding unverified. No top-up or fallback performed. |
| Monid `typesafe /systemone`, `jev-1.13.0` | HTTP 200; synthetic CTA correctly classified as practice. 347 input tokens; reported charge 15 microdollars ($0.000015). |

Use Tongyi while Gemini billing remains blocked. Successful responses prove endpoint/model access, not continuing free entitlement or marketing prediction quality.

- [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings): native media, retrieval instructions, one vector per content.
- [Alibaba multimodal embeddings](https://www.alibabacloud.com/help/en/model-studio/multimodal-embedding-api-reference): native request/response; Tongyi independent inputs.
- [Alibaba regions](https://www.alibabacloud.com/help/en/model-studio/regions): region-bound keys and hosts. The embedding page has inconsistent region wording; actual account access must be smoke-tested.

Next skill route: `/implement` drives `/tdd` and `/code-review`. Ticket 01 also uses `/monid` for Jev only and `/error-handling-patterns` for resumable stages. Ticket 02 uses `/codebase-design` for retrieval and lineage. No need to restart Wayfinder.
