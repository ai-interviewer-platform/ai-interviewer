import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const mediaPath = (directory, id, extension) => {
  if (!/^[a-f0-9-]+$/.test(id) || !['upload', 'mp4', 'jpg'].includes(extension)) throw new Error('Invalid media ID');
  return join(directory, 'media', `${id}.${extension}`);
};

function ffmpeg(env, args, signal, inspect = false) {
  if (!env.FFMPEG_PATH) throw new Error('Set FFMPEG_PATH for local video uploads');
  return new Promise((resolve, reject) => {
    const child = spawn(env.FFMPEG_PATH, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, signal });
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.resume();
    child.on('error', () => reject(new Error(signal?.aborted ? 'Cancelled' : 'FFmpeg could not start')));
    child.on('close', code => code === 0 || inspect && !signal?.aborted ? resolve(output) : reject(new Error(signal?.aborted ? 'Cancelled' : 'Video decoding failed')));
  });
}

export async function prepareVideo({ directory, id, env, signal }) {
  await mkdir(join(directory, 'media'), { recursive: true });
  const original = mediaPath(directory, id, 'upload');
  // No network protocols when decoding untrusted local uploads.
  const input = ['-protocol_whitelist', 'file,pipe', '-i', original];
  const metadata = await ffmpeg(env, input, signal, true);
  const duration = metadata.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!duration || !metadata.includes('Video:')) throw new Error('Readable video with finite duration required');
  const durationSeconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  // Alibaba video contract: duration >= 2 seconds; encoded video < 10 MB.
  if (durationSeconds < 2) throw new Error('Qwen requires video of at least 2 seconds');
  await ffmpeg(env, ['-y', ...input, '-c:a', 'aac', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath(directory, id, 'mp4')], signal);
  await ffmpeg(env, ['-y', ...input, '-frames:v', '1', mediaPath(directory, id, 'jpg')], signal);
  const chunks = [];
  async function split(chunkId, startSeconds, length) {
    const file = mediaPath(directory, chunkId, 'mp4');
    const encodedBytes = 4 * Math.ceil((await stat(file)).size / 3);
    if (encodedBytes < 10_000_000 && length <= 7200) { chunks.push({ id: chunkId, startSeconds, endSeconds: startSeconds + length }); return; }
    const half = length / 2;
    if (half < 2) throw new Error('Video exceeds Qwen payload limit even at minimum segment duration');
    // Bisect only when measured bytes or the documented two-hour limit requires it.
    for (const offset of [startSeconds, startSeconds + half]) {
      const next = randomUUID();
      await ffmpeg(env, ['-y', '-ss', String(offset), ...input, '-t', String(half), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mediaPath(directory, next, 'mp4')], signal);
      await split(next, offset, half);
    }
  }
  await split(id, 0, durationSeconds);
  return { localVideo: id, chunks, durationSeconds, playback: `/api/media/${id}.mp4`, screenshot: `/api/media/${id}.jpg`, markdown: '', capturedAt: new Date().toISOString(), audio: metadata.includes('Audio:') ? 'present-untranscribed' : 'no-audio-track' };
}

export async function videoData(directory, id) {
  return `data:video/mp4;base64,${(await readFile(mediaPath(directory, id, 'mp4'))).toString('base64')}`;
}
