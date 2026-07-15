import { describe, it, expect } from 'vitest';
import { getWarmupProfile, getAllProfiles } from '../../src/config/warmup-profiles.js';

describe('WarmupProfiles — daily cap ramp', () => {
  it('day 1 starts at exactly 15 (base, no account jitter)', () => {
    expect(getWarmupProfile(1).dailyLimit).toBe(15);
  });

  it('ramps monotonically up and never exceeds MAX_DAILY (400)', () => {
    let prev = 0;
    for (let d = 1; d <= 15; d++) {
      const limit = getWarmupProfile(d).dailyLimit;
      expect(limit).toBeGreaterThanOrEqual(prev);
      expect(limit).toBeLessThanOrEqual(400);
      prev = limit;
    }
  });

  it('reaches the target (~400) by the last day of the default schedule', () => {
    expect(getWarmupProfile(15).dailyLimit).toBeGreaterThanOrEqual(395);
  });

  it('holds at the target after the ramp completes', () => {
    const d15 = getWarmupProfile(15).dailyLimit;
    const d30 = getWarmupProfile(30).dailyLimit;
    expect(d30).toBe(d15); // graduated → no further growth
  });

  it('a longer totalDays produces a gentler ramp (lower early-day limits)', () => {
    const d2default = getWarmupProfile(2, 15).dailyLimit;
    const d2slow = getWarmupProfile(2, 30).dailyLimit;
    expect(d2slow).toBeLessThan(d2default);
  });

  it('getAllProfiles returns one row per day of the schedule', () => {
    expect(getAllProfiles().length).toBe(15);
    expect(getAllProfiles(7).length).toBe(7);
  });
});

describe('WarmupProfiles — per-account jitter (desync)', () => {
  const ACC = 'acc-fixed-uuid-1';

  it('is deterministic for the same account', () => {
    expect(getWarmupProfile(5, 15, ACC).dailyLimit).toBe(getWarmupProfile(5, 15, ACC).dailyLimit);
  });

  it('stays within ~±12% of the base limit', () => {
    for (let d = 1; d <= 15; d++) {
      const base = getWarmupProfile(d).dailyLimit;
      const jit = getWarmupProfile(d, 15, ACC).dailyLimit;
      expect(jit).toBeGreaterThanOrEqual(Math.floor(base * 0.87));
      expect(jit).toBeLessThanOrEqual(Math.ceil(base * 1.13));
      expect(jit).toBeLessThanOrEqual(400); // never above target
    }
  });

  it('different accounts can land on different caps (fleet desync)', () => {
    const limits = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => getWarmupProfile(8, 15, `acc-${id}`).dailyLimit);
    expect(new Set(limits).size).toBeGreaterThan(1);
  });
});
