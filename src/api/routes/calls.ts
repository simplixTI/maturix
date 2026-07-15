import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { ownerId, ownedAccountIds } from '../ownerScope.js';

export const callRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // Recent rejected calls + stats (scoped to the operator's numbers).
  app.get<{ Querystring: { limit?: string } }>('/', async (request) => {
    const take = Math.min(parseInt(request.query.limit || '100', 10) || 100, 500);
    const owned = await ownedAccountIds(ownerId(request));
    const inOwned = { accountId: { in: owned } };

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [calls, total, today, accounts] = await Promise.all([
      db.callLog.findMany({ where: inOwned, orderBy: { createdAt: 'desc' }, take }),
      db.callLog.count({ where: inOwned }),
      db.callLog.count({ where: { ...inOwned, createdAt: { gte: startOfDay } } }),
      db.account.findMany({ where: { ownerId: ownerId(request) }, select: { id: true, phoneNumber: true } }),
    ]);

    const phoneById = new Map(accounts.map((a) => [a.id, a.phoneNumber]));
    const enriched = calls.map((c) => ({ ...c, accountPhone: phoneById.get(c.accountId) ?? null }));

    return { calls: enriched, stats: { total, today } };
  });

  // Clear the call history (only this operator's calls).
  app.delete('/', async (request) => {
    const owned = await ownedAccountIds(ownerId(request));
    const { count } = await db.callLog.deleteMany({ where: { accountId: { in: owned } } });
    return { success: true, deleted: count };
  });
};
