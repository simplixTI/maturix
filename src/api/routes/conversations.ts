import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { ownerId, ownedAccountIds } from '../ownerScope.js';

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // Generate mixed messages (preview)
  app.get<{ Querystring: { count?: string } }>('/mixed', async (request) => {
    const count = Math.min(parseInt(request.query.count || '5', 10), 20);
    const deps = (app as any).deps;
    const mixer = deps?.conversationService?.mixer;

    if (!mixer?.isLoaded()) {
      return { error: 'Mixer not loaded', messages: [] };
    }

    const conversation = mixer.generateConversation(count);
    const singles = Array.from({ length: count }, () => mixer.generateMixed());

    return { conversation, singles, stats: mixer.getStats() };
  });

  // Get all conversation pairs with their messages
  app.get('/', async (request) => {
    const owned = await ownedAccountIds(ownerId(request));
    return db.conversationPair.findMany({
      where: { initiatorId: { in: owned } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  // Active/pending conversations enriched with WHO is talking to WHOM, the topic
  // (template category) and step progress. Powers the dashboard KPI drill-down.
  app.get('/active', async (request) => {
    const owned = await ownedAccountIds(ownerId(request));
    const pairs = await db.conversationPair.findMany({
      where: { status: { in: ['ACTIVE', 'PENDING'] }, initiatorId: { in: owned } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (pairs.length === 0) return [];

    const accIds = [...new Set(pairs.flatMap((p) => [p.initiatorId, p.responderId]))];
    const accounts = await db.account.findMany({
      where: { id: { in: accIds } },
      select: { id: true, phoneNumber: true, displayName: true },
    });
    const accMap = new Map(accounts.map((a) => [a.id, a]));

    const tplIds = [...new Set(pairs.map((p) => p.templateId).filter(Boolean))] as string[];
    const tpls = tplIds.length
      ? await db.conversationTemplate.findMany({
          where: { id: { in: tplIds } },
          select: { id: true, category: true, messages: true },
        })
      : [];
    const tplMap = new Map(tpls.map((t) => [t.id, t]));

    return pairs.map((p) => {
      const ini = accMap.get(p.initiatorId);
      const res = accMap.get(p.responderId);
      const tpl = p.templateId ? tplMap.get(p.templateId) : null;
      const totalSteps = Array.isArray(tpl?.messages) ? (tpl!.messages as unknown[]).length : 0;
      return {
        id: p.id,
        status: p.status,
        initiator: ini ? { phone: ini.phoneNumber, name: ini.displayName } : null,
        responder: res ? { phone: res.phoneNumber, name: res.displayName } : null,
        category: tpl?.category ?? null,
        currentStep: p.currentStep ?? 0,
        totalSteps,
        startedAt: p.startedAt,
        scheduledAt: p.scheduledAt,
      };
    });
  });

  // Get message log between two accounts or for one account
  app.get<{ Querystring: { accountId?: string; limit?: string } }>('/messages', async (request) => {
    const { accountId, limit = '100' } = request.query;
    const take = Math.min(parseInt(limit, 10) || 100, 500);

    // Only show messages that actually have content. Every mesh message is logged
    // twice — OUTBOUND (with the real text) and a mirror INBOUND (received-counter
    // log). Older inbound logs stored no text, so showing them just produced noisy
    // "[TEXT]" rows. Filtering on content removes the empty mirrors and keeps the
    // real conversation.
    const owned = await ownedAccountIds(ownerId(request));
    const where: any = { spintaxOutput: { not: null } };
    if (accountId && owned.includes(accountId)) {
      where.OR = [{ senderId: accountId }, { receiverId: accountId }];
    } else {
      where.OR = [{ senderId: { in: owned } }, { receiverId: { in: owned } }];
    }

    const messages = await db.messageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        sender: { select: { id: true, phoneNumber: true } },
        receiver: { select: { id: true, phoneNumber: true } },
      },
    });

    return messages.reverse();
  });

  // Get all unique conversation threads (grouped by sender-receiver pairs)
  app.get('/threads', async (request) => {
    const accounts = await db.account.findMany({
      where: { ownerId: ownerId(request) },
      select: { id: true, phoneNumber: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    const owned = accounts.map((a) => a.id);

    // Get recent messages grouped by conversation
    const messages = await db.messageLog.findMany({
      where: { OR: [{ senderId: { in: owned } }, { receiverId: { in: owned } }] },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        sender: { select: { id: true, phoneNumber: true } },
        receiver: { select: { id: true, phoneNumber: true } },
      },
    });

    // Build threads
    const threadMap = new Map<string, {
      participants: string[];
      phones: string[];
      lastMessage: string;
      lastAt: string;
      messageCount: number;
    }>();

    for (const msg of messages) {
      const key = [msg.senderId, msg.receiverId].sort().join(':');
      const existing = threadMap.get(key);
      if (!existing) {
        threadMap.set(key, {
          participants: [msg.senderId, msg.receiverId].sort(),
          phones: [msg.sender.phoneNumber, msg.receiver.phoneNumber].sort(),
          lastMessage: msg.spintaxOutput ?? `[${msg.messageType}]`,
          lastAt: msg.createdAt.toISOString(),
          messageCount: 1,
        });
      } else {
        existing.messageCount++;
      }
    }

    return {
      accounts,
      threads: Array.from(threadMap.values()).sort((a, b) =>
        new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
      ),
    };
  });
};
