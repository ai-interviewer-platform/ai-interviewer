import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function parseCaptions(text, format) {
  let cues;
  if (format === 'json3') {
    const data = JSON.parse(text);
    cues = (data.events ?? []).filter(item => item.segs?.length && Number.isFinite(item.dDurationMs)).map(item => ({
      startSeconds: item.tStartMs / 1000, endSeconds: (item.tStartMs + item.dDurationMs) / 1000,
      text: item.segs.map(segment => segment.utf8 ?? '').join('').trim(),
    }));
  } else {
    const seconds = value => value.replace(',', '.').split(':').reduce((total, part) => total * 60 + Number(part), 0);
    cues = [...text.replaceAll('\r', '').matchAll(/(?:(\d+:)?\d{2}:\d{2}[.,]\d{3}) --> [^\n]+\n[\s\S]*?(?=\n\n|$)/g)].map(([block]) => {
      const [timing, ...lines] = block.split('\n');
      const [start, end] = timing.split(' --> ');
      return { startSeconds: seconds(start), endSeconds: seconds(end.split(' ')[0]), text: lines.join(' ').replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').trim() };
    });
  }
  cues = cues.filter(cue => cue.text);
  if (!cues.length || cues.some(cue => !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < 0 || cue.endSeconds < cue.startSeconds)) throw new Error('No valid timed captions');
  return cues;
}

// Public extractor metadata only. Never pass cookies, plugins or local configuration.
export async function captions({ source, env, fetch, signal, exec = promisify(execFile) }) {
  const unavailable = reason => ({ status: 'unavailable', reason, capturedAt: new Date().toISOString() });
  if (!source.url || !/(^|\.)(youtube\.com|youtu\.be|x\.com|twitter\.com|vimeo\.com|tiktok\.com|instagram\.com|facebook\.com)$/.test(new URL(source.url).hostname)) return unavailable('No public caption connector for this source; attach timed captions if available');
  if (!env.YTDLP_PYTHON) return unavailable('Public caption extractor not configured');
  try {
    const result = await exec(env.YTDLP_PYTHON, ['-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--skip-download', '--dump-single-json', '--js-runtimes', `node:${process.execPath}`, '--use-extractors', 'youtube,twitter,vimeo,tiktok,instagram,facebook', source.url], { signal, windowsHide: true, env: { ...process.env, ...(env.YTDLP_PYTHONPATH ? { PYTHONPATH: env.YTDLP_PYTHONPATH } : {}) } });
    const media = JSON.parse(result.stdout);
    source.observedMetrics = { views: media.view_count ?? null, likes: media.like_count ?? null, comments: media.comment_count ?? null, capturedAt: new Date().toISOString(), interpretation: 'Public counters, not paid reach or conversions' };
    source.provenance.originalUrl = media.webpage_url ?? source.url;
    source.provenance.access = 'Public extraction without authentication or cookies';
    let track, language, kind;
    for (const [tracks, label] of [[media.subtitles, 'publisher-captions'], [media.automatic_captions, 'automatic-captions']]) {
      const languages = [...new Set([media.language, 'en', ...Object.keys(tracks ?? {})].filter(Boolean))];
      for (const lang of languages) {
        const selected = tracks?.[lang]?.find(item => item.ext === 'json3') ?? tracks?.[lang]?.find(item => item.ext === 'vtt');
        if (selected) { track = selected; language = lang; kind = label; break; }
      }
      if (track) break;
    }
    if (!track) return unavailable('No accessible caption track');
    const url = new URL(track.url);
    if (url.protocol !== 'https:' || url.username || url.password) return unavailable('Caption track requires unsupported access');
    const response = await fetch(url.href, { signal, redirect: 'error' });
    if (!response.ok) return unavailable(`Caption HTTP ${response.status}`);
    return { status: 'available', kind, language, format: track.ext, cues: parseCaptions(await response.text(), track.ext), sourceUrl: source.url, capturedAt: new Date().toISOString(), limitation: 'Caption text may differ from speech; automatic captions can contain errors' };
  } catch {
    if (signal?.aborted) throw new Error('Cancelled');
    return unavailable('Caption extraction failed; visual evidence remains usable');
  }
}
