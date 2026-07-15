import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('media-processor');

export interface ProcessedMedia {
  buffer: Buffer;
  mimetype?: string;
}

/**
 * Re-encodes media so every send produces a unique byte stream (and therefore a
 * unique hash). WhatsApp deduplicates by content hash, so sending the SAME file
 * repeatedly across chips is a detectable pattern. A tiny, imperceptible jitter
 * (brightness for images, bitrate/CRF + metadata for audio/video) defeats that.
 *
 * Best-effort: if sharp / ffmpeg are unavailable or fail, returns null and the
 * caller falls back to sending the original file by URL.
 */
export class MediaProcessor {
  private ffmpegPath: string | null = null;
  private ffmpegResolved = false;

  private async getFfmpeg(): Promise<string | null> {
    if (this.ffmpegResolved) return this.ffmpegPath;
    this.ffmpegResolved = true;
    try {
      const mod = await import('ffmpeg-static');
      this.ffmpegPath = (mod.default as unknown as string) || null;
    } catch {
      this.ffmpegPath = null;
      logger.warn('ffmpeg-static not available — audio/video will be sent as-is');
    }
    return this.ffmpegPath;
  }

  /**
   * Process a media file for sending. Returns a re-encoded buffer, or null to
   * signal "send the original file unchanged".
   */
  async processForSend(
    path: string,
    type: 'image' | 'audio' | 'video' | 'sticker',
  ): Promise<ProcessedMedia | null> {
    try {
      if (type === 'image') return await this.processImage(path);
      if (type === 'audio') return await this.processAudio(path);
      if (type === 'video') return await this.processVideo(path);
      return null; // stickers are sent unchanged (must stay valid 512x512 webp)
    } catch (err: any) {
      logger.debug({ err: err?.message, path, type }, 'Re-encode failed; sending original');
      return null;
    }
  }

  private async processImage(path: string): Promise<ProcessedMedia | null> {
    let sharp: typeof import('sharp');
    try {
      sharp = (await import('sharp')).default as unknown as typeof import('sharp');
    } catch {
      return null; // sharp unavailable
    }
    // Imperceptible brightness jitter + quality jitter + metadata strip → new hash.
    const brightness = 0.985 + Math.random() * 0.03; // 0.985 .. 1.015
    const quality = 80 + Math.floor(Math.random() * 13); // 80 .. 92
    const buffer = await (sharp as any)(path)
      .rotate() // honor EXIF orientation, then drop metadata
      .modulate({ brightness })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { buffer, mimetype: 'image/jpeg' };
  }

  private async processAudio(path: string): Promise<ProcessedMedia | null> {
    const ffmpeg = await this.getFfmpeg();
    if (!ffmpeg) return null;
    const bitrate = 24 + Math.floor(Math.random() * 9); // 24 .. 32 kbps
    const out = join(tmpdir(), `wa-aud-${randomUUID()}.ogg`);
    await this.runFfmpeg(ffmpeg, [
      '-y', '-i', path,
      '-ac', '1',
      '-c:a', 'libopus',
      '-b:a', `${bitrate}k`,
      '-metadata', `comment=${randomUUID()}`,
      out,
    ]);
    return await this.takeBuffer(out, 'audio/ogg; codecs=opus');
  }

  private async processVideo(path: string): Promise<ProcessedMedia | null> {
    const ffmpeg = await this.getFfmpeg();
    if (!ffmpeg) return null;
    const crf = 24 + Math.floor(Math.random() * 4); // 24 .. 27
    const out = join(tmpdir(), `wa-vid-${randomUUID()}.mp4`);
    await this.runFfmpeg(ffmpeg, [
      '-y', '-i', path,
      '-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      '-metadata', `comment=${randomUUID()}`,
      '-movflags', '+faststart',
      out,
    ]);
    return await this.takeBuffer(out, 'video/mp4');
  }

  private async takeBuffer(path: string, mimetype: string): Promise<ProcessedMedia> {
    try {
      const buffer = await readFile(path);
      return { buffer, mimetype };
    } finally {
      unlink(path).catch(() => {});
    }
  }

  private runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'ignore'] });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });
  }
}

/** Singleton — the processor is stateless beyond a resolved ffmpeg path. */
export const mediaProcessor = new MediaProcessor();
