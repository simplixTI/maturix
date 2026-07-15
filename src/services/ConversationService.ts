import type { SimpleQueue } from '../core/queue/QueueManager.js';
import { getDb } from '../database/client.js';
import { ConversationPairer } from '../core/messaging/ConversationPairer.js';
import { TemplateEngine } from '../core/messaging/TemplateEngine.js';
import { MessageComposer } from '../core/messaging/MessageComposer.js';
import { MediaManager } from '../core/messaging/MediaManager.js';
import { MediaInjector } from '../core/messaging/MediaInjector.js';
import { MessageMixer } from '../core/messaging/MessageMixer.js';
import { WarmupScheduler } from '../core/warmup/WarmupScheduler.js';
import { randomDelay } from '../utils/gaussian.js';
import { isAwake } from '../utils/circadian.js';
import { getMessagingTiming } from '../config/runtimeSettings.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('conversation-service');

// Casual link messages (auto-generate a preview). Kept innocuous and rare.
const LINK_MESSAGES: string[] = [
  'olha isso https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'viu essa? https://g1.globo.com',
  'da uma olhada https://www.youtube.com',
  'achei interessante https://pt.wikipedia.org',
  'depois ve isso https://www.instagram.com',
];

// Send pacing is operator-tunable from the dashboard (Configurações → Ritmo de
// mensagens). Read live at each send so changes apply without a restart.

export class ConversationService {
  private pairer: ConversationPairer;
  private templateEngine: TemplateEngine;
  private mixer: MessageMixer;
  private messageComposer: MessageComposer;
  private mediaManager: MediaManager;
  private mediaInjector: MediaInjector;
  private warmupScheduler: WarmupScheduler;
  private messageQueue: SimpleQueue;
  private actionQueue: SimpleQueue;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(messageQueue: SimpleQueue, actionQueue: SimpleQueue, mediaManager?: MediaManager) {
    this.pairer = new ConversationPairer();
    this.templateEngine = new TemplateEngine();
    this.messageComposer = new MessageComposer();
    // Use the shared MediaManager when provided (so the API can reload pools and
    // both conversation + standalone media see the same files).
    this.mediaManager = mediaManager ?? new MediaManager();
    this.mediaInjector = new MediaInjector(this.mediaManager);
    this.mixer = new MessageMixer();
    this.warmupScheduler = new WarmupScheduler();
    this.messageQueue = messageQueue;
    this.actionQueue = actionQueue;
  }

  /** Shared injector so standalone media (WarmupEngine) reuses the same quotas. */
  getMediaInjector(): MediaInjector {
    return this.mediaInjector;
  }

  async initialize(templatesDir: string, mediaDir: string): Promise<void> {
    await this.templateEngine.loadFromFiles(templatesDir);
    await this.mediaManager.loadPools(mediaDir);
    await this.mixer.loadFromTemplates(templatesDir);
    logger.info({ mixerStats: this.mixer.getStats() }, 'ConversationService initialized with mixer');
  }

