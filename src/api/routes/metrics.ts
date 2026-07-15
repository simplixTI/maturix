import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { ownerId, ownedAccountIds } from '../ownerScope.js';

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  app.get<{ Querystring: { accountId?: string; days?: string } }>('/', async (request) => {
    const { accountId, days = '7' } = request.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));

    const owned = await ownedAccountIds(ownerId(request));
    const where: any = { date: { gte: since } };
    where.accountId = accountId ? (owned.includes(accountId) ? accountId : '__none__') : { in: owned };

    return db.accountMetrics.findMany({ where, orderBy: { date: 'asc' } });
  });

  app.get('/today', async (request) => {
    const accounts = await db.account.findMany({
      where: { status: { not: 'BANNED' }, ownerId: ownerId(request) },
      select: {
        id: true,
        phoneNumber: true,
        msgsSentToday: true,
        msgsReceivedToday: true,
        warmupDay: true,
        banRisk: true,
      },
    });

    const totals = accounts.reduce(
      (acc, a) => ({ sent: acc.sent + a.msgsSentToday, received: acc.received + a.msgsReceivedToday }),
      { sent: 0, received: 0 }
    );

    return { totals, accounts };
  });

  /* ── CSV export ── */
  app.get<{ Querystring: { days?: string; accountId?: string; format?: string } }>('/export', async (request, reply) => {
    const { days = '30', accountId, format = 'csv' } = request.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));

    const owned = await ownedAccountIds(ownerId(request));
    const where: any = { date: { gte: since } };
    where.accountId = accountId ? (owned.includes(accountId) ? accountId : '__none__') : { in: owned };

    const metrics = await db.accountMetrics.findMany({
      where,
      orderBy: { date: 'asc' },
      include: { account: { select: { phoneNumber: true } } },
    });

    if (format !== 'csv') return metrics;

    const header = 'data,contaId,telefone,mensagensEnviadas,mensagensRecebidas,taxaResposta,taxaBloqueio,diaWarmup,nivelRisco';
    const rows = metrics.map((m) => {
      const dateStr = new Date(m.date).toISOString().split('T')[0];
      const phone = (m as any).account?.phoneNumber || '';
      const replyRate = m.replyRate !== null && m.replyRate !== undefined ? (m.replyRate * 100).toFixed(1) : '0';
      const blockRate = m.blockRate !== null && m.blockRate !== undefined ? (m.blockRate * 100).toFixed(1) : '0';
      return [dateStr, m.accountId, phone, m.messagesSent, m.messagesReceived, replyRate, blockRate, m.warmupDay, m.banRiskLevel].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const filename = `metricas_${days}d_${new Date().toISOString().split('T')[0]}.csv`;
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.get('/alerts', async (request) => {
    const owned = await ownedAccountIds(ownerId(request));
    return db.alertLog.findMany({
      where: { accountId: { in: owned } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });
};
