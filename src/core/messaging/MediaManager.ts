import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('media-manager');

export const MEDIA_CATEGORIES = ['images', 'stickers', 'audio', 'video', 'avatars'] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export class MediaManager {
  private pools = new Map<string, string[]>();
  private usageIndex = new Map<string, number>();
  private mediaDir = '';

  async loadPools(mediaDir: string): Promise<void> {
    this.mediaDir = mediaDir;
    const categories = MEDIA_CATEGORIES;

    for (const category of categories) {
      const dir = join(mediaDir, category);
      try {
        const files = await readdir(dir);
        const mediaFiles = files.filter(f => !f.startsWith('.'));
        if (mediaFiles.length > 0) {
          this.pools.set(category, this.shuffle(mediaFiles.map(f => join(dir, f))));
          this.usageIndex.set(category, 0);
          logger.info({ category, count: mediaFiles.length }, 'Media pool loaded');
        }
      } catch {
        logger.debug({ category }, 'Media directory not found or empty');
      }
    }
  }

  pickRandom(category: string): string | null {
    const pool = this.pools.get(category);
    if (!pool || pool.length === 0) return null;

    let idx = this.usageIndex.get(category) ?? 0;
    const file = pool[idx % pool.length];

    idx++;
    if (idx >= pool.length) {
      this.pools.set(category, this.shuffle([...pool]));
      idx = 0;
    }
    this.usageIndex.set(category, idx);

    return file;
  }

  getPoolSize(category: string): number {
    return this.pools.get(category)?.length ?? 0;
  }

  /** Counts for every known category (0 when the folder is missing/empty). */
  getPoolSizes(): Record<MediaCategory, number> {
    return MEDIA_CATEGORIES.reduce((acc, c) => {
      acc[c] = this.getPoolSize(c);
      return acc;
    }, {} as Record<MediaCategory, number>);
  }

  /** Re-scan the media directory (call after uploading/removing files). */
  async reloadPools(): Promise<void> {
    if (!this.mediaDir) return;
    this.pools.clear();
    this.usageIndex.clear();
    await this.loadPools(this.mediaDir);
  }

  private shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
