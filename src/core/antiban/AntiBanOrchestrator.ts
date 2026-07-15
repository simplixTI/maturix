import type { WASocket } from '@whiskeysockets/baileys';
import pLimit from 'p-limit';
import { RateLimiter } from './RateLimiter.js';
import { SafeZoneGuard } from './SafeZoneGuard.js';
import { BehaviorEngine } from './BehaviorEngine.js';
import { getWarmupProfile } from '../../config/warmup-profiles.js';
import { reserveDailySlot, releaseDailySlot } from '../warmup/DailyLimitGuard.js';

interface AntiBanConfig {
  msgsPerMinute: number;
  msgsPerHour: number;
  msgsPerDay: number;
  burstLimit: number;
  cooldownMs: number;
}

const DEFAULT_CONFIG: AntiBanConfig = {
  msgsPerMinute: 2,
  msgsPerHour: 30,
  msgsPerDay: 500,
  burstLimit: 5,
  cooldownMs: 60000,
};

export class AntiBanOrchestrator {
  private rateLimiter = new RateLimiter();
  private safeZoneGuard: SafeZoneGuard;
  private behaviorEngine: BehaviorEngine;
  private configs = new Map<string, AntiBanConfig>();
  private accountLocks = new Map<string, ReturnType<typeof pLimit>>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(safeZoneGuard: SafeZoneGuard, behaviorEngine: BehaviorEngine) {
    this.safeZoneGuard = safeZoneGuard;
    this.behaviorEngine = behaviorEngine;
    this.cleanupInterval = setInterval(() => this.rateLimiter.cleanup(), 300000);
  }

  private getLock(accountId: string): ReturnType<typeof pLimit> {
    let lock = this.accountLocks.get(accountId);
    if (!lock) {
      lock = pLimit(1);
      this.accountLocks.set(accountId, lock);
    }
    return lock;
  }

  configureAccount(accountId: string, warmupDay: number): void {
    const profile = getWarmupProfile(warmupDay);
    this.configs.set(accountId, {
      msgsPerMinute: Math.max(1, Math.ceil(profile.msgsPerHourMax / 30)),
      msgsPerHour: profile.msgsPerHourMax,
      msgsPerDay: profile.dailyLimit,
      burstLimit: Math.max(2, Math.ceil(profile.msgsPerHourMax / 10)),
      cooldownMs: warmupDay <= 3 ? 120000 : 60000,
    });
  }

  async canSendAndReserve(accountId: string, messageText?: string): Promise<{
    allowed: boolean;
    reason?: string;
    waitMs?: number;
  }> {
    const lock = this.getLock(accountId);

    return lock(async () => {
      const config = this.configs.get(accountId) ?? DEFAULT_CONFIG;

      if (!this.rateLimiter.check(accountId, 'minute', config.msgsPerMinute, 60000)) {
        return { allowed: false, reason: 'Per-minute limit reached', waitMs: this.rateLimiter.getResetTime(accountId, 'minute') };
      }
      if (!this.rateLimiter.check(accountId, 'hour', config.msgsPerHour, 3600000)) {
        return { allowed: false, reason: 'Per-hour limit reached', waitMs: this.rateLimiter.getResetTime(accountId, 'hour') };
      }
      if (!this.rateLimiter.check(accountId, 'day', config.msgsPerDay, 86400000)) {
        return { allowed: false, reason: 'Daily limit reached', waitMs: 3600000 as number };
      }

      const safeZoneResult = await this.safeZoneGuard.canSend(accountId, messageText);
      if (!safeZoneResult.allowed) {
        return { allowed: false, reason: safeZoneResult.reason, waitMs: safeZoneResult.retryAfterMs };
      }

      this.rateLimiter.increment(accountId, 'minute', 60000);
      this.rateLimiter.increment(accountId, 'hour', 3600000);
      this.rateLimiter.increment(accountId, 'day', 86400000);

      return { allowed: true };
    });
  }

  recordMessageSent(accountId: string, messageText: string): void {
    this.safeZoneGuard.recordMessage(accountId, messageText);
  }

  async prepareAndSend(
    sock: WASocket,
    accountId: string,
    jid: string,
    message: any,
    messageText: string
  ): Promise<any> {
    const canSend = await this.canSendAndReserve(accountId, messageText);
    if (!canSend.allowed) {
      throw new Error(`Blocked: ${canSend.reason}`);
    }

    // HARD DAILY CAP: atomically reserve a slot before sending.
    if (!(await reserveDailySlot(accountId))) {
      throw new Error('Blocked: daily message limit reached');
    }

    try {
      if (messageText.length > 0) {
        await this.behaviorEngine.simulateTyping(sock, jid, messageText.length);
      }

      const result = await sock.sendMessage(jid, message);
      this.recordMessageSent(accountId, messageText);
      // Daily counter already incremented by the reservation above.
      return result;
    } catch (err) {
      await releaseDailySlot(accountId);
      throw err;
    }
  }

  getAccountStats(accountId: string) {
    return {
      msgsThisMinute: this.rateLimiter.getCount(accountId, 'minute'),
      msgsThisHour: this.rateLimiter.getCount(accountId, 'hour'),
      msgsToday: this.rateLimiter.getCount(accountId, 'day'),
      config: this.configs.get(accountId) ?? DEFAULT_CONFIG,
    };
  }

  removeAccount(accountId: string): void {
    this.configs.delete(accountId);
    this.rateLimiter.clearAccount(accountId);
  }
}
