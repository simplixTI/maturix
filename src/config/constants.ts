import { getConfig } from './index.js';

function cfg() {
  try { return getConfig(); } catch { return null; }
}

export function getWarmupSchedule() {
  const c = cfg();
  // Conservative ramp: day 1 ~8 (6–11 per chip after jitter), gentle geometric
  // climb to 250/day over 30 days. Tuned down from 15/400/15d which was still
  // tripping bans on fresh chips.
  const totalDays = c?.WARMUP_TOTAL_DAYS ?? 30;
  return {
    DAY1_LIMIT: c?.WARMUP_DAY1_LIMIT ?? 8,
    GROWTH_FACTOR: c?.WARMUP_GROWTH_FACTOR ?? 1.35,
    MAX_DAILY: c?.WARMUP_MAX_DAILY ?? 250,
    TOTAL_DAYS: totalDays,
    // MAX_DAYS kept for backward compatibility (last 0-indexed ramp day).
    MAX_DAYS: totalDays - 1,
    INACTIVITY_RESET_HOURS: c?.WARMUP_INACTIVITY_RESET_HOURS ?? 72,
  };
}

export function getSafeZones() {
  const c = cfg();
  return {
    MSGS_PER_HOUR: c?.SAFE_MSGS_PER_HOUR ?? 30,
    REPLY_RATE_MIN: c?.SAFE_REPLY_RATE_MIN ?? 0.30,
    BLOCK_RATE_MAX: c?.SAFE_BLOCK_RATE_MAX ?? 0.02,
    NEW_CONTACTS_PER_DAY: c?.SAFE_NEW_CONTACTS_PER_DAY ?? 20,
    IDENTICAL_MSGS_PER_HOUR: c?.SAFE_IDENTICAL_MSGS_PER_HOUR ?? 5,
  };
}

// Static defaults for use before config is loaded (tests, imports)
export const WARMUP_SCHEDULE = {
  DAY1_LIMIT: 8,
  GROWTH_FACTOR: 1.35,
  MAX_DAILY: 250,
  TOTAL_DAYS: 30,
  MAX_DAYS: 29,
  INACTIVITY_RESET_HOURS: 72,
} as const;

export const SAFE_ZONES = {
  MSGS_PER_HOUR: 30,
  REPLY_RATE_MIN: 0.30,
  BLOCK_RATE_MAX: 0.02,
  NEW_CONTACTS_PER_DAY: 20,
  IDENTICAL_MSGS_PER_HOUR: 5,
} as const;

export const TIMING = {
  TYPING_MS_PER_CHAR: 40,
  TYPING_MIN_MS: 2000,
  TYPING_MAX_MS: 12000,
  READ_RECEIPT_MIN_MS: 5000,
  READ_RECEIPT_MAX_MS: 15000,
  REACTION_MIN_MS: 3000,
  REACTION_MAX_MS: 30000,
  REACTION_PROBABILITY: 0.30,
  MESSAGE_DELAY_MIN_MS: 15000,
  MESSAGE_DELAY_MAX_MS: 45000,
  ONLINE_WINDOW_MIN_MS: 900000,
  ONLINE_WINDOW_MAX_MS: 2700000,
  OFFLINE_WINDOW_MIN_MS: 1800000,
  OFFLINE_WINDOW_MAX_MS: 7200000,
} as const;

export const SESSION = {
  MAX_CONCURRENT_CONNECTIONS: 10,
  RECONNECT_BATCH_SIZE: 10,
  RECONNECT_BATCH_DELAY_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 50,
  RECONNECT_BASE_DELAY_MS: 1000,
  RECONNECT_MAX_DELAY_MS: 300000,
  RECONNECT_JITTER_FACTOR: 0.30,
} as const;

export const PROXY = {
  HEALTH_CHECK_INTERVAL_MS: 300000,
  // Residential proxies do a real TLS handshake to WhatsApp through a slow
  // home-IP hop — 10s was too tight and produced false "unstable" flags.
  HEALTH_CHECK_TIMEOUT_MS: 20000,
  MAX_FAIL_COUNT: 3,
  // 1 = each sticky session (residential IP) is dedicated to a single number.
  // Two numbers sharing one session = same IP = a cluster signal. Keep at 1.
  MAX_ACCOUNTS_PER_PROXY: 1,
} as const;

export const CIRCADIAN_CURVE: readonly number[] = [
  0.02, 0.01, 0.01, 0.02, 0.05, 0.10,
  0.30, 0.60, 0.85, 0.95, 1.00, 1.00,
  0.90, 0.95, 1.00, 0.95, 0.85, 0.75,
  0.70, 0.60, 0.45, 0.30, 0.15, 0.05,
] as const;

export const REACTIONS_POOL = ['👍', '😊', '😂', '❤️', '🙏', '🔥', '👏', '😍'] as const;

export const REACTIONS_WEIGHTS = [0.25, 0.15, 0.15, 0.12, 0.12, 0.08, 0.08, 0.05] as const;
