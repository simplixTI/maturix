import { EventEmitter } from 'eventemitter3';
import { getDb } from '../database/client.js';
import { createEnrichedAlert } from './alertLog.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('alert-service');

export interface AlertEvents {
  'alert:created': (alert: any) => void;
}

export class AlertService extends EventEmitter<AlertEvents> {
  private webhookUrl?: string;

  constructor(webhookUrl?: string) {
    super();
    this.webhookUrl = webhookUrl;
  }

  async createAlert(data: {
    accountId?: string;
    type: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    metadata?: any;
  }): Promise<any> {
    // Enrich with the instance name + phone and dedupe repeated alerts.
    const { alert, created } = await createEnrichedAlert(data);

    // Only notify (socket + webhook) when a genuinely new alert appears, so an
    // ongoing storm refreshes its single alert instead of re-pinging every tick.
    if (created) {
      this.emit('alert:created', alert);
      if ((data.severity === 'CRITICAL' || data.severity === 'WARNING') && this.webhookUrl) {
        await this.sendWebhook(alert);
      }
      logger.info({ type: data.type, severity: data.severity, accountId: data.accountId }, alert.message);
    }
    return alert;
  }

  async getRecentAlerts(limit: number = 50): Promise<any[]> {
    const db = getDb();
    return db.alertLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getUnacknowledged(): Promise<any[]> {
    const db = getDb();
    return db.alertLog.findMany({
      where: { acknowledged: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acknowledge(alertId: string): Promise<void> {
    const db = getDb();
    await db.alertLog.update({
      where: { id: alertId },
      data: { acknowledged: true },
    });
  }

  async acknowledgeAll(): Promise<void> {
    const db = getDb();
    await db.alertLog.updateMany({
      where: { acknowledged: false },
      data: { acknowledged: true },
    });
  }

  async checkBlockRates(): Promise<void> {
    const db = getDb();
    const accounts = await db.account.findMany({
      where: { status: 'CONNECTED' },
      include: { warmupState: true },
    });

    for (const account of accounts) {
      if (!account.warmupState) continue;
      const { blockRate } = account.warmupState;

      if (blockRate > 0.02 && account.banRisk !== 'CRITICAL') {
        await this.createAlert({
          accountId: account.id,
          type: 'HIGH_BLOCK_RATE',
          severity: 'WARNING',
          message: `Taxa de bloqueio em ${(blockRate * 100).toFixed(1)}% (limite 2%)`,
          metadata: { blockRate },
        });
      }
    }
  }

  async checkDisconnectStorms(): Promise<void> {
    const db = getDb();
    const tenMinAgo = new Date(Date.now() - 600000);

    const recentSessions = await db.session.findMany({
      where: { lastDisconnected: { gte: tenMinAgo } },
      select: { accountId: true },
    });

    const disconnectCounts = new Map<string, number>();
    for (const session of recentSessions) {
      disconnectCounts.set(
        session.accountId,
        (disconnectCounts.get(session.accountId) ?? 0) + 1
      );
    }

    for (const [accountId, count] of disconnectCounts) {
      if (count >= 3) {
        const lastSession = await db.session.findFirst({
          where: { accountId },
          orderBy: { lastDisconnected: 'desc' },
          select: { disconnectReason: true },
        });
        const reason = lastSession?.disconnectReason;
        await this.createAlert({
          accountId,
          type: 'DISCONNECT_STORM',
          severity: 'WARNING',
          message: `${count} desconexões em 10 min${reason ? ` · último motivo: ${reason}` : ''}`,
          metadata: { disconnectCount: count, lastReason: reason ?? null },
        });
      }
    }
  }

  setWebhookUrl(url: string | undefined): void {
    this.webhookUrl = url;
    logger.info({ hasWebhook: !!url }, 'Webhook URL atualizada');
  }

  getWebhookUrl(): string | undefined {
    return this.webhookUrl;
  }

  private detectWebhookType(url: string): 'telegram' | 'discord' | 'generic' {
    if (url.includes('api.telegram.org')) return 'telegram';
    if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) return 'discord';
    return 'generic';
  }

  private formatAlertText(alert: any): string {
    const severityEmoji = alert.severity === 'CRITICAL' ? '🚨' : alert.severity === 'WARNING' ? '⚠️' : 'ℹ️';
    const lines = [
      `${severityEmoji} *[${alert.severity}] ${alert.type}*`,
      ``,
      alert.message,
      ``,
      `Conta: \`${alert.accountId || 'N/A'}\``,
      `Data: ${new Date(alert.createdAt || Date.now()).toLocaleString('pt-BR')}`,
    ];
    return lines.join('\n');
  }

  private async sendTelegram(url: string, alert: any): Promise<void> {
    // Extract bot token and build sendMessage URL
    // URL format: https://api.telegram.org/bot{TOKEN}/sendMessage
    // or user may have stored just the base: https://api.telegram.org/bot{TOKEN}
    const text = this.formatAlertText(alert);

    // Parse chat_id from URL hash or query, otherwise use webhook URL as-is
    let apiUrl = url;
    let chatId: string | undefined;

    const urlObj = new URL(url);
    chatId = urlObj.searchParams.get('chat_id') || undefined;

    // If URL already ends with /sendMessage, use it directly
    if (!apiUrl.includes('/sendMessage')) {
      apiUrl = apiUrl.replace(/\/$/, '') + '/sendMessage';
    }

    const body: Record<string, string> = { text, parse_mode: 'Markdown' };
    if (chatId) {
      body.chat_id = chatId;
      // Remove chat_id from URL query
      urlObj.searchParams.delete('chat_id');
      apiUrl = urlObj.toString();
      if (!apiUrl.includes('/sendMessage')) {
        apiUrl = apiUrl.replace(/\/$/, '') + '/sendMessage';
      }
    }

    await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async sendDiscord(url: string, alert: any): Promise<void> {
    const severityColor = alert.severity === 'CRITICAL' ? 0xff0000 : alert.severity === 'WARNING' ? 0xffaa00 : 0x00ff88;
    const embed = {
      title: `[${alert.severity}] ${alert.type}`,
      description: alert.message,
      color: severityColor,
      fields: [
        { name: 'Conta', value: alert.accountId || 'N/A', inline: true },
        { name: 'Data', value: new Date(alert.createdAt || Date.now()).toLocaleString('pt-BR'), inline: true },
      ],
      footer: { text: 'Maturador WhatsApp' },
    };

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  }

  private async sendGenericWebhook(url: string, alert: any): Promise<void> {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        accountId: alert.accountId,
        timestamp: alert.createdAt,
      }),
    });
  }

  private async sendWebhook(alert: any): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      const type = this.detectWebhookType(this.webhookUrl);

      switch (type) {
        case 'telegram':
          await this.sendTelegram(this.webhookUrl, alert);
          break;
        case 'discord':
          await this.sendDiscord(this.webhookUrl, alert);
          break;
        default:
          await this.sendGenericWebhook(this.webhookUrl, alert);
          break;
      }

      logger.info({ type, alertType: alert.type }, 'Webhook enviado com sucesso');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Falha ao enviar webhook de alerta');
    }
  }

  async testWebhook(): Promise<{ success: boolean; type: string; error?: string }> {
    if (!this.webhookUrl) {
      return { success: false, type: 'none', error: 'Nenhuma URL de webhook configurada' };
    }

    const type = this.detectWebhookType(this.webhookUrl);
    const testAlert = {
      type: 'TEST_WEBHOOK',
      severity: 'INFO',
      message: 'Teste de webhook do Maturador WhatsApp - conexao OK!',
      accountId: 'test',
      createdAt: new Date(),
    };

    try {
      await this.sendWebhook(testAlert);
      return { success: true, type };
    } catch (err: any) {
      return { success: false, type, error: err.message };
    }
  }

  async getAlertStats(): Promise<{
    total: number;
    unacknowledged: number;
    criticalCount: number;
    warningCount: number;
  }> {
    const db = getDb();
    const last24h = new Date(Date.now() - 86400000);

    const [total, unacknowledged, criticalCount, warningCount] = await Promise.all([
      db.alertLog.count({ where: { createdAt: { gte: last24h } } }),
      db.alertLog.count({ where: { acknowledged: false } }),
      db.alertLog.count({ where: { severity: 'CRITICAL', createdAt: { gte: last24h } } }),
      db.alertLog.count({ where: { severity: 'WARNING', createdAt: { gte: last24h } } }),
    ]);

    return { total, unacknowledged, criticalCount, warningCount };
  }
}
