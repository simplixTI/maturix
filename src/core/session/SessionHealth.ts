import { getDb } from '../../database/client.js';
import { createEnrichedAlert } from '../../services/alertLog.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('session-health');

interface DisconnectEvent {
  timestamp: number;
}

export class SessionHealth {
  private disconnectLog = new Map<string, DisconnectEvent[]>();
  private readonly STORM_THRESHOLD = 3;
  private readonly STORM_WINDOW_MS = 600000; // 10 minutes

  recordDisconnect(accountId: string): boolean {
    const now = Date.now();
    const events = this.disconnectLog.get(accountId) ?? [];
    events.push({ timestamp: now });

    const recent = events.filter(e => now - e.timestamp < this.STORM_WINDOW_MS);
    this.disconnectLog.set(accountId, recent);

    if (recent.length >= this.STORM_THRESHOLD) {
      logger.warn({ accountId, count: recent.length }, 'Disconnect storm detected');
      this.createStormAlert(accountId, recent.length);
      return true;
    }

    return false;
  }

  private async createStormAlert(accountId: string, count: number): Promise<void> {
    const db = getDb();
    const lastSession = await db.session.findFirst({
      where: { accountId },
      orderBy: { lastDisconnected: 'desc' },
      select: { disconnectReason: true },
    });
    const reason = lastSession?.disconnectReason;
    // Enriched (instance name + phone) and deduped: an ongoing storm refreshes a
    // single alert instead of creating one per disconnect.
    await createEnrichedAlert({
      accountId,
      type: 'DISCONNECT_STORM',
      severity: 'WARNING',
      message: `${count} desconexões em 10 min${reason ? ` · último motivo: ${reason}` : ''}`,
      metadata: { disconnectCount: count, lastReason: reason ?? null },
    });
  }

  clearAccount(accountId: string): void {
    this.disconnectLog.delete(accountId);
  }
}
