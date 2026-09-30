# Local research operating contract

## Operator flow

1. **Research controls**: enter a topic or use the visible saved Coursay audience context; choose the source count. Discovery uses Exa directly, acquisition uses Firecrawl directly and a configured public yt-dlp extractor. Runs never start on a schedule.
2. **Analyze**: inspect source media, timed Qwen observations, twelve Jev judgments and missing evidence. Cancel/resume preserves successful stages. An uncertain Jev submission requires reconciliation with its existing Monid run ID.
3. **Evidence & review**: caption cues have time ranges, language and publisher/automatic provenance. They are separate from visual observations. Captions can be wrong or unavailable; no speech is inferred from visible lips or page copy. Reviewer labels/scores append, leaving original judgments intact.
4. **Library & search**: explicitly choose Tongyi or Gemini, then the image/poster, native video or readable evidence to index. Local Gemini video requires a chosen segment when multiple chunks exist. Tongyi accepts public video URLs; local videos are not uploaded to a public host. A poster is labeled poster-only. Create another revision to capture changed evidence or corrections.
5. Search embeds the query in that provider's vector space. Filter by modality and the revision's hook label; open the original source, indexed evidence snapshot, or current research run. Results are semantic similarity, never predicted conversion performance.
6. **Coverage & evaluation**: inspect source gaps, access/provenance, actual available receipts, model identities and per-stage latency. Latest reviewer judgment per field forms the reference set; original correction history stays in the run. The report counts agreements/disagreements and includes rationales. There is no pass threshold, confidence cutoff, or fabricated accuracy metric.

## Models and taxonomy

- Exa / Firecrawl: direct accounts. Capture errors and unavailable media remain source records.
- `qwen3.8-max`: visual observations, image regions or video timestamps. Local segments retain the parent timeline. Sampled frames do not prove every frame was inspected.
- Captions: public yt-dlp metadata plus JSON3/WebVTT tracks. Prefer publisher captions; otherwise automatic captions. Prefer reported original language, then English, then an available supported language; record what was selected. No translation or paid transcription fallback.
- Monid exclusively routes `typesafe /systemone`, pinned `jev-1.13.0`. Readable observations, captions, page text and any separately captured landing evidence go to Jev, never embedding vectors. Captions remain untrusted source data.
- `marketing-v2`: categorical hook, format, awareness, offer, CTA, driver, funnel, claim risk and homepage match; hook specificity, offer strength and durability use the supplied 0–3 reference rubrics. Exact options/rubrics are returned by `/api/context` and defined in `research-providers.mjs`.
- Unsupported/ambiguous categorical judgments abstain as `unknown`; missing visible evidence makes scores unknown. Homepage match is unknown without a separate landing capture. Claim risk is a review flag; durability describes evergreen relevance, not measured ad longevity.
- Direct `gemini-embedding-2` and `tongyi-embedding-vision-plus` use separate provider/model/dimension/encoding spaces. Provider aliases do not reveal immutable model weights; timestamps and input hashes preserve observable lineage. Google 402 remains an account availability limitation, not an automatic fallback trigger.

## Local records and export

- Runs: `.local/marketing/research/<run-id>.json`; originals/playback/segments/posters: `research/media/`.
- Embedding revisions: `research/embeddings/<revision-id>.json`; immutable source/evidence/label snapshots, input hash, modality, model, dimensions, usage and timestamp. Failed acquisition or embedding appends explicit unavailability and retains existing ready revisions. Browser responses omit vectors.
- CLI `add/search/list` and browser now share `research/embeddings/`. Earlier CLI records under `.local/marketing/embeddings/` remain untouched; move reviewed JSON records into the shared directory if wanted.
- Run JSON and evaluation JSON export locally. Configured Cloudflare archives sync after a run, correction, context change or embedding save and on CLI server start. See [Cloudflare recovery](CLOUD.md). No automatic deletion; credentials never enter the archive.
- Source identity is based on the normalized original source URL (fragment removed); each capture/run is distinct. Extractor original URLs and page-reported canonical hints retain mirrored provenance without pretending different URLs are verified duplicates. Local uploads have their own IDs. Access is public without credentials/cookies, or operator-supplied local media.
- Public views/likes/comments, when returned, are timestamped observed counters. They do not establish paid impressions, spend, conversions or virality. Missing metrics remain null.
- Config remains `.env.marketing.local`. Covered-usage flags are operator acknowledgements, not billing guarantees. Provider-side quota/coupon controls remain necessary. Stop on exhausted coverage; no paid fallback. Cancel does not undo requests a provider already accepted.

## Verification boundaries

Fixture tests cover the browser, local API and full workflow with external HTTP/process fixtures. The codec test uses real FFmpeg, playback and seeking. API tests prove host/origin rejection, source-linked retrieval, provider isolation and retained failures. Browser checks include responsive layouts, reduced motion, provider failure/resume and axe accessibility. Live checks use public research media and are recorded separately in `COVERAGE.md`.

Selected connectors cover accessible public media, not every platform's private ad library. Protected, deleted, geo-blocked, expired or unavailable media/captions stay explicit. ContentHooks is workflow inspiration; no private API or corpus access is assumed.

## Design and motion

`REFERENCE.md` preserves the supplied visual/motion contract. Analyze retains the reference dashboard. Library adds source indexing controls beside ranked evidence cards; evaluation adds a readable coverage table and reference disagreements. Same paper/gray palette, square borders, mono labels, snap updates and brief gray-to-ink arrival. Existing summary transitions and reduced motion remain. No simulated throughput, fake ads or copied demo metrics.
