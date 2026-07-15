import { describe, it, expect } from 'vitest';
import { gaussianRandom, gaussianClamp, randomDelay } from '../../src/utils/gaussian.js';

describe('Gaussian', () => {
  it('gaussianRandom returns values around mean', () => {
    const samples = Array.from({ length: 1000 }, () => gaussianRandom(100, 10));
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(avg).toBeGreaterThan(90);
    expect(avg).toBeLessThan(110);
  });

  it('gaussianClamp respects min/max', () => {
    for (let i = 0; i < 100; i++) {
      const value = gaussianClamp(50, 100, 10, 90);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(90);
    }
  });

  it('randomDelay stays within bounds', () => {
    for (let i = 0; i < 100; i++) {
      const delay = randomDelay(1000, 5000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(5000);
    }
  });

  it('randomDelay returns integers', () => {
    for (let i = 0; i < 50; i++) {
      const delay = randomDelay(100, 200);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});
