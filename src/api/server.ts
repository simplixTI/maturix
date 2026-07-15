import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from 'socket.io';
import { createChildLogger } from '../utils/logger.js';
import { authMiddleware } from './middleware/auth.js';
import { accountRoutes } from './routes/accounts.js';
import { sessionRoutes } from './routes/sessions.js';
import { metricsRoutes } from './routes/metrics.js';
import { proxyRoutes } from './routes/proxies.js';
import { templateRoutes } from './routes/templates.js';
import { alertRoutes } from './routes/alerts.js';
import { settingsRoutes } from './routes/settings.js';
import { authRoutes } from './routes/auth.js';
import { conversationRoutes } from './routes/conversations.js';
import { sendRoutes } from './routes/send.js';
import { warmupControlRoutes } from './routes/warmup-control.js';
import { profileRoutes } from './routes/profile.js';
import { groupRoutes } from './routes/groups.js';
import { warmingGroupRoutes } from './routes/warming-groups.js';
import { discoveryRoutes } from './routes/discovery.js';
import { mediaRoutes } from './routes/media.js';
import { callRoutes } from './routes/calls.js';
import { businessRoutes } from './routes/businesses.js';
import type { SessionManager } from '../core/session/SessionManager.js';
import type { WarmupEngine } from '../core/warmup/WarmupEngine.js';
import type { ProxyManager } from '../core/proxy/ProxyManager.js';
import type { MediaManager } from '../core/messaging/MediaManager.js';

const logger = createChildLogger('api-server');

export interface ServerDeps {
  sessionManager: SessionManager;
  warmupEngine: WarmupEngine;
  proxyManager: ProxyManager;
  conversationService?: any;
  mediaManager?: MediaManager;
  mediaDir?: string;
}

export async function createServer(deps: ServerDeps, port: number, host: string) {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    credentials: true,
  });

  // Multipart for media folder uploads (videos can be large).
  await app.register(multipart, {
    limits: { fileSize: 64 * 1024 * 1024, files: 200 },
  });

  app.decorate('deps', deps);

  // Health check - no auth required
  app.get('/health', async () => ({
    status: 'ok',
    activeSessions: deps.sessionManager.getActiveCount(),
    uptime: process.uptime(),
  }));

  // Auth middleware for all /api routes
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      await authMiddleware(request, reply);
    }
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(accountRoutes, { prefix: '/api/accounts' });
  await app.register(sessionRoutes, { prefix: '/api/sessions' });
  await app.register(metricsRoutes, { prefix: '/api/metrics' });
  await app.register(proxyRoutes, { prefix: '/api/proxies' });
  await app.register(templateRoutes, { prefix: '/api/templates' });
  await app.register(alertRoutes, { prefix: '/api/alerts' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(conversationRoutes, { prefix: '/api/conversations' });
  await app.register(sendRoutes, { prefix: '/api/send' });
  await app.register(warmupControlRoutes, { prefix: '/api/warmup' });
  await app.register(profileRoutes, { prefix: '/api/profile' });
  await app.register(groupRoutes, { prefix: '/api/groups' });
  await app.register(warmingGroupRoutes, { prefix: '/api/warming-groups' });
  await app.register(discoveryRoutes, { prefix: '/api/discovery' });
  await app.register(mediaRoutes, { prefix: '/api/media' });
  await app.register(callRoutes, { prefix: '/api/calls' });
  await app.register(businessRoutes, { prefix: '/api/businesses' });

  // Serve the built frontend (web/dist) from the same origin as the API, so the
  // SPA's relative /api and /socket.io calls work without CORS. Only active when
  // the build exists (production/Docker); in dev the Vite server handles this.
  const webDist = join(process.cwd(), 'web', 'dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    // SPA fallback: any non-API, non-socket route serves index.html so client-side
    // routing (react-router) works on hard refresh / deep links.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/socket.io')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
    logger.info({ webDist }, 'Serving frontend build');
  }

  await app.listen({ port, host });

  // Socket.IO
  const io = new Server(app.server, {
    cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:3001' },
    pingInterval: 25000,
    pingTimeout: 10000,
  });

  deps.sessionManager.on('session:connected', (accountId) => {
    io.emit('session:status', { accountId, status: 'CONNECTED' });
  });

  deps.sessionManager.on('session:disconnected', (accountId, reason) => {
    io.emit('session:status', { accountId, status: 'DISCONNECTED', reason });
  });

  deps.sessionManager.on('session:banned', (accountId) => {
    io.emit('session:status', { accountId, status: 'BANNED' });
  });

  deps.sessionManager.on('call:rejected', (accountId, fromJid, isVideo) => {
    io.emit('call:rejected', { accountId, fromJid, isVideo, at: new Date().toISOString() });
  });

  // Store latest QR per account for polling
  const latestQR = new Map<string, string>();

  deps.sessionManager.on('session:qr', (accountId, qr) => {
    latestQR.set(accountId, qr);
    // Emit to specific room AND broadcast to all (in case client hasn't joined room yet)
    io.to(`account:${accountId}`).emit('session:qr', { accountId, qr });
    io.emit('session:qr', { accountId, qr });
  });

  deps.sessionManager.on('session:connected', (accountId) => {
    latestQR.delete(accountId);
  });

  deps.sessionManager.on('session:pairing-code', (accountId, code) => {
    io.to(`account:${accountId}`).emit('session:pairing-code', { accountId, code });
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Dashboard client connected');

    socket.on('subscribe:account', (accountId: string) => {
      if (typeof accountId === 'string' && accountId.length > 0 && accountId.length < 100) {
        socket.join(`account:${accountId}`);
      }
    });

    socket.on('unsubscribe:account', (accountId: string) => {
      socket.leave(`account:${accountId}`);
    });
  });

  logger.info({ port, host }, 'API server started');
  return { app, io };
}
