interface RateBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Map<string, RateBucket>>();

  check(accountId: string, window: string, limit: number, windowMs: number): boolean {
    if (!this.buckets.has(accountId)) {
      this.buckets.set(accountId, new Map());
    }

    const accountBuckets = this.buckets.get(accountId)!;
    const now = Date.now();
    const bucket = accountBuckets.get(window);

    if (!bucket || now >= bucket.resetAt) {
      accountBuckets.set(window, { count: 0, resetAt: now + windowMs });
      return true;
    }

    return bucket.count < limit;
  }

  increment(accountId: string, window: string, windowMs: number): void {
    if (!this.buckets.has(accountId)) {
      this.buckets.set(accountId, new Map());
    }

    const accountBuckets = this.buckets.get(accountId)!;
    const now = Date.now();
    const bucket = accountBuckets.get(window);

    if (!bucket || now >= bucket.resetAt) {
      accountBuckets.set(window, { count: 1, resetAt: now + windowMs });
    } else {
      bucket.count++;
    }
  }

  getCount(accountId: string, window: string): number {
    const bucket = this.buckets.get(accountId)?.get(window);
    if (!bucket || Date.now() >= bucket.resetAt) return 0;
    return bucket.count;
  }

  getRemaining(accountId: string, window: string, limit: number): number {
    return Math.max(0, limit - this.getCount(accountId, window));
  }

  getResetTime(accountId: string, window: string): number {
    const bucket = this.buckets.get(accountId)?.get(window);
    if (!bucket) return 0;
    return Math.max(0, bucket.resetAt - Date.now());
  }

  clearAccount(accountId: string): void {
    this.buckets.delete(accountId);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [accountId, windows] of this.buckets) {
      for (const [window, bucket] of windows) {
        if (now >= bucket.resetAt) {
          windows.delete(window);
        }
      }
      if (windows.size === 0) {
        this.buckets.delete(accountId);
      }
    }
  }
}
