import { getDb } from '../../database/client.js';
import { getWarmupProfile } from '../../config/warmup-profiles.js';
import { getPhaseForDay } from './WarmupPhase.js';
import { WARMUP_SCHEDULE } from '../../config/constants.js';
import { shouldActNow } from '../../utils/circadian.js';
import { createChildLogger } from '../../utils/logger.js';
import { randomDelay } from '../../utils/gaussian.js';

// Feature modules
import { sendLocation } from '../messaging/LocationSender.js';
import { sendPoll } from '../messaging/PollSender.js';
import { shareRandomPoolContact } from '../messaging/ContactSharer.js';
import { messageRandomBusiness } from '../messaging/BusinessContacts.js';
import { warmupGroupActivity } from '../messaging/GroupWarmer.js';
import { ProfileMaturation } from '../messaging/ProfileMaturation.js';
import { getStatusImagePool, getStatusCountForDay } from '../../core/queue/workers/StatusWorker.js';

import type { SessionManager } from '../session/SessionManager.js';
import type { SimpleQueue } from '../queue/QueueManager.js';
import type { MediaInjector } from '../messaging/MediaInjector.js';

const logger = createChildLogger('warmup-engine');

/**
 * Tracks how many statuses each account has posted today, to cap at 1-3.
 * Resets daily.
 */
interface DailyStatusTracker {
  [accountId: string]: { count: number; target: number; lastReset: string };
}

export class WarmupEngine {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private sessionManager: SessionManager | null = null;
  private statusQueue: SimpleQueue | null = null;
  private messageQueue: SimpleQueue | null = null;
  private mediaInjector: MediaInjector | null = null;
  private mediaDir: string = '';
  private statusTracker: DailyStatusTracker = {};
  private profileMaturation = new ProfileMaturation();

  /**
   * Inject dependencies needed for orchestration.
   */
  configure(opts: {
    sessionManager: SessionManager;
    statusQueue: SimpleQueue;
    messageQueue?: SimpleQueue;
    mediaInjector?: MediaInjector;
    mediaDir?: string;
  }): void {
    this.sessionManager = opts.sessionManager;
    this.statusQueue = opts.statusQueue;
    this.messageQueue = opts.messageQueue ?? null;
    this.mediaInjector = opts.mediaInjector ?? null;
    this.mediaDir = opts.mediaDir ?? '';
  }

  /**
   * Apply a number's planned identity (name → bio → photo) right after it
   * connects. Works even when the engine is stopped — called from the
   * session:connected handler — so every chip gets a real profile promptly
   * instead of waiting on the per-tick lottery. Idempotent + persisted.
   */
  async applyProfileOnConnect(accountId: string): Promise<void> {
    const sock = this.sessionManager?.getSocket(accountId);
    if (!sock) return;
    const acc = await getDb().account.findUnique({
      where: { id: accountId },
      select: { warmupDay: true },
    });
    await this.profileMaturation.applyOnConnect(sock, accountId, acc?.warmupDay ?? 1, this.mediaDir);
  }

  start(intervalMs: number = 60000): void {
    logger.info({ intervalMs }, 'Warmup engine started');
    this.tickInterval = setInterval(() => this.tick(), intervalMs);
    this.tick();
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    logger.info('Warmup engine stopped');
  }

  async tick(): Promise<string[]> {
    if (this.isRunning) return [];
    this.isRunning = true;

    try {
      return await this._tick();
    } catch (err) {
      logger.error({ err }, 'Warmup tick failed');
      return [];
    } finally {
      this.isRunning = false;
    }
  }

