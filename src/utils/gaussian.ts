export function gaussianRandom(mean: number, stddev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * stddev;
}

export function gaussianClamp(mean: number, stddev: number, min: number, max: number): number {
  const value = gaussianRandom(mean, stddev);
  return Math.max(min, Math.min(max, value));
}

export function randomDelay(minMs: number, maxMs: number): number {
  const mean = (minMs + maxMs) / 2;
  const stddev = (maxMs - minMs) / 4;
  return Math.round(gaussianClamp(mean, stddev, minMs, maxMs));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
