import { describe, it, expect } from 'vitest';
import {
  accountUnit, circadianOffset, dailyLimitJitter, activeWindow, jitterDailyLimit,
} from '../../src/utils/accountIdentity.js';

describe('AccountIdentity — deterministic per-account personality', () => {
  it('accountUnit is stable and in [0,1)', () => {
    const u = accountUnit('acc-1', 'salt');
    expect(u).toBe(accountUnit('acc-1', 'salt'));
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });

  it('different salts give different values', () => {
    expect(accountUnit('acc-1', 'a')).not.toBe(accountUnit('acc-1', 'b'));
  });

  it('circadianOffset is an integer in [-2, +2]', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const o = circadianOffset(`acc-${id}`);
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(-2);
      expect(o).toBeLessThanOrEqual(2);
    }
  });

  it('dailyLimitJitter is within [0.88, 1.12]', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      const j = dailyLimitJitter(`acc-${id}`);
      expect(j).toBeGreaterThanOrEqual(0.88);
      expect(j).toBeLessThanOrEqual(1.12);
    }
  });

  it('activeWindow: wake 6–9h, sleep 21–24h, and wake < sleep', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const { start, end } = activeWindow(`acc-${id}`);
      expect(start).toBeGreaterThanOrEqual(6);
      expect(start).toBeLessThanOrEqual(9);
      expect(end).toBeGreaterThanOrEqual(21);
      expect(end).toBeLessThanOrEqual(24);
      expect(start).toBeLessThan(end);
    }
  });

  it('jitterDailyLimit is always >= 1', () => {
    expect(jitterDailyLimit('acc-1', 1)).toBeGreaterThanOrEqual(1);
    expect(jitterDailyLimit('acc-1', 100)).toBeGreaterThanOrEqual(1);
  });

  it('the fleet is not in lockstep (windows differ across accounts)', () => {
    const starts = Array.from({ length: 12 }, (_, i) => activeWindow(`chip-${i}`).start);
    expect(new Set(starts).size).toBeGreaterThan(1);
  });
});