  private async _tick(): Promise<string[]> {
    const db = getDb();
    const readyAccounts: string[] = [];

    const accounts = await db.account.findMany({
      where: { status: 'CONNECTED', isPaused: false },
      include: { warmupState: true },
    });

    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    for (const account of accounts) {
      if (!account.warmupStartedAt) {
        const initialProfile = getWarmupProfile(1);
        await db.account.update({
          where: { id: account.id },
          // Set warmupDay to 1 immediately so dashboards reflect "em aquecimento"
          // from the first tick (otherwise it stays 0 for the whole first day).
          data: { warmupStartedAt: now, warmupDay: 1, dailyMsgLimit: initialProfile.dailyLimit },
        });
        await db.warmupState.upsert({
          where: { accountId: account.id },
          create: { accountId: account.id, currentDay: 1, dailyLimit: initialProfile.dailyLimit },
          update: { currentDay: 1, dailyLimit: initialProfile.dailyLimit, lastResetAt: now },
        });
        continue;
      }

      const daysSinceStart = Math.floor(
        (now.getTime() - account.warmupStartedAt.getTime()) / 86400000
      ) + 1;

      // Check inactivity reset
      if (account.lastActiveAt) {
        const inactiveHours =
          (now.getTime() - account.lastActiveAt.getTime()) / 3600000;
        if (inactiveHours >= WARMUP_SCHEDULE.INACTIVITY_RESET_HOURS) {
          logger.info({ accountId: account.id, inactiveHours }, 'Resetting warmup due to inactivity');
          await this.resetWarmup(account.id);
          continue;
        }
      }

      const profile = getWarmupProfile(daysSinceStart, account.warmupTotalDays ?? undefined, account.id);

      // Keep warmupState in sync when the day advances.
      if (account.warmupState && daysSinceStart !== account.warmupState.currentDay) {
        await db.warmupState.update({
          where: { accountId: account.id },
          data: {
            currentDay: daysSinceStart,
            dailyLimit: profile.dailyLimit,
          },
        });
      }
      // Always keep account.warmupDay in sync with the real elapsed day,
      // even on day 1 (otherwise it can stay stuck at 0 → "Em aquecimento: 0").
      if (account.warmupDay !== daysSinceStart) {
        await db.account.update({
          where: { id: account.id },
          data: { warmupDay: daysSinceStart, dailyMsgLimit: profile.dailyLimit },
        });
      }

      // Check headroom
      const headroom = profile.dailyLimit - account.msgsSentToday;
      if (headroom <= 0) continue;

      // Apply circadian rhythm — personalized per account so the fleet does not
      // wake, peak, and sleep in lockstep.
      if (!shouldActNow(undefined, account.id)) continue;

      readyAccounts.push(account.id);

      // ====== ORCHESTRATE WARMUP FEATURES PER ACCOUNT ======
      if (this.sessionManager) {
        const phase = getPhaseForDay(daysSinceStart);
        await this.orchestrateFeatures(account.id, daysSinceStart, phase, readyAccounts, todayKey);
      }
    }

    return readyAccounts;
  }

