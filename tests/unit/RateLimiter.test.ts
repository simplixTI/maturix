import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../../src/core/antiban/RateLimiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it('allows first message', () => {
    expect(limiter.check('acc1', 'minute', 2, 60000)).toBe(true);
  });

  it('blocks after limit reached', () => {
    limiter.increment('acc1', 'minute', 60000);
    limiter.increment('acc1', 'minute', 60000);
    expect(limiter.check('acc1', 'minute', 2, 60000)).toBe(false);
  });

  it('counts correctly', () => {
    limiter.increment('acc1', 'hour', 3600000);
    limiter.increment('acc1', 'hour', 3600000);
    limiter.increment('acc1', 'hour', 3600000);
    expect(limiter.getCount('acc1', 'hour')).toBe(3);
  });

  it('returns remaining correctly', () => {
    limiter.increment('acc1', 'minute', 60000);
    expect(limiter.getRemaining('acc1', 'minute', 5)).toBe(4);
  });

  it('isolates accounts', () => {
    limiter.increment('acc1', 'minute', 60000);
    limiter.increment('acc1', 'minute', 60000);
    expect(limiter.getCount('acc1', 'minute')).toBe(2);
    expect(limiter.getCount('acc2', 'minute')).toBe(0);
  });

  it('isolates windows', () => {
    limiter.increment('acc1', 'minute', 60000);
    limiter.increment('acc1', 'hour', 3600000);
    expect(limiter.getCount('acc1', 'minute')).toBe(1);
    expect(limiter.getCount('acc1', 'hour')).toBe(1);
  });

  it('clearAccount removes all data', () => {
    limiter.increment('acc1', 'minute', 60000);
    limiter.increment('acc1', 'hour', 3600000);
    limiter.clearAccount('acc1');
    expect(limiter.getCount('acc1', 'minute')).toBe(0);
    expect(limiter.getCount('acc1', 'hour')).toBe(0);
  });
});
