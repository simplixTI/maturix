import 'dotenv/config';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/index.js';
import { getDb, disconnectDb } from './database/client.js';
import { SessionManager } from './core/session/SessionManager.js';
import { WarmupEngine } from './core/warmup/WarmupEngine.js';
import { ProxyManager } from './core/proxy/ProxyManager.js';
import { QueueManager } from './core/queue/QueueManager.js';
import { BehaviorEngine } from './core/antiban/BehaviorEngine.js';
import { SafeZoneGuard } from './core/antiban/SafeZoneGuard.js';
import { AntiBanOrchestrator } from './core/antiban/AntiBanOrchestrator.js';
import { createMessageProcessor } from './core/queue/workers/MessageWorker.js';
import { createReactionProcessor } from './core/queue/workers/ReactionWorker.js';
import { createStatusProcessor } from './core/queue/workers/StatusWorker.js';
import { createHealthProcessor } from './core/queue/workers/HealthWorker.js';
import { ConversationService } from './services/ConversationService.js';
import { MediaManager } from './core/messaging/MediaManager.js';
import { MessageHandler } from './core/warmup/MessageHandler.js';
import { MetricsService } from './services/MetricsService.js';
import { AlertService } from './services/AlertService.js';
import { createServer } from './api/server.js';
import { setAlertServiceRef } from './api/routes/settings.js';
import { createChildLogger } from './utils/logger.js';

const logger = createChildLogger('main');

