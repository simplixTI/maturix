import { getWarmupSchedule } from './constants.js';
import { jitterDailyLimit } from '../utils/accountIdentity.js';

export interface WarmupDayProfile {
  day: number;
  dailyLimit: number;
  msgsPerHourMax: number;
  newContactsMax: number;
}

/**
 * Compute the warmup profile for a given day.
 *
 * The daily limit ramps geometrically from DAY1_LIMIT up to MAX_DAILY across
 * `totalDays` days, then holds at MAX_DAILY ("graduated"). The growth factor is
 * derived from (DAY1_LIMIT, MAX_DAILY, totalDays) so that increasing the number
 * of warmup days produces a gentler, longer ramp instead of doing nothing.
 *
 * @param day        1-based warmup day (elapsed days since warmup started).
 * @param totalDays  Per-account override for the warmup duration. Falls back to
 *                   the global WARMUP_TOTAL_DAYS when omitted.
 * @param accountId  When given, applies a stable per-account jitter to the daily
 *                   limit (±~12%) so the fleet's ceilings are not identical.
 */
export function getWarmupProfile(day: number, totalDays?: number, accountId?: string): WarmupDayProfile {
  const schedule = getWarmupSchedule();
  const day1 = Math.max(1, schedule.DAY1_LIMIT);
  const target = Math.max(day1, schedule.MAX_DAILY);
  const td = Math.max(2, Math.floor(totalDays ?? schedule.TOTAL_DAYS));

  const clampedDay = Math.max(1, day);
  // Hold at the target volume once the ramp completes.
  const effectiveDay = Math.min(clampedDay, td);

  // Derived growth so the curve climbs from day1 to target over exactly `td` days.
  const growth = Math.max(1, Math.pow(target / day1, 1 / (td - 1)));
  const rawLimit = Math.floor(day1 * Math.pow(growth, effectiveDay - 1));
  let dailyLimit = Math.min(rawLimit, target);

  // Per-account jitter so two chips on the same day don't share an identical cap.
  if (accountId) dailyLimit = Math.min(jitterDailyLimit(accountId, dailyLimit), target);

  const msgsPerHourMax = Math.min(Math.ceil(dailyLimit / 16), 30);
  const newContactsMax = Math.min(Math.ceil(dailyLimit / 10), 20);

  return { day: clampedDay, dailyLimit, msgsPerHourMax, newContactsMax };
}

/**
 * All day-by-day profiles for the global warmup duration (days 1..TOTAL_DAYS).
 */
export function getAllProfiles(totalDays?: number): WarmupDayProfile[] {
  const td = totalDays ?? getWarmupSchedule().TOTAL_DAYS;
  return Array.from({ length: td }, (_, i) => getWarmupProfile(i + 1, td));
}
