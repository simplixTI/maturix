import { MEDIA_SCHEDULE, isMediaTypeAllowedOnDay, poolCategoryFor, type MediaType } from '../../config/media-schedule.js';
import { randomDelay } from '../../utils/gaussian.js';
import { createChildLogger } from '../../utils/logger.js';
import type { MediaManager } from './MediaManager.js';

const logger = createChildLogger('media-injector');

interface DailyMediaCounts {
  date: string; // YYYY-MM-DD
  counts: Record<MediaType, number>;
}

export interface MediaSendJob {
  type: MediaType;
  mediaPath: string;
  delayMs: number;
}

/**
 * Decides when to mix a media message (photo / sticker / voice / video) into the
 * warmup, honoring the per-day schedule, per-account daily quotas, and pool
 * availability. Quotas are tracked in memory per account/day (same lightweight
 * pattern as the status tracker); they reset at midnight and on restart.
 *
 * It NEVER sends directly — it returns a job for the caller to enqueue through
 * the normal message pipeline, so the daily hard cap, hourly limit, typing
 * simulation, re-encode and logging all still apply.
 */
export class MediaInjector {
  private tracker: Record<string, DailyMediaCounts> = {};

  constructor(private readonly media: MediaManager) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private bucket(accountId: string): DailyMediaCounts {
    const today = this.today();
    const existing = this.tracker[accountId];
    if (!existing || existing.date !== today) {
      this.tracker[accountId] = { date: today, counts: { image: 0, sticker: 0, audio: 0, video: 0 } };
    }
    return this.tracker[accountId];
  }

  /** Remaining quota for a type today (>=0). */
  remaining(accountId: string, type: MediaType, day: number): number {
    const policy = MEDIA_SCHEDULE.find((p) => p.type === type);
    if (!policy) return 0;
    const used = this.bucket(accountId).counts[type];
    return Math.max(0, policy.perDay(day) - used);
  }

  /**
   * Decide whether to inject a media message right now. Returns a job to enqueue,
   * or null. `opportunity` slightly scales probability (e.g. lower during a busy
   * conversation step vs a standalone tick) — default 1.
   */
  decide(accountId: string, day: number, opportunity = 1): MediaSendJob | null {
    // Candidate types: unlocked today, under quota, with files in the pool.
    const candidates = MEDIA_SCHEDULE.filter((p) => {
      if (!isMediaTypeAllowedOnDay(p.type, day)) return false;
      if (this.remaining(accountId, p.type, day) <= 0) return false;
      return this.media.getPoolSize(poolCategoryFor(p.type)) > 0;
    });
    if (candidates.length === 0) return null;

    // Roll each candidate independently; pick the first that fires (schedule order
    // = priority: image > sticker > audio > video).
    for (const policy of candidates) {
      if (Math.random() < policy.chance * opportunity) {
        const mediaPath = this.media.pickRandom(poolCategoryFor(policy.type));
        if (!mediaPath) continue;
        this.bucket(accountId).counts[policy.type]++;
        logger.debug({ accountId, type: policy.type, day }, 'Media injection scheduled');
        return { type: policy.type, mediaPath, delayMs: randomDelay(8000, 40000) };
      }
    }
    return null;
  }

  /** True if any media type is unlocked on this day (cheap gate before deciding). */
  hasUnlockedTypes(day: number): boolean {
    return MEDIA_SCHEDULE.some((p) => isMediaTypeAllowedOnDay(p.type, day));
  }
}
