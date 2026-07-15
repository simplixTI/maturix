import type { FastifyPluginAsync } from 'fastify';
import { SAFE_ZONES, TIMING, SESSION, CIRCADIAN_CURVE, getWarmupSchedule } from '../../config/constants.js';
import { getAllProfiles } from '../../config/warmup-profiles.js';
import { AlertService } from '../../services/AlertService.js';
import { getMessagingTiming, setMessagingTiming, type MessagingTiming } from '../../config/runtimeSettings.js';
import { getProtectionSettings, setProtectionSettings, type ProtectionSettings } from '../../config/protectionSettings.js';
import { getWarmupFeatures, setWarmupFeatures, type WarmupFeatureSettings } from '../../config/warmupFeatures.js';

// Singleton reference - set when server starts
let alertServiceRef: AlertService | undefined;

export function setAlertServiceRef(svc: AlertService): void {
  alertServiceRef = svc;
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    return {
      safeZones: SAFE_ZONES,
      timing: TIMING,
      session: SESSION,
      warmup: getWarmupSchedule(),
      circadianCurve: CIRCADIAN_CURVE,
      warmupProfiles: getAllProfiles(),
      webhookUrl: alertServiceRef?.getWebhookUrl() || null,
      messagingTiming: getMessagingTiming(),
      protection: getProtectionSettings(),
      warmupFeatures: getWarmupFeatures(),
    };
  });

  /* ── Warmup feature switches (what the engine does during warming) ── */

  app.get('/warmup-features', async () => getWarmupFeatures());

  app.post<{ Body: Partial<WarmupFeatureSettings> }>('/warmup-features', async (request) => {
    const updated = await setWarmupFeatures(request.body || {});
    return { success: true, ...updated };
  });

  /* ── Anti-ban protection flags ── */

  app.get('/protection', async () => getProtectionSettings());

  app.post<{ Body: Partial<ProtectionSettings> }>('/protection', async (request) => {
    const updated = await setProtectionSettings(request.body || {});
    return { success: true, ...updated };
  });

  /* ── Messaging timing (operator-tunable send pacing) ── */

  app.get('/timing', async () => getMessagingTiming());

  app.post<{ Body: Partial<MessagingTiming> }>('/timing', async (request) => {
    const updated = await setMessagingTiming(request.body || {});
    return { success: true, ...updated };
  });

  app.get('/warmup-profiles', async () => {
    return getAllProfiles();
  });

  app.get('/circadian-curve', async () => {
    return { curve: CIRCADIAN_CURVE };
  });

  /* ── Webhook configuration ── */

  app.get('/webhook', async () => {
    const url = alertServiceRef?.getWebhookUrl();
    let type: string = 'none';
    if (url) {
      if (url.includes('api.telegram.org')) type = 'telegram';
      else if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) type = 'discord';
      else type = 'generic';
    }
    return { url: url || null, type };
  });

  app.post<{ Body: { url?: string } }>('/webhook', async (request) => {
    const { url } = request.body || {};
    if (alertServiceRef) {
      alertServiceRef.setWebhookUrl(url || undefined);
    }
    return { success: true, url: url || null };
  });

  app.post('/webhook/test', async () => {
    if (!alertServiceRef) {
      return { success: false, error: 'AlertService nao inicializado' };
    }
    return alertServiceRef.testWebhook();
  });
};
