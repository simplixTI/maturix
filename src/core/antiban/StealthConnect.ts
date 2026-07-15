import { createHash } from 'node:crypto';
import type { SocketConfig } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import { randomDelay, sleep } from '../../utils/gaussian.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('stealth-connect');

const BROWSER_FINGERPRINTS: [string, string, string][] = [
  ['Chrome (Windows)', 'Chrome', '120.0.6099.109'],
  ['Chrome (Windows)', 'Chrome', '121.0.6167.85'],
  ['Chrome (Windows)', 'Chrome', '122.0.6261.94'],
  ['Chrome (macOS)', 'Chrome', '120.0.6099.109'],
  ['Chrome (Linux)', 'Chrome', '120.0.6099.109'],
  ['Firefox (Windows)', 'Firefox', '121.0'],
  ['Edge (Windows)', 'Edge', '120.0.2210.91'],
  ['Safari (macOS)', 'Safari', '17.2'],
];

export function getStealthSocketConfig(accountId?: string): Partial<SocketConfig> {
  // Deterministic fingerprint per account - consistent across reconnects
  let index: number;
  if (accountId) {
    const hash = createHash('md5').update(accountId).digest();
    index = hash[0] % BROWSER_FINGERPRINTS.length;
  } else {
    index = Math.floor(Math.random() * BROWSER_FINGERPRINTS.length);
  }

  const fingerprint = BROWSER_FINGERPRINTS[index];

  return {
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    browser: fingerprint,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 20000,
    retryRequestDelayMs: 3000,
  };
}

export async function rampPresenceAfterConnect(
  sock: WASocket,
  options?: { minDelayMs?: number; maxDelayMs?: number }
): Promise<void> {
  const minDelay = options?.minDelayMs ?? 45000;
  const maxDelay = options?.maxDelayMs ?? 120000;
  const delay = randomDelay(minDelay, maxDelay);

  logger.debug({ delayMs: delay }, 'Ramping presence after stealth connect');
  await sleep(delay);

  await sock.sendPresenceUpdate('available');
}
