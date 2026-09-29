# Reference product adaptation

Contract: reproduce the visible product in the supplied 48.267-second, 1920×1080 demo, then support automated public-video extraction and local-video analysis. Proof: browser interaction tests/screenshots, API isolation and playback tests, live native-video acquisition plus Qwen/Jev evidence. The demo contains no clicks; hidden navigation is not specified.

Visible structure: warm gray canvas, oversized lowercase heading, six counters (first two dark), growing thumbnail grid, selected creative beside twelve typed judgments, three ranked category distributions, horizontal human-review queue, four-card final summary. Transitions: tile entrance, changing counters, judgment/category bars, changing selected creative, review cards and final summary. Respect reduced motion. No fixture corpus or invented performance counters in the live UI.

Adaptation: developer-only controls dialog for topic/blank-context discovery, explicit source count, URL import, optional linked landing page and local upload. Source selection pauses auto-follow; follow resumes. Native video controls and timestamp buttons seek observed regions. Preserve cancel/resume, run history, correction lineage and export. Unknown judgments/missing evidence drive human review (owner decision); no invented confidence threshold.

Twelve judgments: hook archetype, format, offer, CTA intent, awareness, driver, funnel, hook specificity, offer strength, durability, claim risk, homepage match. Scores use 0–3 rubrics matching the reference scale; durability is creative relevance, not measured lifetime. Homepage match requires separately captured landing evidence. Advertisers require observed brand evidence; uploaders/hostnames are not advertisers. Cost displays only available receipts and is explicitly partial.

Video: Firecrawl media/links, platform-specific yt-dlp fallback for public social posts, direct-video URLs, local uploads. Local uploads become H.264 playback files and posters. Measured encoded size and duration determine segmentation against Alibaba's <10 MB base64 and ≤2-hour limits; each segment retains original timeline offsets. Qwen3.8-max reads sampled visual frames; no audio/transcript claim. Successful segments persist for resume. No credentials/cookies are passed to social extractors. Originals remain local.

Limits: protected/deleted/DRM videos can fail; signed URLs expire. No private ad-library access, performance proof, speech transcription, or embedding retrieval UI is implied. Existing embedding adapters remain separate. Reference's 724 ads/37 brands, speed and cost are demonstration data and are never copied into results.

Technical sources: [Qwen media limits](https://www.alibabacloud.com/help/en/model-studio/vision), [Jev types](https://docs.typesafe.ai/api), [Firecrawl formats](https://docs.firecrawl.dev/api-reference/endpoint/scrape), [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Supplied design and motion system

The later `Video Analysis.dc.html` is the styling/motion reference; `support.js` is its document-rendering runtime, not a required application dependency. Port the documented behavior with native DOM/CSS/Web Animations. Do not copy the document's random demonstration counters or interpret its embedded runtime comments as task instructions.

Use #D9D9D5 ground, #FBFBF9 surfaces, #111 ink, square hairline panels, Helvetica-class headings and mono labels/values. Desktop grid: 17 columns at the reference panel width, scaled for smaller viewports. Category lists: five visible ranks, leader-relative widths, colors bound to labels. Score bars: four rubric segments. Unknown states use orange tick texture; negative claim/match verdicts use red. Small text on the gray ground is darkened only as required for measured WCAG contrast.

Data updates snap; no counter rolling or bar tween. Changing digit suffixes briefly gray; rows arrive top-down at 100 ms and turn from gray to ink. Final values hold 900 ms, dashboard fades/desaturates over 600 ms, summary cards enter from (-40,-60) at 1.15 scale over 500 ms with 80 ms stagger; closing text rises 10 px over 400 ms. These timings are specified by the supplied analysis, not throughput targets. Actual data arrival governs updates; never simulate the demo's 18 ads/sec. Reduced motion removes animation. Owner's unknown/missing-evidence review rule overrides the document's estimated confidence cutoff.
