import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { getWarmupProfile } from '../../config/warmup-profiles.js';
import { activeWindow, circadianOffset } from '../../utils/accountIdentity.js';
import { getCircadianMultiplier } from '../../utils/circadian.js';
import { plannedName, plannedBio } from '../../core/messaging/ProfileMaturation.js';
import { ownerId } from '../ownerScope.js';

export const accountRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // Per-account "identity" — the seeded desync (active hours, circadian offset,
  // jittered daily limit) plus the maturation profile (name/bio). Drives the
  // "Identidade da frota" card so the operator can see chips are not in lockstep.
  app.get('/identity', async (request) => {
    const accounts = await db.account.findMany({
      where: { ownerId: ownerId(request) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, phoneNumber: true, displayName: true, warmupDay: true, warmupTotalDays: true, status: true },
    });
    const hour = new Date().getHours();
    return accounts.map((a) => {
      const day = a.warmupDay || 1;
      const win = activeWindow(a.id);
      const baseDailyLimit = getWarmupProfile(day, a.warmupTotalDays ?? undefined).dailyLimit;
      const dailyLimit = getWarmupProfile(day, a.warmupTotalDays ?? undefined, a.id).dailyLimit;
      const activeNow = hour >= win.start && hour < win.end;
      const shifted = ((hour - circadianOffset(a.id)) % 24 + 24) % 24;
      const intensityPct = activeNow ? Math.round(getCircadianMultiplier(shifted) * 100) : 0;
      return {
        accountId: a.id,
        phoneNumber: a.phoneNumber,
        displayName: a.displayName,
        status: a.status,
        warmupDay: day,
        activeStart: win.start,
        activeEnd: win.end,
        circadianOffset: circadianOffset(a.id),
        activeNow,
        intensityPct,
        dailyLimit,
        baseDailyLimit,
        plannedName: plannedName(a.id),
        plannedBio: plannedBio(a.id),
      };
    });
  });

  app.get('/', async (request) => {
    return db.account.findMany({
      where: { ownerId: ownerId(request) },
      include: { proxy: true, warmupState: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const account = await db.account.findFirst({
      where: { id: request.params.id, ownerId: ownerId(request) },
      include: { proxy: true, warmupState: true, metrics: { orderBy: { date: 'desc' }, take: 30 } },
    });
    if (!account) return reply.code(404).send({ error: 'Account not found' });
    return account;
  });

  app.post<{ Body: { phoneNumber: string; displayName?: string } }>('/', async (request, reply) => {
    const { phoneNumber, displayName } = request.body;
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return reply.code(400).send({ error: 'phoneNumber is required' });
    }
    return db.account.create({
      data: { phoneNumber: phoneNumber.replace(/\D/g, ''), displayName, status: 'PENDING', ownerId: ownerId(request) },
    });
  });

  app.patch<{ Params: { id: string }; Body: { isPaused?: boolean; pauseReason?: string; displayName?: string; proxyId?: string | null; warmupTotalDays?: number | null } }>(
    '/:id',
    async (request, reply) => {
      const owner = ownerId(request);
      const account = await db.account.findFirst({ where: { id: request.params.id, ownerId: owner } });
      if (!account) return reply.code(404).send({ error: 'Account not found' });

      const { isPaused, pauseReason, displayName, proxyId, warmupTotalDays } = request.body;
      const data: any = {};
      if (displayName !== undefined) data.displayName = displayName;
      if (pauseReason !== undefined) data.pauseReason = pauseReason;
      if (warmupTotalDays !== undefined) {
        if (warmupTotalDays === null || warmupTotalDays === 0) {
          data.warmupTotalDays = null;
        } else if (!Number.isInteger(warmupTotalDays) || warmupTotalDays < 2 || warmupTotalDays > 365) {
          return reply.code(400).send({ error: 'warmupTotalDays deve ser um inteiro entre 2 e 365 (ou null para usar o padrão)' });
        } else {
          data.warmupTotalDays = warmupTotalDays;
        }
      }
      if (isPaused !== undefined) {
        data.isPaused = isPaused;
      }
      if (proxyId !== undefined) {
        if (proxyId === null || proxyId === '') {
          data.proxyId = null;
        } else {
          // Only allow assigning a proxy this operator owns.
          const proxy = await db.proxy.findFirst({ where: { id: proxyId, ownerId: owner } });
          if (!proxy) return reply.code(400).send({ error: 'Proxy não encontrado' });
          data.proxyId = proxyId;
        }
      }
      return db.account.update({ where: { id: request.params.id }, data });
    }
  );

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const id = request.params.id;
      const account = await db.account.findFirst({ where: { id, ownerId: ownerId(request) } });
      if (!account) return reply.code(404).send({ error: 'Account not found' });

      try { (app as any).deps?.sessionManager?.disconnectSession(id); } catch {}

      await db.$transaction([
        db.session.deleteMany({ where: { accountId: id } }),
        db.warmupState.deleteMany({ where: { accountId: id } }),
        db.accountMetrics.deleteMany({ where: { accountId: id } }),
        db.messageLog.deleteMany({ where: { OR: [{ senderId: id }, { receiverId: id }] } }),
        db.groupMembership.deleteMany({ where: { accountId: id } }),
        db.conversationPair.deleteMany({ where: { OR: [{ initiatorId: id }, { responderId: id }] } }),
        db.contactRelation.deleteMany({ where: { OR: [{ accountId: id }, { contactId: id }] } }),
        db.account.delete({ where: { id } }),
      ]);

      return { success: true };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  app.get('/stats/overview', async (request) => {
    const ownerWhere = { ownerId: ownerId(request) };
    const [total, connected, warming, atRisk, banned, paused] = await Promise.all([
      db.account.count({ where: ownerWhere }),
      db.account.count({ where: { ...ownerWhere, status: 'CONNECTED' } }),
      db.account.count({ where: { ...ownerWhere, warmupDay: { gt: 0, lt: 15 } } }),
      db.account.count({ where: { ...ownerWhere, banRisk: { in: ['HIGH', 'CRITICAL'] } } }),
      db.account.count({ where: { ...ownerWhere, status: 'BANNED' } }),
      db.account.count({ where: { ...ownerWhere, status: 'PAUSED' } }),
    ]);
    return { total, connected, warming, atRisk, banned, paused };
  });
};
