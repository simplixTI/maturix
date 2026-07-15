import { getDb } from '../../database/client.js';
import { getWarmupProfile } from '../../config/warmup-profiles.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('daily-limit-guard');

/**
 * Resolve the authoritative daily message limit for an account, derived from its
 * current warmup day and its per-account warmup duration override (if any).
 *
 * Returns 0 if the account does not exist.
 */
export async function getDailyLimitForAccount(accountId: string): Promise<number> {
  const db = getDb();
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { warmupDay: true, warmupTotalDays: true },
  });
  if (!account) return 0;
  const profile = getWarmupProfile(account.warmupDay || 1, account.warmupTotalDays ?? undefined, accountId);
  return profile.dailyLimit;
}

/**
 * Atomically reserve one daily message slot.
 *
 * Uses a conditional `updateMany` (`msgsSentToday < limit`) so that concurrent
 * workers can never push the counter past the daily cap — the database enforces
 * the limit, not application-level reads which are subject to caching/races.
 *
 * @returns true if a slot was reserved (caller may send); false if the daily
 *          cap is already reached (caller must NOT send).
 */
export async function tryReserveDailySlot(accountId: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const db = getDb();
  const result = await db.account.updateMany({
    where: { id: accountId, msgsSentToday: { lt: limit } },
    data: { msgsSentToday: { increment: 1 }, lastActiveAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Convenience wrapper: resolve the limit and reserve in one call.
 * @returns true if reserved, false if at/over the cap.
 */
export async function reserveDailySlot(accountId: string): Promise<boolean> {
  const limit = await getDailyLimitForAccount(accountId);
  const reserved = await tryReserveDailySlot(accountId, limit);
  if (!reserved) {
    logger.debug({ accountId, limit }, 'Daily message limit reached — send blocked');
  }
  return reserved;
}

/**
 * Release a previously-reserved slot (e.g. when the actual send fails after a
 * successful reservation), so a transient error does not permanently consume
 * the day's quota.
 */
export async function releaseDailySlot(accountId: string): Promise<void> {
  const db = getDb();
  await db.account.updateMany({
    where: { id: accountId, msgsSentToday: { gt: 0 } },
    data: { msgsSentToday: { decrement: 1 } },
  });
}
