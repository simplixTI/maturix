import { getDb } from '../../database/client.js';
import { PROXY } from '../../config/constants.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('proxy-rotator');

export class ProxyRotator {
  async assignBestProxy(accountId: string): Promise<string | null> {
    const db = getDb();

    // Priority: MOBILE > RESIDENTIAL > DATACENTER
    const proxy = await db.proxy.findFirst({
      where: {
        isHealthy: true,
        assignedAccounts: { none: { id: accountId } },
      },
      orderBy: [
        { type: 'asc' }, // DATACENTER < MOBILE < RESIDENTIAL alphabetically, but we handle it
        { assignedAccounts: { _count: 'asc' } },
        { responseTimeMs: 'asc' },
      ],
    });

    if (!proxy) {
      logger.warn({ accountId }, 'No available proxy for assignment');
      return null;
    }

    // Check max accounts per proxy
    const assignedCount = await db.account.count({
      where: { proxyId: proxy.id },
    });

    if (assignedCount >= PROXY.MAX_ACCOUNTS_PER_PROXY) {
      // Try next proxy
      const altProxy = await db.proxy.findFirst({
        where: {
          isHealthy: true,
          id: { not: proxy.id },
          assignedAccounts: { none: { id: accountId } },
        },
        orderBy: { assignedAccounts: { _count: 'asc' } },
      });

      if (!altProxy) return null;

      await db.account.update({
        where: { id: accountId },
        data: { proxyId: altProxy.id },
      });

      logger.info({ accountId, proxyId: altProxy.id }, 'Proxy assigned (alt)');
      return altProxy.id;
    }

    await db.account.update({
      where: { id: accountId },
      data: { proxyId: proxy.id },
    });

    logger.info({ accountId, proxyId: proxy.id }, 'Proxy assigned');
    return proxy.id;
  }

  async reassignUnhealthy(): Promise<number> {
    const db = getDb();
    let reassigned = 0;

    const affectedAccounts = await db.account.findMany({
      where: {
        proxy: { isHealthy: false },
        status: { in: ['CONNECTED', 'DISCONNECTED'] },
      },
    });

    for (const account of affectedAccounts) {
      const newProxyId = await this.assignBestProxy(account.id);
      if (newProxyId) {
        reassigned++;
        logger.info(
          { accountId: account.id, oldProxyId: account.proxyId, newProxyId },
          'Proxy reassigned due to unhealthy status'
        );
      }
    }

    return reassigned;
  }

  async getProxyStats(): Promise<{
    total: number;
    healthy: number;
    unhealthy: number;
    unassigned: number;
    avgLatency: number;
  }> {
    const db = getDb();

    const [total, healthy, withAccounts, proxies] = await Promise.all([
      db.proxy.count(),
      db.proxy.count({ where: { isHealthy: true } }),
      db.proxy.count({ where: { assignedAccounts: { some: {} } } }),
      db.proxy.findMany({ where: { responseTimeMs: { not: null } }, select: { responseTimeMs: true } }),
    ]);

    const avgLatency = proxies.length > 0
      ? proxies.reduce((sum, p) => sum + (p.responseTimeMs ?? 0), 0) / proxies.length
      : 0;

    return {
      total,
      healthy,
      unhealthy: total - healthy,
      unassigned: total - withAccounts,
      avgLatency: Math.round(avgLatency),
    };
  }
}
