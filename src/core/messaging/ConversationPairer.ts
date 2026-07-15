import { getDb } from '../../database/client.js';
import { SAFE_ZONES } from '../../config/constants.js';
import { getPhaseForDay } from '../warmup/WarmupPhase.js';
import { getWarmupProfile } from '../../config/warmup-profiles.js';
import { randomDelay } from '../../utils/gaussian.js';
import { affinityForPair } from './relationshipAffinity.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('conversation-pairer');

interface PairResult {
  initiatorId: string;
  responderId: string;
  templateId: string;
}

export class ConversationPairer {
  async findPair(readyAccountIds: string[]): Promise<PairResult | null> {
    // Need at least TWO chips with daily headroom — conversations are ALWAYS
    // two-way. A chip only talks to a partner that can also reply, so no one ever
    // sits there sending into the void (one-sided traffic = a block signal).
    if (readyAccountIds.length < 2) return null;

    const db = getDb();

    const accounts = await db.account.findMany({
      where: { id: { in: readyAccountIds } },
      orderBy: { msgsSentToday: 'asc' },
    });
    if (accounts.length < 2) return null;

    // Pick initiator — weighted random from the least-active half (fairer spread).
    const bottomHalf = accounts.slice(0, Math.max(2, Math.ceil(accounts.length / 2)));
    const initiator = bottomHalf[Math.floor(Math.random() * bottomHalf.length)];

    // Check existing contacts from DB
    const existingContacts = await db.contactRelation.findMany({
      where: { accountId: initiator.id },
      select: { contactId: true },
    });
    const existingContactIds = new Set(existingContacts.map(c => c.contactId));

    let responder = null;
    let isNewPair = false;

    // GOAL: every chip eventually talks to EVERY other chip (full mesh), not just
    // a couple of fixed pairs. Only ever pair with chips that are READY right now
    // (online + awake + headroom) — an offline partner is never picked, so traffic
    // naturally redirects to whoever is available.
    const readyOthers = readyAccountIds.filter((id) => id !== initiator.id);
    const existingReady = readyOthers.filter((id) => existingContactIds.has(id));
    const newCandidateIds = readyOthers.filter((id) => !existingContactIds.has(id));

    // Bias toward forming a NEW contact while this chip hasn't reached everyone
    // available yet (so the graph fills toward "all-to-all"), but still revisit
    // existing contacts often (real people talk to their friends repeatedly).
    const reachable = existingReady.length + newCandidateIds.length;
    const coverage = reachable > 0 ? existingReady.length / reachable : 1; // share already connected
    // p(new): ~0.85 when sparse, ~0.30 when already well-connected.
    const wantNew =
      newCandidateIds.length > 0 &&
      (existingReady.length === 0 || Math.random() < 0.85 - coverage * 0.55);

    if (wantNew) {
      // New-contact formation is rate-limited per day (a real person doesn't add
      // many new people daily). If the cap is hit, fall through to an existing one.
      const warmupState = await db.warmupState.findUnique({ where: { accountId: initiator.id } });
      const phase = getPhaseForDay(initiator.warmupDay ?? 1);
      const maxNewContacts = Math.floor(SAFE_ZONES.NEW_CONTACTS_PER_DAY * phase.maxNewContactsMultiplier);
      const capReached = !!warmupState && warmupState.uniqueContactsToday >= maxNewContacts;

      if (!capReached) {
        // Mesh balance: prefer the least-connected candidate so the graph fills
        // evenly (no isolated nodes, no few super-connected hubs).
        const counts = await db.contactRelation.groupBy({
          by: ['accountId'],
          where: { accountId: { in: newCandidateIds } },
          _count: { _all: true },
        });
        const countMap = new Map(counts.map((c) => [c.accountId, c._count._all]));
        const sortedIds = [...newCandidateIds].sort(
          (a, b) => (countMap.get(a) ?? 0) - (countMap.get(b) ?? 0),
        );
        const poolSize = Math.max(1, Math.ceil(sortedIds.length / 3));
        const pickId = sortedIds[Math.floor(Math.random() * poolSize)];
        responder = accounts.find((a) => a.id === pickId) ?? null;

        if (responder) {
          isNewPair = true; // first ever conversation between these two → open with a greeting
          await db.$transaction([
            db.contactRelation.upsert({
              where: { accountId_contactId: { accountId: initiator.id, contactId: responder.id } },
              create: { accountId: initiator.id, contactId: responder.id },
              update: { lastSeenAt: new Date(), messageCount: { increment: 1 } },
            }),
            db.contactRelation.upsert({
              where: { accountId_contactId: { accountId: responder.id, contactId: initiator.id } },
              create: { accountId: responder.id, contactId: initiator.id },
              update: { lastSeenAt: new Date(), messageCount: { increment: 1 } },
            }),
            db.warmupState.update({
              where: { accountId: initiator.id },
              data: { uniqueContactsToday: { increment: 1 } },
            }),
          ]);
        }
      }
    }

    // Revisit (or fall back to) an existing ready contact.
    if (!responder && existingReady.length > 0) {
      const pickId = existingReady[Math.floor(Math.random() * existingReady.length)];
      responder = accounts.find((a) => a.id === pickId) ?? null;
    }

    // Predictive headroom reservation: a conversation template is multi-step and
    // BOTH sides send messages. Only schedule it if each account still has enough
    // daily headroom for the steps it will send — otherwise the conversation would
    // push them past the daily limit (the send-time cap would then truncate it
    // mid-chat, which looks unnatural). Scheduling is gated; the hard cap in the
    // workers remains the final guarantee.
    if (!responder) return null;

    // Pick a template that fits THIS pair's stable relationship, so their
    // conversations stay coherent over time (two friends keep chatting casually;
    // a customer always talks to the same kind of business). A brand-new pair
    // opens with a greeting before diving into the relationship's topics.
    const distinctCats = (await db.conversationTemplate.findMany({
      where: { isActive: true },
      distinct: ['category'],
      select: { category: true },
    })).map((c) => c.category);
    if (distinctCats.length === 0) {
      logger.warn('No active conversation templates available');
      return null;
    }
    const affinity = affinityForPair(initiator.id, responder.id, distinctCats);

    // Cascade: (new pair → greeting) → the pair's relationship categories → any.
    const tiers: string[][] = isNewPair ? [['greeting'], affinity.categories] : [affinity.categories];
    let template: Awaited<ReturnType<typeof db.conversationTemplate.findFirst>> = null;
    for (const cats of tiers) {
      const pool = cats.filter((c) => distinctCats.includes(c));
      if (pool.length === 0) continue;
      const c = await db.conversationTemplate.count({ where: { isActive: true, category: { in: pool } } });
      if (c === 0) continue;
      template = await db.conversationTemplate.findFirst({
        where: { isActive: true, category: { in: pool } },
        skip: Math.floor(Math.random() * c),
      });
      if (template) break;
    }
    if (!template) {
      // Fallback: any active template (keeps warming running even if categories don't line up).
      const total = await db.conversationTemplate.count({ where: { isActive: true } });
      template = await db.conversationTemplate.findFirst({
        where: { isActive: true },
        skip: Math.floor(Math.random() * total),
      });
    }
    if (!template) return null;

    const steps = (template.messages as Array<{ role?: string }>) ?? [];
    const initiatorSteps = steps.filter(s => s.role === 'initiator').length || 1;
    const responderSteps = steps.filter(s => s.role === 'responder').length || 1;

    // BOTH sides need headroom for their steps — the conversation must be able to
    // go BOTH WAYS. If the responder is capped it can't reply, which would leave
    // the initiator sending one-sided messages (a block signal), so we skip it.
    if (
      this.headroom(initiator) < initiatorSteps ||
      this.headroom(responder) < responderSteps
    ) {
      logger.debug(
        { initiator: initiator.id, responder: responder.id },
        'Skipping conversation: not enough two-way headroom for the full template',
      );
      return null;
    }

    return {
      initiatorId: initiator.id,
      responderId: responder.id,
      templateId: template.id,
    };
  }

  /** Remaining daily messages for an account based on its warmup profile. */
  private headroom(account: { id: string; warmupDay: number | null; warmupTotalDays: number | null; msgsSentToday: number }): number {
    const profile = getWarmupProfile(account.warmupDay ?? 1, account.warmupTotalDays ?? undefined, account.id);
    return profile.dailyLimit - account.msgsSentToday;
  }

  async scheduleConversation(pair: PairResult): Promise<void> {
    const db = getDb();
    const delay = randomDelay(0, 300000);
    const scheduledAt = new Date(Date.now() + delay);

    await db.conversationPair.create({
      data: {
        initiatorId: pair.initiatorId,
        responderId: pair.responderId,
        templateId: pair.templateId,
        scheduledAt,
        status: 'PENDING',
      },
    });

    logger.debug({
      initiator: pair.initiatorId,
      responder: pair.responderId,
      delayMs: delay,
    }, 'Conversation scheduled');
  }

  async getContactCount(accountId: string): Promise<number> {
    const db = getDb();
    return db.contactRelation.count({ where: { accountId } });
  }
}
