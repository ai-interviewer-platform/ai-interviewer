# Live coverage and evaluation evidence

Live calls use configured direct Exa/Firecrawl/Alibaba accounts and Jev-only Monid. Qwen coupon and source scope were confirmed by the operator. Fixtures are not live proof.

| Input / check | Evidence | Limits |
|---|---|---|
| Uploaded reference demo | Run `a7869dca-c331-4fd5-8499-202d1d39f35b`: 48.27s, 47 Qwen observations, 12 Jev judgments; Jev $0.000752 | Product demo, not a real ad corpus; no audio track |
| Public long-form video | [Grammarly tutorial](https://www.youtube.com/watch?v=BUst9tSsTQE), run `772c3e79-d4ba-4ac8-b57a-1ae3f61c6928`: 5m14s, 23 observations, 12 judgments; Jev $0.000306 | Library tutorial, not official brand advertising |
| Original public X source | [Original demo post](https://x.com/TheMattBerman/status/2100654891756589230): Firecrawl 500, yt-dlp recovered native 48.266s video | Acquisition fallback only; upload above provides analysis proof |
| Integrated Tongyi retrieval | Existing uploaded demo poster indexed through local API, 1,152 dimensions; text query returned the original source ID and linked evidence | Poster only, explicitly labeled; no full-video semantic claim |
| Gemini embedding adapter | Fixture text/image/video contracts and failed-revision retention pass | Earlier authenticated call returned HTTP 402; no repeated charge attempt or fallback |

## Additional operator-scoped live verification

One real ad plus one short-form video was the approved scope. Exa discovered [Future You Thanks You — Write Your Future With Grammarly](https://www.youtube.com/watch?v=scZVLCB1aX0). Run `556332c3-39d3-4722-81e0-7cc8cbdd43ca` completed automated acquisition → Qwen → caption extraction → Jev: 98.89s native video, six size-derived segments, 43 timed visual observations, 45 English publisher-caption cues and twelve judgments. Acquisition used the public yt-dlp fallback. End-to-end elapsed 779.327s; acquisition 109.593s, vision 661.307s, Jev 3.765s. Reported Exa cost $0.007 and Jev $0.000647; other dollar costs unavailable.

The first short-form query returned a NeetCode channel index, not an individual clip. It remains a page-only capture, never counted as full short-form video proof. A narrowed live Exa query (`site:youtube.com/shorts/ NeetCode coding interview advice`) found [How to Solve LeetCode Problems in Interviews](https://www.youtube.com/shorts/RJ_LfFS_94o). The actual Exa response/receipt was saved and reused for the acquisition run, avoiding a duplicate search request. Run `43743251-1c55-4b74-832a-4d6a8389a202` completed: 60.08s native video, five size-derived segments, 48 timed visual observations, 26 English automatic-caption cues and twelve Jev judgments. Automatic captions remain explicitly fallible. Elapsed 745.914s; acquisition 94.667s, vision 644.198s, captions 4.212s and Jev 2.806s. Qwen returned 66,200 total tokens across the segments under the confirmed coupon. Exa reported $0.007 and Jev $0.000656. The channel-index discovery was a separate $0.007 Exa request; it is not counted as a verified Short.


## Interpretation

Source availability is observed at capture time. Native media is distinct from thumbnails/page screenshots. Caption availability is reported per source; provider-generated or automatic captions are not independently verified speech. Protected/private-platform access is not claimed. No conversion, spend, creative durability in market or virality conclusion follows from these samples.

Reference evaluation uses explicit reviewed fields and rationales, reports disagreement without a numerical acceptance threshold, and does not present assistant-authored references as human owner approval.

## Reference comparison (assistant-authored, not owner-approved truth)

Compared stored Jev judgments against an independent reading of the tutorial's timestamped evidence. This is a small diagnostic reference set, not an accuracy estimate or release threshold.

| Field | Jev | Reference | Assessment |
|---|---|---|---|
| Opening hook | demonstration | flat-open | Disagreement: 0–29s is a static library page; cursor activity starts at 29s. Jev's label describes the later demonstration rather than the opening. |
| Format | tutorial | tutorial | Agreement: 48–71s navigates to account creation; 149–300s demonstrates review tools. |
| Homepage match | unknown | unknown | Agreement: no separately captured landing page. |

Observed: 2 agreements, 1 disagreement. Inspect opening evidence before trusting a hook label; retain original judgment and reviewer rationale. No prompt was tuned just to force these examples to agree.

Tutorial run measured 285.693s end-to-end: acquisition 10.671s, vision 272.343s, Jev 2.665s. Qwen returned 206,902 total tokens under the confirmed coupon; no dollar receipt. Jev reported $0.000306. Exa/Firecrawl/Qwen dollar costs are not inferred when absent. The UI's current report can repeat comparisons on operator-entered references and exports provenance/receipts alongside them.

## Completion checks

86 local tests passed, no skips, with FFmpeg enabled. Typecheck, lint, browser/API/workflow tests, reduced motion, desktop/mobile layouts and axe checks passed. Standards review: no findings. Spec review: segment-lineage defect fixed and regression-tested; final pass. Production dry-run excluded the research UI/API/models; only the existing public app is deployable. The separate local tool remains operator-triggered.
