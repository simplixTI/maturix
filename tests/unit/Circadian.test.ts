import { describe, it, expect } from 'vitest';
import { getCircadianMultiplier, getActiveHoursToday } from '../../src/utils/circadian.js';

describe('Circadian', () => {
  it('returns low multiplier at 3 AM', () => {
    const mult = getCircadianMultiplier(3);
    expect(mult).toBeLessThan(0.05);
  });

  it('returns high multiplier at 10 AM', () => {
    const mult = getCircadianMultiplier(10);
    expect(mult).toBeGreaterThan(0.9);
  });

  it('returns peak at noon', () => {
    const mult = getCircadianMultiplier(11);
    expect(mult).toBe(1.0);
  });

  it('evening is moderate', () => {
    const mult = getCircadianMultiplier(20);
    expect(mult).toBeGreaterThan(0.3);
    expect(mult).toBeLessThan(0.8);
  });

  it('active hours are reasonable (8-16 hours)', () => {
    const hours = getActiveHoursToday();
    expect(hours).toBeGreaterThan(8);
    expect(hours).toBeLessThan(18);
  });

  it('all 24 hours have a defined multiplier', () => {
    for (let h = 0; h < 24; h++) {
      const mult = getCircadianMultiplier(h);
      expect(mult).toBeGreaterThanOrEqual(0);
      expect(mult).toBeLessThanOrEqual(1);
    }
  });
});