  /**
   * Orchestrate all warmup features for a single account on a tick.
   * Probabilities scale with warmup phase so we don't do everything on day 1.
   */
  private async orchestrateFeatures(
    accountId: string,
    warmupDay: number,
    phase: ReturnType<typeof getPhaseForDay>,
    allReadyAccounts: string[],
    todayKey: string,
  ): Promise<void> {
    if (!this.sessionManager) return;

    const sock = this.sessionManager.getSocket(accountId);
    if (!sock) return;

    // Phase multipliers - gradually unlock features
    // FOUNDATION (day 1-3): very conservative, only basics
    // EXPANSION (day 4-5): start adding variety
    // SCALING (day 6-7): most features active
    // MATURE (day 8+): everything unlocked
    const phaseMultiplier = this.getPhaseMultiplier(warmupDay);

    // SHARED POOL: inter-chip feature actions (location, poll, contact share, …)
    // can target ANY ready chip in the project, regardless of which login owns it —
    // every registered chip warms together.
    const db = getDb();
    const otherAccounts = allReadyAccounts.filter((id) => id !== accountId);
    const pairedAccountId = otherAccounts.length > 0
      ? otherAccounts[Math.floor(Math.random() * otherAccounts.length)]
      : null;

    let pairedJid: string | null = null;
    if (pairedAccountId) {
      const pairedAccount = await db.account.findUnique({
        where: { id: pairedAccountId },
        select: { phoneNumber: true },
      });
      if (pairedAccount) {
        pairedJid = `${pairedAccount.phoneNumber}@s.whatsapp.net`;
      }
    }

    // --- 1. LOCATION SHARING: 10% base chance (only from day 4+) ---
    if (pairedJid && warmupDay >= 4 && Math.random() < 0.10 * phaseMultiplier) {
      try {
        await sendLocation(sock, accountId, pairedJid);
        logger.debug({ accountId, action: 'location' }, 'Warmup: location sent');
      } catch (err: any) {
        logger.debug({ accountId, err: err.message }, 'Warmup: location failed');
      }
    }

    // --- 2. POLL CREATION: 5% base chance (only from day 5+) ---
    if (pairedJid && warmupDay >= 5 && Math.random() < 0.05 * phaseMultiplier) {
      try {
        await sendPoll(sock, accountId, pairedJid);
        logger.debug({ accountId, action: 'poll' }, 'Warmup: poll sent');
      } catch (err: any) {
        logger.debug({ accountId, err: err.message }, 'Warmup: poll failed');
      }
    }

    // --- 3. CONTACT SHARING: 8% base chance (only from day 3+) ---
    if (pairedJid && warmupDay >= 3 && Math.random() < 0.08 * phaseMultiplier) {
      try {
        await shareRandomPoolContact(sock, accountId, pairedJid);
        logger.debug({ accountId, action: 'vcard' }, 'Warmup: vCard shared');
      } catch (err: any) {
        logger.debug({ accountId, err: err.message }, 'Warmup: vCard failed');
      }
    }

    // --- 4. BUSINESS CONTACTS: external traffic, SCALED BY WARMUP STAGE ---
    // Real business bots auto-reply → genuine OUTSIDE traffic that breaks the
    // chip↔chip closed loop. The number of businesses a chip talks to per day
    // grows with its stage: 1/day in Foundation, ramping to ~4/day when mature —
    // a new number contacting many businesses at once looks unnatural, an aged
    // one doing it is normal. Capped at the daily target; spread through the day
    // by the circadian gate above.
    const businessTargetPerDay =
      warmupDay <= 3 ? 1 : warmupDay <= 5 ? 2 : warmupDay <= 7 ? 3 : 4;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const businessSentToday = await getDb().messageLog.count({
      where: {
        senderId: accountId,
        spintaxOutput: { startsWith: '[business:' },
        createdAt: { gte: startOfDay },
      },
    });
    if (businessSentToday < businessTargetPerDay && Math.random() < 0.25) {
      try {
        const result = await messageRandomBusiness(sock, accountId);
        if (result) {
          logger.debug(
            { accountId, business: result.businessName, sentToday: businessSentToday + 1, target: businessTargetPerDay },
            'Warmup: business messaged',
          );
        }
      } catch (err: any) {
        logger.debug({ accountId, err: err.message }, 'Warmup: business message failed');
      }
    }

    // --- 5. STATUS POSTING: 1x per day (from day 4+ when phase.allowStatus) ---
    //     Picks random images from media/images/ pool for image statuses
    if (phase.allowStatus && this.statusQueue) {
      await this.maybePostStatus(accountId, todayKey);
    }

    // --- 5b. PROFILE MATURATION: name → bio → photo, then occasional refresh ---
    await this.profileMaturation.maybeMature(sock, accountId, warmupDay, this.mediaDir);

    // --- 6. GROUP WARM-UP: 7% base chance (only when phase.allowGroups) ---
    if (phase.allowGroups && Math.random() < 0.07 * phaseMultiplier) {
      try {
        await warmupGroupActivity(sock, accountId);
        logger.debug({ accountId, action: 'group' }, 'Warmup: group activity');
      } catch (err: any) {
        logger.debug({ accountId, err: err.message }, 'Warmup: group activity failed');
      }
    }

    // --- 7. STANDALONE MEDIA: photo / sticker / voice / video to a paired chip ---
    //     Lower opportunity than in-conversation so most media stays contextual.
    //     Shares the injector's per-day quota with ConversationService.
    if (pairedJid && this.messageQueue && this.mediaInjector && this.mediaInjector.hasUnlockedTypes(warmupDay)) {
      const job = this.mediaInjector.decide(accountId, warmupDay, 0.5);
      if (job) {
        await this.messageQueue.add('send-message', {
          accountId,
          recipientJid: pairedJid,
          content: '',
          messageType: job.type,
          mediaPath: job.mediaPath,
        }, { delay: job.delayMs });
        logger.debug({ accountId, action: 'media', type: job.type }, 'Warmup: standalone media scheduled');
      }
    }
  }

