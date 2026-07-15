import { isMessageTypeAllowed } from '../core/warmup/WarmupPhase.js';

/**
 * Per-day media policy. Defines, for each media type, from which warmup day it
 * unlocks, the daily quota (how many of that type per account/day), and the
 * per-opportunity probability of sending one. Video unlocks latest and stays
 * rarest because it is the heaviest / most scrutinized media type.
 *
 * This mixes the media types across the warmup days:
 *   - photos + stickers from day 4 (Expansion)
 *   - voice notes (audio/PTT) from day 6 (Scaling)
 *   - video from day 8 (Mature), sparse
 *
 * Quotas are an upper bound per day; probability controls the natural cadence.
 * Every media send still passes through the daily hard cap, the hourly limit,
 * and the phase's allowedMessageTypes gate.
 */
export type MediaType = 'image' | 'sticker' | 'audio' | 'video';

export interface MediaTypePolicy {
  type: MediaType;
  fromDay: number;
  /** Max sends of this type per account per day, as a function of the day. */
  perDay: (day: number) => number;
  /** Probability [0..1] of sending one at each opportunity (a conversation step / tick). */
  chance: number;
  /** Optional: only allow on every Nth day from fromDay (e.g. video every 2 days). */
  everyNDays?: number;
}

export const MEDIA_SCHEDULE: MediaTypePolicy[] = [
  { type: 'image', fromDay: 4, perDay: (d) => (d < 8 ? 1 : 2), chance: 0.18 },
  { type: 'sticker', fromDay: 4, perDay: () => 1, chance: 0.12 },
  { type: 'audio', fromDay: 6, perDay: (d) => (d < 10 ? 1 : 2), chance: 0.14 },
  { type: 'video', fromDay: 8, perDay: () => 1, chance: 0.07, everyNDays: 2 },
];

export function getMediaPolicy(type: MediaType): MediaTypePolicy | undefined {
  return MEDIA_SCHEDULE.find((p) => p.type === type);
}

/**
 * Whether a media type is permitted on a given warmup day, considering BOTH the
 * media schedule (fromDay / everyNDays) and the phase's allowedMessageTypes.
 */
export function isMediaTypeAllowedOnDay(type: MediaType, day: number): boolean {
  const policy = getMediaPolicy(type);
  if (!policy) return false;
  if (day < policy.fromDay) return false;
  if (policy.everyNDays && (day - policy.fromDay) % policy.everyNDays !== 0) return false;
  // The warmup phase is the ultimate authority on which types are unlocked.
  return isMessageTypeAllowed(day, type);
}

/** The media types unlocked on a given day, in schedule order. */
export function mediaTypesForDay(day: number): MediaType[] {
  return MEDIA_SCHEDULE.filter((p) => isMediaTypeAllowedOnDay(p.type, day)).map((p) => p.type);
}

/** Map a media type to the MediaManager pool category. */
export function poolCategoryFor(type: MediaType): string {
  return type === 'image' ? 'images' : type;
}
