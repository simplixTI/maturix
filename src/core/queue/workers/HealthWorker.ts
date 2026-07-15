import type { Job } from '../QueueManager.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { ProxyManager } from '../../proxy/ProxyManager.js';
import { ProxyRotator } from '../../proxy/ProxyRotator.js';
import { getDb } from '../../../database/client.js';
import { createEnrichedAlert } from '../../../services/alertLog.js';
import { getProtectionSettings } from '../../../config/protectionSettings.js';
import { createChildLogger } from '../../../utils/logger.js';

const logger = createChildLogger('health-worker');

export interface HealthCheckResult {
  totalSessions: number;
  activeSessions: number;
  unhealthySessions: string[];
  proxyReassignments: number;
  banRiskUpdates: number;
}

export function createHealthProcessor(
  sessionManager: SessionManager,
  _proxyManager: ProxyManager
) {
  const proxyRotator = new ProxyRotator();

  return async (_job: Job): Promise<HealthCheckResult> => {
    const db = getDb();
    const result: HealthCheckResult = {
      totalSessions: 0,
      activeSessions: sessionManager.getActiveCount(),
      unhealthySessions: [],
      proxyReassignments: 0,
      banRiskUpdates: 0,
    };

    // 1. Check all accounts that should be connected
    const accounts = await db.account.findMany({
      where: { status: 'CONNECTED', isPaused: false },
    });
    result.totalSessions = accounts.length;

    for (const account of accounts) {
      const sock = sessionManager.getSocket(account.id);
      if (!sock) {
        result.unhealthySessions.push(account.id);
        await db.account.update({
          where: { id: account.id },
          data: { status: 'DISCONNECTED' },
        });
      }
    }

    // 2. Reassign unhealthy proxies
    result.proxyReassignments = await proxyRotator.reassignUnhealthy();

    // 3. Recalculate ban risk for active accounts
    const activeAccounts = await db.account.findMany({
      where: { status: { in: ['CONNECTED', 'DISCONNECTED'] }, isPaused: false },
      include: { warmupState: true },
    });

    for (const account of activeAccounts) {
      if (!account.warmupState) continue;

      const { replyRate, blockRate, totalMessagesSent } = account.warmupState;
      let newRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

      // Only assess risk after enough messages have been sent
      if (totalMessagesSent < 20) {
        newRisk = 'LOW';
      } else if (blockRate > 0.05 || replyRate < 0.10) newRisk = 'CRITICAL';
      else if (blockRate > 0.02 || replyRate < 0.20) newRisk = 'HIGH';
      else if (blockRate > 0.01 || replyRate < 0.30) newRisk = 'MEDIUM';

      if (newRisk !== account.banRisk) {
        await db.account.update({
          where: { id: account.id },
          data: { banRisk: newRisk },
        });
        result.banRiskUpdates++;

        if (newRisk === 'CRITICAL' && totalMessagesSent >= 20) {
          // Optional auto-pause: when enabled, also freeze the number (stops sends)
          // on top of the SafeZoneGuard block. Otherwise just alert (user pauses).
          const autoPause = getProtectionSettings().autoPauseOnCritical;
          if (autoPause) {
            await db.account.update({
              where: { id: account.id },
              data: { isPaused: true, pauseReason: 'Auto-pausado: risco de ban CRÍTICO' },
            });
          }
          await createEnrichedAlert({
            accountId: account.id,
            type: 'HIGH_BLOCK_RATE',
            severity: 'WARNING',
            message: `Risco CRÍTICO (bloqueio ${(blockRate * 100).toFixed(1)}%, resposta ${(replyRate * 100).toFixed(1)}%)${autoPause ? ' · número auto-pausado' : ''}`,
            metadata: { blockRate, replyRate, autoPaused: autoPause },
          });
        }
      }
    }

    // 4. Check for stalled warmups (no activity in 24h)
    const oneDayAgo = new Date(Date.now() - 86400000);
    const stalledAccounts = await db.account.findMany({
      where: {
        status: 'CONNECTED',
        isPaused: false,
        warmupDay: { gt: 0, lt: 8 },
        lastActiveAt: { lt: oneDayAgo },
      },
    });

    for (const account of stalledAccounts) {
      await createEnrichedAlert({
        accountId: account.id,
        type: 'WARMUP_STALLED',
        severity: 'INFO',
        message: 'Aquecimento parado · sem atividade há 24h',
      });
    }

    logger.info(result, 'Health check completed');
    return result;
  };
}
