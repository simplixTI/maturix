import { getDb } from '../database/client.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('metrics-service');

export interface SystemMetrics {
  accounts: {
    total: number;
    connected: number;
    disconnected: number;
    warming: number;
    banned: number;
    paused: number;
  };
  messages: {
    sentToday: number;
    receivedToday: number;
    sentThisHour: number;
  };
  warmup: {
    avgDay: number;
    fullyWarmed: number;
    atRisk: number;
  };
  conversations: {
    activeNow: number;
    completedToday: number;
  };
}

export class MetricsService {
  async getSystemMetrics(): Promise<SystemMetrics> {
    const db = getDb();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const oneHourAgo = new Date(Date.now() - 3600000);

    const [
      total, connected, disconnected, warming, banned, paused,
      accounts, sentThisHour,
      warmingAccounts, fullyWarmed, atRisk,
      activeConvs, completedConvs,
    ] = await Promise.all([
      db.account.count(),
      db.account.count({ where: { status: 'CONNECTED' } }),
      db.account.count({ where: { status: 'DISCONNECTED' } }),
      db.account.count({ where: { warmupDay: { gt: 0, lt: 8 } } }),
      db.account.count({ where: { status: 'BANNED' } }),
      db.account.count({ where: { status: 'PAUSED' } }),
      db.account.findMany({
        where: { status: { not: 'BANNED' } },
        select: { msgsSentToday: true, msgsReceivedToday: true, warmupDay: true },
      }),
      db.messageLog.count({
        where: { direction: 'OUTBOUND', createdAt: { gte: oneHourAgo } },
      }),
      db.account.findMany({
        where: { warmupDay: { gt: 0, lt: 8 } },
        select: { warmupDay: true },
      }),
      db.account.count({ where: { warmupDay: { gte: 8 } } }),
      db.account.count({ where: { banRisk: { in: ['HIGH', 'CRITICAL'] } } }),
      db.conversationPair.count({ where: { status: 'ACTIVE' } }),
      db.conversationPair.count({ where: { status: 'COMPLETED', completedAt: { gte: startOfDay } } }),
    ]);

    const sentToday = accounts.reduce((sum, a) => sum + a.msgsSentToday, 0);
    const receivedToday = accounts.reduce((sum, a) => sum + a.msgsReceivedToday, 0);
    const avgDay = warmingAccounts.length > 0
      ? warmingAccounts.reduce((sum, a) => sum + a.warmupDay, 0) / warmingAccounts.length
      : 0;

    return {
      accounts: { total, connected, disconnected, warming, banned, paused },
      messages: { sentToday, receivedToday, sentThisHour },
      warmup: { avgDay: Math.round(avgDay * 10) / 10, fullyWarmed, atRisk },
      conversations: { activeNow: activeConvs, completedToday: completedConvs },
    };
  }

  async aggregateDailyMetrics(): Promise<void> {
    const db = getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const accounts = await db.account.findMany({
      where: { status: { not: 'BANNED' } },
      include: { warmupState: true },
    });

    for (const account of accounts) {
      const startOfDay = new Date(today);
      const endOfDay = new Date(today);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const [sentCount, receivedCount, blocksCount, uniqueRecipients] = await Promise.all([
        db.messageLog.count({
          where: { senderId: account.id, direction: 'OUTBOUND', createdAt: { gte: startOfDay, lt: endOfDay } },
        }),
        db.messageLog.count({
          where: { receiverId: account.id, direction: 'INBOUND', createdAt: { gte: startOfDay, lt: endOfDay } },
        }),
        db.messageLog.count({
          where: { senderId: account.id, status: 'FAILED', createdAt: { gte: startOfDay, lt: endOfDay } },
        }),
        db.messageLog.groupBy({
          by: ['receiverId'],
          where: { senderId: account.id, createdAt: { gte: startOfDay, lt: endOfDay } },
        }),
      ]);

      const replyRate = sentCount > 0 ? receivedCount / sentCount : 0;
      const blockRate = sentCount > 0 ? blocksCount / sentCount : 0;

      await db.accountMetrics.upsert({
        where: { accountId_date: { accountId: account.id, date: today } },
        create: {
          accountId: account.id,
          date: today,
          messagesSent: sentCount,
          messagesReceived: receivedCount,
          blocksReceived: blocksCount,
          uniqueContacts: uniqueRecipients.length,
          replyRate,
          blockRate,
          warmupDay: account.warmupDay,
          banRiskLevel: account.banRisk,
        },
        update: {
          messagesSent: sentCount,
          messagesReceived: receivedCount,
          blocksReceived: blocksCount,
          uniqueContacts: uniqueRecipients.length,
          replyRate,
          blockRate,
          warmupDay: account.warmupDay,
          banRiskLevel: account.banRisk,
        },
      });

      // Update warmup state with calculated rates
      if (account.warmupState) {
        await db.warmupState.update({
          where: { accountId: account.id },
          data: { replyRate, blockRate },
        });
      }
    }

    logger.info({ accountCount: accounts.length }, 'Daily metrics aggregated');
  }

  /**
   * Refresh ban-risk inputs on a ROLLING window (default last 24h) so the risk
   * engine reacts intraday instead of only after the midnight aggregation.
   *
   * This also populates `totalMessagesSent` — which was never written before, so
   * the risk gate `totalMessagesSent < 20 → LOW` pinned every account at LOW and
   * the whole MEDIUM/HIGH/CRITICAL escalation was inert. Now it reflects recent
   * activity and the risk engine (and SafeZoneGuard gates) actually engage.
   */
  async refreshRollingRiskMetrics(windowHours = 24): Promise<void> {
    const db = getDb();
    const since = new Date(Date.now() - windowHours * 3_600_000);
    const accounts = await db.account.findMany({
      where: { status: { not: 'BANNED' } },
      select: { id: true },
    });

    for (const a of accounts) {
      const [sent, received, blocks] = await Promise.all([
        db.messageLog.count({ where: { senderId: a.id, direction: 'OUTBOUND', createdAt: { gte: since } } }),
        db.messageLog.count({ where: { receiverId: a.id, direction: 'INBOUND', createdAt: { gte: since } } }),
        db.messageLog.count({ where: { senderId: a.id, status: 'FAILED', createdAt: { gte: since } } }),
      ]);
      const replyRate = sent > 0 ? received / sent : 0;
      const blockRate = sent > 0 ? blocks / sent : 0;

      // updateMany is a no-op when the account has no warmupState row yet.
      await db.warmupState.updateMany({
        where: { accountId: a.id },
        data: { replyRate, blockRate, totalMessagesSent: sent },
      });
    }
    logger.debug({ accountCount: accounts.length, windowHours }, 'Rolling risk metrics refreshed');
  }

  async getAccountHistory(accountId: string, days: number = 30) {
    const db = getDb();
    const since = new Date();
    since.setDate(since.getDate() - days);

    return db.accountMetrics.findMany({
      where: { accountId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });
  }

  async getHourlyDistribution(accountId?: string): Promise<number[]> {
    const db = getDb();
    const last24h = new Date(Date.now() - 86400000);

    const where: any = { direction: 'OUTBOUND', createdAt: { gte: last24h } };
    if (accountId) where.senderId = accountId;

    const messages = await db.messageLog.findMany({
      where,
      select: { createdAt: true },
    });

    const hourly = new Array(24).fill(0);
    for (const msg of messages) {
      hourly[msg.createdAt.getHours()]++;
    }

    return hourly;
  }
}
