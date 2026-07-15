import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { ownerId, ownedAccountIds } from '../ownerScope.js';

export const alertRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  app.get('/', async (request) => {
    const owned = await ownedAccountIds(ownerId(request));
    return db.alertLog.findMany({
      where: { accountId: { in: owned } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/unacknowledged', async (request) => {
    const owned = await ownedAccountIds(ownerId(request));
    return db.alertLog.findMany({
      where: { acknowledged: false, accountId: { in: owned } },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/stats', async (request) => {
    const owned = await ownedAccountIds(ownerId(request));
    const inOwned = { accountId: { in: owned } };
    const last24h = new Date(Date.now() - 86400000);
    const [total, unacknowledged, critical, warning] = await Promise.all([
      db.alertLog.count({ where: { ...inOwned, createdAt: { gte: last24h } } }),
      db.alertLog.count({ where: { ...inOwned, acknowledged: false } }),
      db.alertLog.count({ where: { ...inOwned, severity: 'CRITICAL', createdAt: { gte: last24h } } }),
      db.alertLog.count({ where: { ...inOwned, severity: 'WARNING', createdAt: { gte: last24h } } }),
    ]);
    return { total, unacknowledged, critical, warning };
  });

  app.patch<{ Params: { id: string } }>('/:id/acknowledge', async (request, reply) => {
    const owned = await ownedAccountIds(ownerId(request));
    const alert = await db.alertLog.findFirst({ where: { id: request.params.id, accountId: { in: owned } } });
    if (!alert) return reply.code(404).send({ error: 'Alerta não encontrado' });
    await db.alertLog.update({ where: { id: request.params.id }, data: { acknowledged: true } });
    return { success: true };
  });

  app.post('/acknowledge-all', async (request) => {
    const owned = await ownedAccountIds(ownerId(request));
    await db.alertLog.updateMany({
      where: { acknowledged: false, accountId: { in: owned } },
      data: { acknowledged: true },
    });
    return { success: true };
  });
};
