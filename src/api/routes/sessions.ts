import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { ownerId } from '../ownerScope.js';

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // Create account + start session (combined for new devices)
  app.post<{ Body: { phoneNumber: string; displayName?: string } }>('/connect', async (request, reply) => {
    const { phoneNumber, displayName } = request.body;
    if (!phoneNumber) return reply.code(400).send({ error: 'phoneNumber is required' });

    const deps = (app as any).deps;
    const owner = ownerId(request);
    const cleanPhone = phoneNumber.replace(/\D/g, '');

    // Create or find account. A phone number lives in exactly ONE operation —
    // refuse to take over a number already owned by a different operator.
    let account = await db.account.findUnique({ where: { phoneNumber: cleanPhone } });
    if (account && account.ownerId && account.ownerId !== owner) {
      return reply.code(409).send({ error: 'Este número já está cadastrado em outra operação.' });
    }
    if (!account) {
      account = await db.account.create({
        data: { phoneNumber: cleanPhone, displayName, status: 'CONNECTING', ownerId: owner },
      });
    } else {
      await db.account.update({
        where: { id: account.id },
        data: { status: 'CONNECTING', ownerId: account.ownerId ?? owner },
      });
    }

    // Pair DIRECT (no proxy) for reliability: a flaky proxy can stall QR generation
    // (no QR at all). A residential proxy is assigned AFTER the number connects
    // (see the session:connected handler in index.ts), so warming traffic still
    // goes through it on the automatic reconnects.
    deps.sessionManager.createSession(account.id, null).catch(() => {});

    return { accountId: account.id, status: 'connecting', phoneNumber: cleanPhone };
  });

  // Request pairing code (alternative to QR scan)
  // NOTE: Pairing code and QR code are MUTUALLY EXCLUSIVE in Baileys.
  // If you want pairing code, set printQRInTerminal: false and do NOT
  // listen for QR events. Calling requestPairingCode after QR has been
  // emitted causes a conflict. The frontend should choose one method.
  app.post<{ Body: { accountId: string; phoneNumber: string } }>('/pairing-code', async (request, reply) => {
    const { accountId, phoneNumber } = request.body;
    if (!accountId || !phoneNumber) return reply.code(400).send({ error: 'accountId and phoneNumber required' });

    const owned = await db.account.findFirst({ where: { id: accountId, ownerId: ownerId(request) }, select: { id: true } });
    if (!owned) return reply.code(404).send({ error: 'Account not found' });

    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) {
      return reply.code(404).send({
        error: 'Session not ready. Wait for the socket to initialize before requesting a pairing code.',
      });
    }

    // Only request pairing code if creds are not yet registered
    if (sock.authState?.creds?.registered) {
      return reply.code(400).send({ error: 'Session already authenticated. No pairing code needed.' });
    }

    const code = await deps.sessionManager.requestPairingCode(accountId, phoneNumber);

    if (!code) return reply.code(500).send({ error: 'Failed to generate pairing code. Session may not be ready yet.' });

    return { code, accountId };
  });

  // Reconnect existing account by ID
  app.post<{ Body: { accountId: string } }>('/reconnect', async (request, reply) => {
    const { accountId } = request.body;
    if (!accountId) return reply.code(400).send({ error: 'accountId required' });

    const deps = (app as any).deps;
    let account = await db.account.findFirst({ where: { id: accountId, ownerId: ownerId(request) }, include: { proxy: true } });
    if (!account) return reply.code(404).send({ error: 'Account not found' });

    await db.account.update({ where: { id: accountId }, data: { status: 'CONNECTING' } });

    // Manual reconnect: try existing creds first (no QR / no data loss when the
    // device is still linked), and auto-fall-back to a fresh QR only if the creds
    // are proven dead (loggedOut). Goes DIRECT so it can't stall on a flaky proxy;
    // the proxy is re-attached automatically after the number connects.
    deps.sessionManager.reconnectSession(accountId).catch(() => {});

    return { status: 'reconnecting', accountId, proxyId: account?.proxyId ?? null };
  });

  app.post<{ Body: { accountId: string } }>('/disconnect', async (request, reply) => {
    const { accountId } = request.body;
    const deps = (app as any).deps;

    const owned = await db.account.findFirst({ where: { id: accountId, ownerId: ownerId(request) }, select: { id: true } });
    if (!owned) return reply.code(404).send({ error: 'Account not found' });

    await deps.sessionManager.disconnectSession(accountId);
    await db.account.update({
      where: { id: accountId },
      data: { status: 'DISCONNECTED' },
    });

    return { status: 'disconnected', accountId };
  });

  // Poll for QR code (fallback if WebSocket misses it)
  app.get<{ Params: { id: string } }>('/qr/:id', async (request, reply) => {
    const { id } = request.params;
    // Access the latestQR map from server context
    const io = (app.server as any)?._io;
    // Try to trigger a new QR by checking session
    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(id);
    if (!sock) return reply.code(404).send({ error: 'No active session', qr: null });
    return { accountId: id, qr: null, status: 'waiting' };
  });

  app.get('/active', async () => {
    const deps = (app as any).deps;
    return { count: deps.sessionManager.getActiveCount() };
  });
};
