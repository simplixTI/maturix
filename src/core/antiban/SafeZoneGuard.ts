import { createHash } from 'node:crypto';
import { getDb } from '../../database/client.js';
import { SAFE_ZONES } from '../../config/constants.js';

interface CanSendResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

interface CachedAccountData {
  account: any;
  msgsThisHour: number;
  cachedAt: number;
}

const CACHE_TTL_MS = 15000;

export class SafeZoneGuard {
  private messageHashes = new Map<string, { hash: string; timestamp: number }[]>();
  private accountCache = new Map<string, CachedAccountData>();

  async canSend(accountId: string, messageText?: string): Promise<CanSendResult> {
    const now = Date.now();

    // Use cached data if fresh (15s TTL)
    let cached = this.accountCache.get(accountId);
    if (!cached || (now - cached.cachedAt) > CACHE_TTL_MS) {
      const db = getDb();
      const oneHourAgo = new Date(now - 3600000);

      const [account, msgsThisHour] = await Promise.all([
        db.account.findUnique({
          where: { id: accountId },
          include: { warmupState: true },
        }),
        db.messageLog.count({
          where: {
            senderId: accountId,
            direction: 'OUTBOUND',
            createdAt: { gte: oneHourAgo },
          },
        }),
      ]);

      cached = { account, msgsThisHour, cachedAt: now };
      this.accountCache.set(accountId, cached);
    }

    const { account, msgsThisHour } = cached;

    if (!account) return { allowed: false, reason: 'Account not found' };
    if (account.banRisk === 'CRITICAL') return { allowed: false, reason: 'Critical ban risk' };
    if (account.isPaused) return { allowed: false, reason: 'Account paused' };

    if (msgsThisHour >= SAFE_ZONES.MSGS_PER_HOUR) {
      return {
        allowed: false,
        reason: `Hourly limit reached (${msgsThisHour}/${SAFE_ZONES.MSGS_PER_HOUR})`,
        retryAfterMs: 60000,
      };
    }

    if (account.warmupState) {
      const { replyRate, blockRate } = account.warmupState;

      if (account.warmupState.totalMessagesSent > 20 && replyRate < SAFE_ZONES.REPLY_RATE_MIN) {
        return {
          allowed: false,
          reason: `Reply rate too low (${(replyRate * 100).toFixed(1)}% < ${SAFE_ZONES.REPLY_RATE_MIN * 100}%)`,
          retryAfterMs: 300000,
        };
      }

      if (account.warmupState.totalMessagesSent > 50 && blockRate > SAFE_ZONES.BLOCK_RATE_MAX) {
        return {
          allowed: false,
          reason: `Block rate too high (${(blockRate * 100).toFixed(1)}% > ${SAFE_ZONES.BLOCK_RATE_MAX * 100}%)`,
          retryAfterMs: 600000,
        };
      }

      if (account.warmupState.uniqueContactsToday >= SAFE_ZONES.NEW_CONTACTS_PER_DAY) {
        return {
          allowed: false,
          reason: `New contacts limit reached today`,
          retryAfterMs: 3600000,
        };
      }
    }

    if (messageText) {
      const isDuplicate = this.checkDuplicateMessage(accountId, messageText);
      if (isDuplicate) {
        return { allowed: false, reason: 'Too many identical messages this hour' };
      }
    }

    return { allowed: true };
  }

  recordMessage(accountId: string, messageText: string): void {
    const hash = createHash('sha256').update(messageText).digest('hex').slice(0, 16);
    const now = Date.now();

    const entries = this.messageHashes.get(accountId) ?? [];
    entries.push({ hash, timestamp: now });

    const oneHourAgo = now - 3600000;
    const recent = entries.filter(e => e.timestamp > oneHourAgo);
    this.messageHashes.set(accountId, recent);
  }

  private checkDuplicateMessage(accountId: string, text: string): boolean {
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    const entries = (this.messageHashes.get(accountId) ?? [])
      .filter(e => e.timestamp > oneHourAgo);

    const sameCount = entries.filter(e => e.hash === hash).length;
    return sameCount >= SAFE_ZONES.IDENTICAL_MSGS_PER_HOUR;
  }
}