  /**
   * Get a multiplier (0.0 - 1.0) based on warmup day.
   * Days 1-3: 0.3 (30% of base probability)
   * Days 4-5: 0.6
   * Days 6-7: 0.85
   * Day 8+: 1.0
   */
  private getPhaseMultiplier(warmupDay: number): number {
    if (warmupDay <= 3) return 0.3;
    if (warmupDay <= 5) return 0.6;
    if (warmupDay <= 7) return 0.85;
    return 1.0;
  }

  /**
   * Post status 1-3 times per day, tracked via in-memory tracker.
   * Spreads posts across active hours.
   */
  private async maybePostStatus(accountId: string, todayKey: string): Promise<void> {
    if (!this.statusQueue) return;

    // Initialize or reset daily tracker
    if (
      !this.statusTracker[accountId] ||
      this.statusTracker[accountId].lastReset !== todayKey
    ) {
      this.statusTracker[accountId] = {
        count: 0,
        target: getStatusCountForDay(),
        lastReset: todayKey,
      };
    }

    const tracker = this.statusTracker[accountId];
    if (tracker.count >= tracker.target) return;

    // Spread posts: probability = remaining posts / remaining active hours
    // Simplified: ~5% chance per tick to post (engine ticks every ~60s)
    if (Math.random() > 0.05) return;

    // Decide text or image
    const useImage = Math.random() < 0.3 && this.mediaDir; // 30% image if media available

    if (useImage && this.mediaDir) {
      const images = await getStatusImagePool(this.mediaDir);
      if (images.length > 0) {
        const imagePath = images[Math.floor(Math.random() * images.length)];
        await this.statusQueue.add('post-status', {
          accountId,
          type: 'image',
          imagePath,
        }, { delay: randomDelay(5000, 60000) });
        tracker.count++;
        logger.debug({ accountId, statusCount: tracker.count, target: tracker.target }, 'Image status scheduled');
        return;
      }
    }

    // Text status
    await this.statusQueue.add('post-status', {
      accountId,
      type: 'text',
    }, { delay: randomDelay(5000, 60000) });
    tracker.count++;
    logger.debug({ accountId, statusCount: tracker.count, target: tracker.target }, 'Text status scheduled');
  }

  private async resetWarmup(accountId: string): Promise<void> {
    const db = getDb();
    const now = new Date();
    const initialProfile = getWarmupProfile(1);
    await db.account.update({
      where: { id: accountId },
      data: {
        warmupDay: 0,
        warmupStartedAt: now,
        dailyMsgLimit: initialProfile.dailyLimit,
        msgsSentToday: 0,
        msgsReceivedToday: 0,
      },
    });
    await db.warmupState.upsert({
      where: { accountId },
      create: { accountId, currentDay: 1, dailyLimit: initialProfile.dailyLimit },
      update: {
        currentDay: 1,
        dailyLimit: initialProfile.dailyLimit,
        uniqueContactsToday: 0,
        lastResetAt: now,
      },
    });
  }

  async resetDailyCounters(): Promise<void> {
    const db = getDb();
    await db.account.updateMany({
      where: { status: { not: 'BANNED' } },
      data: { msgsSentToday: 0, msgsReceivedToday: 0 },
    });
    await db.warmupState.updateMany({
      data: { uniqueContactsToday: 0, lastResetAt: new Date() },
    });
    // Reset status tracker
    this.statusTracker = {};
    logger.info('Daily counters reset');
  }
}