async function bootstrap() {
  logger.info('Starting Maturador WhatsApp...');

  const config = loadConfig();

  // Operator-tunable runtime settings (message timing, etc.)
  const { loadRuntimeSettings } = await import('./config/runtimeSettings.js');
  await loadRuntimeSettings();

  // Anti-ban protection flags (ban-on-logout, auto-pause on critical).
  const { loadProtectionSettings } = await import('./config/protectionSettings.js');
  await loadProtectionSettings();

  // Warmup feature switches (status, media types, business messaging).
  const { loadWarmupFeatures } = await import('./config/warmupFeatures.js');
  await loadWarmupFeatures();

  // Database
  const db = getDb();
  await db.$connect();
  logger.info('Database connected');

  // Single-instance guard: refuse to start if another backend is already running
  // (two instances loading the same WhatsApp sessions cause connectionReplaced storms).
  const { acquireInstanceLock } = await import('./database/instanceLock.js');
  if (!(await acquireInstanceLock())) {
    logger.fatal('Another backend instance is already running. Exiting to avoid session conflicts.');
    await disconnectDb();
    process.exit(1);
  }

  // Seed admin user
  const { AuthService } = await import('./services/AuthService.js');
  const authService = new AuthService();
  await authService.seedAdmin();

  // Seed default conversation templates (required for the warmup engine to
  // schedule any conversations — without them, no messages are ever sent).
  const { seedConversationTemplates } = await import('./database/seedTemplates.js');
  await seedConversationTemplates();

  // Queues. message-outbound is DURABLE: scheduled messages (multi-minute delays)
  // are persisted and restored after a restart so they aren't silently lost.
  const queueManager = new QueueManager();
  const messageQueue = queueManager.createQueue('message-outbound', { durable: true });
  const actionQueue = queueManager.createQueue('action-queue');
  const statusQueue = queueManager.createQueue('status-queue');
  const healthQueue = queueManager.createQueue('health-check');
  logger.info('Queue system initialized');

  // Core services
  const sessionManager = new SessionManager();
  const warmupEngine = new WarmupEngine();
  const proxyManager = new ProxyManager();
  // ProxyRotator is used internally by HealthWorker
  const behaviorEngine = new BehaviorEngine();
  const safeZoneGuard = new SafeZoneGuard();
  const antiBanOrchestrator = new AntiBanOrchestrator(safeZoneGuard, behaviorEngine);
  const metricsService = new MetricsService();
  const alertService = new AlertService(config.ALERT_WEBHOOK_URL);
  setAlertServiceRef(alertService);

  // Shared media manager (one instance so API uploads/reloads reach the warmup).
  const mediaManager = new MediaManager();

  // Conversation service
  const conversationService = new ConversationService(messageQueue, actionQueue, mediaManager);
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const templatesDir = join(__dirname, 'core', 'messaging', 'templates');
  const mediaDir = join(process.cwd(), 'media');
  await conversationService.initialize(templatesDir, mediaDir);

  // Wire the warmup engine's dependencies so it can run its feature actions
  // (status posts, polls, location, group activity, standalone media, etc).
  // The media injector is shared with ConversationService so per-day quotas are
  // unified across in-conversation and standalone media.
  warmupEngine.configure({
    sessionManager,
    statusQueue,
    messageQueue,
    mediaInjector: conversationService.getMediaInjector(),
    mediaDir,
  });

  // Workers
  const messageProcessor = createMessageProcessor(sessionManager, behaviorEngine, safeZoneGuard);
  queueManager.createWorker('message-outbound', messageProcessor, 3);

  const reactionProcessor = createReactionProcessor(sessionManager, behaviorEngine);
  queueManager.createWorker('action-queue', reactionProcessor, 2);

  const statusProcessor = createStatusProcessor(sessionManager);
  queueManager.createWorker('status-queue', statusProcessor, 1);

  const healthProcessor = createHealthProcessor(sessionManager, proxyManager);
  queueManager.createWorker('health-check', healthProcessor, 1);

  // Restore durable jobs persisted before the last restart (scheduled messages).
  await queueManager.restoreJobs();

  // Schedule recurring health check every 30s
  await healthQueue.add('health-tick', {}, { repeat: { every: 30000 } });

  // Start proxy health checks
  proxyManager.start();

  // Assign a residential proxy as soon as a number connects (if it has none), so
  // warming traffic goes out through the number's own residential IP. OFF by default
  // (PROXY_AUTO_ASSIGN=true to enable) — only turn this on once your proxies hold a
  // STABLE WhatsApp connection (sticky session). Unstable proxies that drop the
  // socket cause reconnect flaps, so we don't auto-attach them.
  if (process.env.PROXY_AUTO_ASSIGN === 'true') {
    sessionManager.on('session:connected', (accountId) => {
      proxyManager
        .assignProxy(accountId)
        .then((pid) => {
          if (!pid) return;
          logger.info({ accountId, proxyId: pid }, 'Proxy assigned after connect');
          // Move the number onto its residential proxy ~1 min after connecting
          // (no-op if it's already on it), so a freshly-paired number doesn't keep
          // warming on the VPS's datacenter IP. The brief reconnect is intentional.
          setTimeout(() => {
            sessionManager.migrateToProxy(accountId).catch(() => {});
          }, 60_000 + Math.random() * 30_000);
        })
        .catch(() => {});
    });
  }

  // Optional: auto-assign a proxy to accounts without one BEFORE reconnecting.
  // OFF by default — an HTTP proxy that passes the health check can still break the
  // WhatsApp WebSocket (no QR / no connection). Only enable once you've confirmed
  // your proxies actually carry WhatsApp traffic. Set PROXY_AUTO_ASSIGN=true to opt in.
  if (process.env.PROXY_AUTO_ASSIGN === 'true') {
    const accountsForProxy = await db.account.findMany({
      where: { status: { not: 'BANNED' }, proxyId: null },
      select: { id: true },
    });
    if (accountsForProxy.length > 0) {
      let assigned = 0;
      for (const acc of accountsForProxy) {
        const pid = await proxyManager.assignProxy(acc.id).catch(() => null);
        if (pid) assigned++;
      }
      logger.info({ needed: accountsForProxy.length, assigned }, 'Auto-assigned proxies to accounts without one');
    }
  }

  // Reconnect all previously active sessions
  await sessionManager.startAll();
  logger.info({ activeSessions: sessionManager.getActiveCount() }, 'Sessions restored');

  // Configure anti-ban for each connected account
  const connectedAccounts = await db.account.findMany({
    where: { status: 'CONNECTED' },
    select: { id: true, warmupDay: true },
  });
  for (const acc of connectedAccounts) {
    antiBanOrchestrator.configureAccount(acc.id, acc.warmupDay);
  }

  // Auto-read & auto-react handler for incoming warmup pool messages
  const messageHandler = new MessageHandler(sessionManager, behaviorEngine, db);
  await messageHandler.start();
  logger.info('MessageHandler started – auto-read & auto-react enabled');

  // Apply each number's planned identity (name → bio → photo) shortly after it
  // connects — independent of the warmup engine running or its slow per-tick
  // lottery, so a freshly-paired/reconnected chip gets a real profile promptly.
  sessionManager.on('session:connected', (accountId) => {
    setTimeout(() => {
      warmupEngine.applyProfileOnConnect(accountId).catch(() => {});
    }, 25_000 + Math.random() * 25_000);
  });

  // Resume warming if it was running before the last restart/deploy. The engine
  // and conversation service are otherwise STOPPED by default (toggle from the
  // dashboard) — but a deploy/reboot should NOT silently stop an active warmup.
  const { loadWarmupRunState } = await import('./config/warmupRunState.js');
  if (await loadWarmupRunState()) {
    warmupEngine.start(60000);
    conversationService.start(30000);
    logger.info('Warmup engine RESUMED (was running before restart)');
  } else {
    logger.info('Warmup engine STOPPED - start from dashboard when ready');
  }

  // API server
  const { app, io } = await createServer(
    { sessionManager, warmupEngine, proxyManager, conversationService, mediaManager, mediaDir },
    config.PORT,
    config.HOST
  );

  // Forward alerts to WebSocket clients
  alertService.on('alert:created', (alert) => {
    io.emit('alert:new', alert);
  });

  // Forward all backend logs to WebSocket (for /logs page)
  const { onLogEntry } = await import('./utils/logger.js');
  onLogEntry((entry) => {
    io.emit('log:entry', entry);
  });

  // Periodic metrics broadcast every 10s
  setInterval(async () => {
    try {
      const metrics = await metricsService.getSystemMetrics();
      io.emit('metrics:update', metrics);
    } catch (err) {
      logger.warn({ err }, 'Failed to broadcast metrics');
    }
  }, 10000);

  // Intraday risk metrics: refresh blockRate/replyRate/totalMessagesSent on a
  // rolling 24h window every 3 min (and once now) so the ban-risk engine reacts
  // within minutes instead of only after the midnight aggregation.
  const refreshRisk = async () => {
    try {
      await metricsService.refreshRollingRiskMetrics();
    } catch (err) {
      logger.warn({ err }, 'Rolling risk metrics refresh failed');
    }
  };
  await refreshRisk();
  setInterval(refreshRisk, 180_000);

  // Self-heal connection status: re-assert CONNECTED for any account whose socket
  // is actually open but whose DB status got stuck (a late 'close' from a replaced
  // socket racing past 'open'). Without this, a number that's connected and
  // sending can keep showing "Desconectado" indefinitely.
  setInterval(() => {
    sessionManager.reconcileStatuses().catch((err) => {
      logger.warn({ err }, 'Status reconcile failed');
    });
  }, 30_000);

  // Daily aggregation + counter reset at midnight
  const scheduleDaily = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(async () => {
      await metricsService.aggregateDailyMetrics();
      await warmupEngine.resetDailyCounters();
      await alertService.checkBlockRates();
      scheduleDaily();
    }, msUntilMidnight);
  };
  scheduleDaily();

  // Periodic alert checks every 5 minutes
  setInterval(async () => {
    try {
      await alertService.checkBlockRates();
      await alertService.checkDisconnectStorms();
    } catch (err) {
      logger.warn({ err }, 'Alert check failed');
    }
  }, 300000);

  logger.info('Maturador WhatsApp fully operational');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    // Release the instance lock FIRST so a restart (dev watch) can re-acquire it
    // quickly, before the slower session/queue teardown.
    const { releaseInstanceLock } = await import('./database/instanceLock.js');
    await releaseInstanceLock();
    warmupEngine.stop();
    conversationService.stop();
    messageHandler.stop();
    proxyManager.stop();
    await sessionManager.disconnectAll();
    await queueManager.closeAll();
    io.close();
    await app.close();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Uncaught exception (process kept alive)');
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error({ reason: msg }, 'Unhandled rejection (process kept alive)');
});

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error during bootstrap');
  process.exit(1);
});
