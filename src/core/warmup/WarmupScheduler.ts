import { getDb } from '../../database/client.js';
import { getWarmupProfile } from '../../config/warmup-profiles.js';
import { getPhaseForDay } from './WarmupPhase.js';
import { getCircadianMultiplier, getActiveHoursToday } from '../../utils/circadian.js';
import { activeWindow } from '../../utils/accountIdentity.js';
import { CIRCADIAN_CURVE } from '../../config/constants.js';

export interface DailyCapacity {
  accountId: string;
  warmupDay: number;
  dailyLimit: number;
  msgsPerHourMax: number;
  newContactsMax: number;
  sentToday: number;
  receivedToday: number;
  headroom: number;
  currentHourCapacity: number;
  stage: string;
  allowedTypes: string[];
}

export class WarmupScheduler {
  async calculateCapacity(accountId: string): Promise<DailyCapacity | null> {
    const db = getDb();
    const account = await db.account.findUnique({
      where: { id: accountId },
      include: { warmupState: true },
    });

    if (!account || account.status !== 'CONNECTED' || account.isPaused) {
      return null;
    }

    const warmupDay = account.warmupDay || 1;
    const profile = getWarmupProfile(warmupDay, account.warmupTotalDays ?? undefined, account.id);
    const phase = getPhaseForDay(warmupDay);
    const hour = new Date().getHours();
    const circadianMult = getCircadianMultiplier(hour);

    const currentHourCapacity = Math.max(1, Math.floor(profile.msgsPerHourMax * circadianMult));
    const headroom = profile.dailyLimit - account.msgsSentToday;

    return {
      accountId,
      warmupDay,
      dailyLimit: profile.dailyLimit,
      msgsPerHourMax: profile.msgsPerHourMax,
      newContactsMax: profile.newContactsMax,
      sentToday: account.msgsSentToday,
      receivedToday: account.msgsReceivedToday,
      headroom: Math.max(0, headroom),
      currentHourCapacity,
      stage: phase.stage,
      allowedTypes: phase.allowedMessageTypes,
    };
  }

  async getAllCapacities(): Promise<DailyCapacity[]> {
    const db = getDb();
    const accounts = await db.account.findMany({
      where: { status: 'CONNECTED', isPaused: false },
      select: { id: true },
    });

    const capacities: DailyCapacity[] = [];
    for (const account of accounts) {
      const cap = await this.calculateCapacity(account.id);
      if (cap && cap.headroom > 0) {
        capacities.push(cap);
      }
    }

    return capacities;
  }

  /**
   * Intra-day pacing: how many of the daily quota SHOULD already be spent by the
   * current hour, shaped by the circadian curve over the chip's active window.
   * Without this, a chip drains its whole daily quota the moment it wakes (a 6am
   * burst) and then goes silent all day. With it, the quota spreads across the
   * day (more at peak hours, less at the edges), so messages, status posts and
   * business pings happen THROUGHOUT the day instead of all at once.
   */
  private expectedSentByNow(accountId: string, dailyLimit: number): number {
    const hour = new Date().getHours();
    const { start, end } = activeWindow(accountId);
    if (hour < start) return 0;
    if (hour >= end) return dailyLimit;
    let done = 0;
    let total = 0;
    for (let h = start; h < end; h++) {
      const w = CIRCADIAN_CURVE[h] ?? 0.05;
      total += w;
      if (h <= hour) done += w;
    }
    return total > 0 ? dailyLimit * (done / total) : dailyLimit;
  }

  async getReadyAccounts(): Promise<string[]> {
    const capacities = await this.getAllCapacities();
    return capacities
      .filter((c) => {
        if (c.headroom <= 0) return false;
        // Hold the chip back if it's already ahead of its expected pace for now —
        // this is what spreads the daily volume across the whole day.
        const expected = this.expectedSentByNow(c.accountId, c.dailyLimit);
        return c.sentToday < expected;
      })
      .map((c) => c.accountId);
  }

  estimateCompletionTime(warmupDay: number): string {
    if (warmupDay >= 8) return 'Mature - fully warmed';
    const remaining = 8 - warmupDay;
    return `${remaining} day${remaining > 1 ? 's' : ''} remaining`;
  }

  calculateOptimalSendRate(warmupDay: number): number {
    const profile = getWarmupProfile(warmupDay);
    const activeHours = getActiveHoursToday();
    return Math.ceil(profile.dailyLimit / activeHours);
  }
}
