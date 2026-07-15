import { CIRCADIAN_CURVE } from '../config/constants.js';
import { circadianOffset, activeWindow } from './accountIdentity.js';

export function getCircadianMultiplier(hour?: number): number {
  const h = hour ?? new Date().getHours();
  return CIRCADIAN_CURVE[h] ?? 0.05;
}

/**
 * Whether a chip should act right now. When an accountId is given, the decision
 * is personalized: the chip is silent outside its own waking window, and its
 * activity peak is shifted by a per-account hour offset — so the fleet does not
 * act in lockstep.
 */
export function shouldActNow(hour?: number, accountId?: string): boolean {
  const h = hour ?? new Date().getHours();
  if (accountId) {
    const { start, end } = activeWindow(accountId);
    if (h < start || h >= end) return false; // this chip is "asleep"
    const shifted = ((h - circadianOffset(accountId)) % 24 + 24) % 24;
    return Math.random() < getCircadianMultiplier(shifted);
  }
  return Math.random() < getCircadianMultiplier(h);
}

export function getActiveHoursToday(): number {
  return CIRCADIAN_CURVE.filter(v => v >= 0.30).length;
}

/**
 * Hard waking-window gate (no probability): true only while this chip is inside
 * its personalized active window. Used to STOP conversation scheduling/sending
 * entirely during the chip's sleep hours — a human doesn't text at 3am, and
 * neither should a warming chip. The probabilistic throttle (shouldActNow) only
 * shapes activity WITHIN the window; this hard-gates the window itself.
 */
export function isAwake(accountId: string, hour?: number): boolean {
  const h = hour ?? new Date().getHours();
  const { start, end } = activeWindow(accountId);
  return h >= start && h < end;
}
