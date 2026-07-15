import { createHash } from 'node:crypto';

/**
 * Deterministic per-account "personality", derived purely from the accountId so
 * each chip behaves like a distinct person WITHOUT storing extra state. This
 * desynchronizes the fleet: chips wake/sleep at slightly different hours, peak at
 * different times, and have slightly different daily ceilings — so a cluster of
 * numbers never moves in lockstep (a detectable pattern).
 */

/** Stable float in [0,1) for a given (accountId, salt). */
export function accountUnit(accountId: string, salt = ''): number {
  const h = createHash('sha256').update(`${accountId}:${salt}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

/** Circadian phase shift in whole hours, range [-2, +2]. */
export function circadianOffset(accountId: string): number {
  return Math.round(accountUnit(accountId, 'circadian') * 4) - 2;
}

/**
 * Daily message-limit multiplier, range ~[0.80, 1.35] — stable per account.
 * Wider+lower than before so a day-1 base of 8 spreads the fleet across ~6–11
 * messages (no two chips share a ceiling, and none overshoots the safe day-1 cap).
 */
export function dailyLimitJitter(accountId: string): number {
  return 0.80 + accountUnit(accountId, 'limit') * 0.55;
}

/**
 * The chip's waking window. Start 6–9h, end 21–24h. Outside this window the chip
 * is "asleep" and takes no warmup actions.
 */
export function activeWindow(accountId: string): { start: number; end: number } {
  const start = 6 + Math.round(accountUnit(accountId, 'wake') * 3); // 6..9
  const end = 21 + Math.round(accountUnit(accountId, 'sleep') * 3); // 21..24
  return { start, end };
}

/** Apply the per-account daily jitter to a base limit (>=1). */
export function jitterDailyLimit(accountId: string, baseLimit: number): number {
  return Math.max(1, Math.round(baseLimit * dailyLimitJitter(accountId)));
}
