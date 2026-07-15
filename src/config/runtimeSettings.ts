import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('runtime-settings');
const FILE = join(process.cwd(), 'data', 'runtime-settings.json');

/**
 * Operator-tunable settings that can be changed at runtime from the dashboard
 * (persisted to disk; applied live without a restart).
 */
export interface MessagingTiming {
  /** Min/max random delay before sending each warmup text message (ms). */
  sendDelayMinMs: number;
  sendDelayMaxMs: number;
  /** Min/max random delay before sending a reaction (ms). */
  reactionDelayMinMs: number;
  reactionDelayMaxMs: number;
}

const DEFAULTS: MessagingTiming = {
  // More human, less bursty: a real person reads + types for a while before
  // replying. Min raised from 7s so consecutive messages don't fire back-to-back.
  sendDelayMinMs: 15_000, // 15s
  sendDelayMaxMs: 240_000, // 4 min
  reactionDelayMinMs: 10_000, // 10s
  reactionDelayMaxMs: 120_000, // 2 min
};

// Hard bounds to keep things sane: 1s .. 30min.
const LO = 1_000;
const HI = 1_800_000;

let cache: MessagingTiming = { ...DEFAULTS };

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function sanitize(t: MessagingTiming): MessagingTiming {
  let sMin = clamp(t.sendDelayMinMs, LO, HI);
  let sMax = clamp(t.sendDelayMaxMs, LO, HI);
  if (sMax < sMin) [sMin, sMax] = [sMax, sMin];
  let rMin = clamp(t.reactionDelayMinMs, LO, HI);
  let rMax = clamp(t.reactionDelayMaxMs, LO, HI);
  if (rMax < rMin) [rMin, rMax] = [rMax, rMin];
  return { sendDelayMinMs: sMin, sendDelayMaxMs: sMax, reactionDelayMinMs: rMin, reactionDelayMaxMs: rMax };
}

/** Load persisted settings from disk into the in-memory cache (call on boot). */
export async function loadRuntimeSettings(): Promise<void> {
  try {
    const raw = await readFile(FILE, 'utf8');
    cache = sanitize({ ...DEFAULTS, ...JSON.parse(raw) });
    logger.info(cache, 'Runtime settings loaded');
  } catch {
    cache = { ...DEFAULTS };
  }
}

/** Current messaging timing — read live at each send, so changes apply instantly. */
export function getMessagingTiming(): MessagingTiming {
  return cache;
}

/** Update + persist messaging timing. Returns the sanitized, effective values. */
export async function setMessagingTiming(partial: Partial<MessagingTiming>): Promise<MessagingTiming> {
  cache = sanitize({ ...cache, ...partial });
  try {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(cache, null, 2), 'utf8');
    logger.info(cache, 'Runtime settings updated');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to persist runtime settings');
  }
  return cache;
}