  start(intervalMs: number = 30000): void {
    this.tickInterval = setInterval(() => this.tick(), intervalMs);
    logger.info({ intervalMs }, 'Conversation service started');
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  async tick(): Promise<void> {
    // 1. Process pending conversations
    await this.processPendingConversations();

    // 2. Schedule new conversations for ready accounts. Scale the number of pairs
    //    with the fleet size (so 10+ numbers actually mesh, not 1 pair/30s), but
    //    never reuse an account twice in the same tick to avoid bursts.
    // Only schedule conversations between chips that are AWAKE right now. Each
    // chip sleeps on its own personalized window, so nothing new starts at night
    // (a human doesn't open WhatsApp at 3am). This is the hard circadian gate the
    // conversation flow was missing — capacity alone never reaches 0 at night.
    // Conversations are ALWAYS two-way: both chips must have daily headroom (so
    // each can reply) AND be awake. A chip with quota only pairs with another chip
    // that also has quota — never blasts one-sided into capped chips. The mesh
    // spreads "todos com todos" as caps reset (everyone has quota each morning).
    // ONE conversation at a time per chip. Without this, the intra-day pacing
    // (which gates on messages ALREADY sent) is defeated by a lag: a conversation
    // is scheduled instantly but its messages send over several minutes, so before
    // the counter catches up the next ticks schedule conv2, conv3… → a morning
    // burst that drains the whole daily quota by 9am. Excluding chips with an
    // in-flight conversation forces them to finish one (counter updates) before the
    // pace decides when to start the next → spread across the day.
    const inFlight = await getDb().conversationPair.findMany({
      where: { status: { in: ['PENDING', 'ACTIVE'] } },
      select: { initiatorId: true, responderId: true },
    });
    const busy = new Set<string>(inFlight.flatMap((c) => [c.initiatorId, c.responderId]));

    const readyAccounts = (await this.warmupScheduler.getReadyAccounts())
      .filter((id) => isAwake(id) && !busy.has(id));

    // MULTI-TENANT: pair ONLY within the same operator. Group the ready chips by
    // owner and run the pairing loop per group, so an operation's numbers never
    // talk to another operation's numbers (the mesh stays inside each tenant).
    const owners = await getDb().account.findMany({
      where: { id: { in: readyAccounts } },
      select: { id: true, ownerId: true },
    });
    const byOwner = new Map<string, string[]>();
    for (const a of owners) {
      const key = a.ownerId ?? '__none__';
      const arr = byOwner.get(key) ?? [];
      arr.push(a.id);
      byOwner.set(key, arr);
    }

    for (const group of byOwner.values()) {
      if (group.length < 2) continue;
      const maxPairs = Math.min(5, Math.floor(group.length / 2));
      const used = new Set<string>();
      for (let i = 0; i < maxPairs; i++) {
        const available = group.filter((id) => !used.has(id));
        if (available.length < 2) break;
        const pair = await this.pairer.findPair(available);
        if (!pair) break;
        used.add(pair.initiatorId);
        used.add(pair.responderId);
        await this.pairer.scheduleConversation(pair);
      }
    }
  }

  private async processPendingConversations(): Promise<void> {
    const db = getDb();
    const now = new Date();

    const pendingConversations = await db.conversationPair.findMany({
      where: {
        status: 'PENDING',
        scheduledAt: { lte: now },
      },
      take: 10,
    });

    for (const conv of pendingConversations) {
      await this.startConversation(conv);
    }

    // Also advance active conversations
    const activeConversations = await db.conversationPair.findMany({
      where: { status: 'ACTIVE' },
      take: 20,
    });

    for (const conv of activeConversations) {
      await this.advanceConversation(conv);
    }
  }

  private async startConversation(conv: any): Promise<void> {
    const db = getDb();

    if (!conv.templateId) {
      await db.conversationPair.update({
        where: { id: conv.id },
        data: { status: 'FAILED' },
      });
      return;
    }

    const template = await db.conversationTemplate.findUnique({
      where: { id: conv.templateId },
    });

    if (!template) {
      await db.conversationPair.update({
        where: { id: conv.id },
        data: { status: 'FAILED' },
      });
      return;
    }

    const messages = template.messages as any[];
    if (messages.length === 0) return;

    const firstStep = messages[0];
    const senderId = firstStep.role === 'initiator' ? conv.initiatorId : conv.responderId;
    const receiverId = firstStep.role === 'initiator' ? conv.responderId : conv.initiatorId;

    // Sleep gate: if the sender is in its night window, leave the conversation
    // PENDING (no status change) so it starts naturally once the chip wakes,
    // instead of firing the opener at 3am.
    if (!isAwake(senderId)) return;

    const senderAccount = await db.account.findUnique({ where: { id: senderId } });
    const receiverAccount = await db.account.findUnique({ where: { id: receiverId } });

    if (!senderAccount || !receiverAccount) {
      await db.conversationPair.update({
        where: { id: conv.id },
        data: { status: 'FAILED' },
      });
      return;
    }

    const recipientJid = `${receiverAccount.phoneNumber}@s.whatsapp.net`;

    const mediaPath = this.getMediaForType(firstStep.type);
    await this.messageQueue.add('send-message', {
      accountId: senderId,
      recipientJid,
      content: firstStep.text ?? firstStep.emoji ?? '',
      messageType: firstStep.type === 'reaction' ? 'text' : firstStep.type,
      conversationPairId: conv.id,
      stepIndex: 0,
      mediaPath,
      reactionEmoji: firstStep.emoji,
    }, {
      delay: randomDelay(getMessagingTiming().sendDelayMinMs, getMessagingTiming().sendDelayMaxMs),
    });

    await db.conversationPair.update({
      where: { id: conv.id },
      data: { status: 'ACTIVE', startedAt: new Date(), currentStep: 0 },
    });

    logger.debug({ convId: conv.id }, 'Conversation started');
  }

  private async advanceConversation(conv: any): Promise<void> {
    const db = getDb();

    if (!conv.templateId) return;

    // Pacing gate: small minimum so the per-message random delay is what
    // actually drives the spacing between steps, not a fixed wall.
    const minStepIntervalMs = getMessagingTiming().sendDelayMinMs;
    const conversationAge = Date.now() - (conv.startedAt ? new Date(conv.startedAt).getTime() : Date.now());
    const expectedElapsed = conv.currentStep * minStepIntervalMs;
    if (conversationAge < expectedElapsed + minStepIntervalMs) return;

    const template = await db.conversationTemplate.findUnique({
      where: { id: conv.templateId },
    });

    if (!template) return;

    const messages = template.messages as any[];
    const nextStep = conv.currentStep + 1;

    if (nextStep >= messages.length) {
      await db.conversationPair.update({
        where: { id: conv.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return;
    }

    const step = messages[nextStep];
    const senderId = step.role === 'initiator' ? conv.initiatorId : conv.responderId;
    const receiverId = step.role === 'initiator' ? conv.responderId : conv.initiatorId;

    // Sleep gate: pause the conversation overnight if the next speaker is asleep.
    // It resumes from this same step once the chip is back inside its window.
    if (!isAwake(senderId)) return;

    const receiverAccount = await db.account.findUnique({ where: { id: receiverId } });
    if (!receiverAccount) return;

    const recipientJid = `${receiverAccount.phoneNumber}@s.whatsapp.net`;

    if (step.type === 'reaction') {
      await this.messageQueue.add('send-message', {
        accountId: senderId,
        recipientJid,
        content: step.emoji ?? '{👍|😊|🔥|❤️|😂}',
        messageType: 'reaction',
        reactionEmoji: step.emoji ?? '{👍|😊|🔥}',
      }, {
        delay: randomDelay(getMessagingTiming().reactionDelayMinMs, getMessagingTiming().reactionDelayMaxMs),
      });
    } else {
      const mediaPath = this.getMediaForType(step.type);
      await this.messageQueue.add('send-message', {
        accountId: senderId,
        recipientJid,
        content: step.text ?? '',
        messageType: step.type,
        conversationPairId: conv.id,
        stepIndex: nextStep,
        mediaPath,
      }, {
        delay: randomDelay(getMessagingTiming().sendDelayMinMs, getMessagingTiming().sendDelayMaxMs),
      });

      // Mix media (photo / sticker / voice / video) into the live chat, per the
      // day's schedule + quota. Enqueued separately so it flows through the same
      // pipeline (daily cap, hourly limit, re-encode, logging).
      await this.maybeInjectMedia(senderId, recipientJid);

      // Occasionally share a link (auto-generates a preview) — human variety.
      await this.maybeInjectLink(senderId, recipientJid);
    }

    await db.conversationPair.update({
      where: { id: conv.id },
      data: { currentStep: nextStep },
    });
  }

  /** Rarely share a casual link (from day 6+) so chats include link previews. */
  private async maybeInjectLink(senderId: string, recipientJid: string): Promise<void> {
    const db = getDb();
    const sender = await db.account.findUnique({ where: { id: senderId }, select: { warmupDay: true } });
    const day = sender?.warmupDay ?? 1;
    if (day < 6 || Math.random() > 0.04) return;

    const text = LINK_MESSAGES[Math.floor(Math.random() * LINK_MESSAGES.length)];
    await this.messageQueue.add('send-message', {
      accountId: senderId,
      recipientJid,
      content: text,
      messageType: 'text',
    }, { delay: randomDelay(getMessagingTiming().sendDelayMinMs, getMessagingTiming().sendDelayMaxMs) });
  }

  /** Decide + enqueue a media message from `senderId` to `recipientJid`. */
  private async maybeInjectMedia(senderId: string, recipientJid: string): Promise<void> {
    const db = getDb();
    const sender = await db.account.findUnique({
      where: { id: senderId },
      select: { warmupDay: true },
    });
    if (!sender) return;
    const day = sender.warmupDay || 1;
    if (!this.mediaInjector.hasUnlockedTypes(day)) return;

    const job = this.mediaInjector.decide(senderId, day, 1);
    if (!job) return;

    await this.messageQueue.add('send-message', {
      accountId: senderId,
      recipientJid,
      content: '',
      messageType: job.type,
      mediaPath: job.mediaPath,
    }, { delay: job.delayMs });
  }

  private getMediaForType(type: string): string | undefined {
    if (type === 'image') return this.mediaManager.pickRandom('images') ?? undefined;
    if (type === 'audio') return this.mediaManager.pickRandom('audio') ?? undefined;
    if (type === 'sticker') return this.mediaManager.pickRandom('stickers') ?? undefined;
    if (type === 'video') return this.mediaManager.pickRandom('video') ?? undefined;
    return undefined;
  }

  async getConversationStats(): Promise<{
    pending: number;
    active: number;
    completedToday: number;
    failedToday: number;
  }> {
    const db = getDb();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [pending, active, completedToday, failedToday] = await Promise.all([
      db.conversationPair.count({ where: { status: 'PENDING' } }),
      db.conversationPair.count({ where: { status: 'ACTIVE' } }),
      db.conversationPair.count({ where: { status: 'COMPLETED', completedAt: { gte: startOfDay } } }),
      db.conversationPair.count({ where: { status: 'FAILED', createdAt: { gte: startOfDay } } }),
    ]);

    return { pending, active, completedToday, failedToday };
  }
}
