# Private research archive

Source records, acquired page text, caption/vision evidence, Jev judgments, corrections, context and embedding vectors are saved to Cloudflare D1. Original local video, playback copies, segments and posters go to private R2; D1 records their content hashes and object keys. The public Coursay Worker has no binding to either resource.

Configure `.env.marketing.local` using `config.example.env`. Use an API token with D1/R2 access, or `MARKETING_CLOUDFLARE_WRANGLER_AUTH=true` to reuse authenticated Wrangler. Tokens remain in process memory. Do not share the environment file.

```powershell
npm run marketing -- cloud-sync
npm run marketing -- cloud-restore C:\path\to\empty-recovery-directory
```

Sync includes all canonical files beneath `.local/marketing/research` plus older `.local/marketing/embeddings` revisions. It excludes dotfiles, in-progress `.pending` writes, diagnostic scripts/screenshots outside the corpus and environment files. It preserves failed/partial sources as well as completed ones. Remote-only media URLs remain links, not a claim that the original bytes were downloaded; expired URLs do not erase saved evidence.

Each changed file is uploaded, read back and SHA-256 checked. Re-running skips matching checksums. Restore verifies every downloaded payload and requires an empty destination, protecting existing local records. Legacy vectors restore into `legacy-embeddings/`; review before moving them into the active collection. Cloud sync never deletes local or remote files.

The local corpus remains usable during an outage. Automatic saves record `saved` or `pending` in `research/.cloud-sync.json`; retry with `cloud-sync`. Failed remote writes never count as success. No research UI/API, public R2 domain or automatic publishing is deployed.

Cloudflare API/database size and quota failures remain explicit; there is no paid fallback, automatic upgrade, data truncation or silent omission. Restore provides independent end-to-end proof beyond upload receipts.

## Backfill receipt — 2026-09-30 UTC

- D1 `coursay-marketing-research`: `ef8041c8-3ac1-4ea8-9065-6b5d39fa059a`.
- R2 `coursay-marketing-research`: managed public access disabled; no custom domains.
- 45 files / 297,836,081 bytes verified after upload: 10 runs, context, one embedding revision, 33 media files.
- Runs retain 112 discovered/imported source entries, including 41 with visual evidence and 33 completed classifications. Partial/failed entries remain saved.
- Immediate repeat uploaded zero files. Separate D1 inventory agreed with the local manifest. This proves the saved corpus, not completeness of remote media behind expiring URLs.
