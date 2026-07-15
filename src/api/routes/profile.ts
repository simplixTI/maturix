import type { FastifyPluginAsync } from 'fastify';
import { createChildLogger } from '../../utils/logger.js';
import { getDb } from '../../database/client.js';
import { ownerId } from '../ownerScope.js';
import type { SessionManager } from '../../core/session/SessionManager.js';

const logger = createChildLogger('profile-routes');

// Rate limit: min 30s between profile updates per account
const lastUpdate = new Map<string, number>();

function checkRateLimit(accountId: string, action: string): string | null {
  const key = `${accountId}:${action}`;
  const now = Date.now();
  const last = lastUpdate.get(key);
  if (last && now - last < 30_000) {
    const wait = Math.ceil((30_000 - (now - last)) / 1000);
    return `Rate limited. Wait ${wait}s before updating ${action} again.`;
  }
  lastUpdate.set(key, now);
  return null;
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  const getSessionManager = (): SessionManager => (app as any).deps.sessionManager;

  // Multi-tenant guard: every profile route targets a :accountId — only allow
  // the operator that owns that number.
  app.addHook('preHandler', async (request, reply) => {
    const accountId = (request.params as any)?.accountId;
    if (!accountId) return;
    const owned = await getDb().account.findFirst({ where: { id: accountId, ownerId: ownerId(request) }, select: { id: true } });
    if (!owned) return reply.code(404).send({ error: 'Account not found' });
  });

  // GET /api/profile/:accountId — get profile info
  app.get<{ Params: { accountId: string } }>(
    '/:accountId',
    async (request, reply) => {
      const { accountId } = request.params;
      const sm = getSessionManager();
      const sock = sm.getSocket(accountId);

      if (!sock) {
        return reply.code(404).send({ error: 'Session not found or not connected' });
      }

      try {
        const jid = sock.user?.id;
        if (!jid) {
          return reply.code(400).send({ error: 'Session not fully initialized (no user JID)' });
        }

        let pictureUrl: string | null = null;
        try {
          const url = await sock.profilePictureUrl(jid, 'image');
          pictureUrl = url ?? null;
        } catch {
          // User may not have a profile picture or privacy blocks it
          try {
            const url = await sock.profilePictureUrl(jid, 'preview');
            pictureUrl = url ?? null;
          } catch {
            pictureUrl = null;
          }
        }

        // Baileys doesn't expose a direct "getProfileName" or "getProfileStatus"
        // for own user — the name comes from sock.user, bio from fetchStatus
        const name = sock.user?.name ?? null;

        let bio: string | null = null;
        try {
          const status = await sock.fetchStatus(jid);
          if (status && typeof status === 'object') {
            // fetchStatus can return { status: string, setAt: Date } or an array
            if (Array.isArray(status)) {
              const first = status[0] as Record<string, unknown> | undefined;
              bio = typeof first?.status === 'string' ? first.status : null;
            } else {
              const s = status as Record<string, unknown>;
              bio = typeof s.status === 'string' ? s.status : null;
            }
          }
        } catch {
          bio = null;
        }

        return {
          accountId,
          jid,
          name,
          bio,
          pictureUrl,
        };
      } catch (err: any) {
        logger.error({ accountId, err: err.message }, 'Failed to get profile info');
        return reply.code(500).send({ error: err.message || 'Failed to fetch profile' });
      }
    }
  );

  // PATCH /api/profile/:accountId/name — update display name
  app.patch<{ Params: { accountId: string }; Body: { name: string } }>(
    '/:accountId/name',
    async (request, reply) => {
      const { accountId } = request.params;
      const { name } = request.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({ error: 'name is required (non-empty string)' });
      }

      if (name.length > 25) {
        return reply.code(400).send({ error: 'Name must be 25 characters or less (WhatsApp limit)' });
      }

      const rateLimitMsg = checkRateLimit(accountId, 'name');
      if (rateLimitMsg) {
        return reply.code(429).send({ error: rateLimitMsg });
      }

      const sm = getSessionManager();
      const sock = sm.getSocket(accountId);

      if (!sock) {
        return reply.code(404).send({ error: 'Session not found or not connected' });
      }

      try {
        await sock.updateProfileName(name.trim());
        logger.info({ accountId, name: name.trim() }, 'Profile name updated');
        return { success: true, name: name.trim() };
      } catch (err: any) {
        logger.error({ accountId, err: err.message }, 'Failed to update profile name');
        return reply.code(500).send({ error: err.message || 'Failed to update name' });
      }
    }
  );

  // PATCH /api/profile/:accountId/bio — update bio/status text
  app.patch<{ Params: { accountId: string }; Body: { bio: string } }>(
    '/:accountId/bio',
    async (request, reply) => {
      const { accountId } = request.params;
      const { bio } = request.body;

      if (typeof bio !== 'string') {
        return reply.code(400).send({ error: 'bio must be a string' });
      }

      if (bio.length > 139) {
        return reply.code(400).send({ error: 'Bio must be 139 characters or less (WhatsApp limit)' });
      }

      const rateLimitMsg = checkRateLimit(accountId, 'bio');
      if (rateLimitMsg) {
        return reply.code(429).send({ error: rateLimitMsg });
      }

      const sm = getSessionManager();
      const sock = sm.getSocket(accountId);

      if (!sock) {
        return reply.code(404).send({ error: 'Session not found or not connected' });
      }

      try {
        await sock.updateProfileStatus(bio);
        logger.info({ accountId, bioLength: bio.length }, 'Profile bio updated');
        return { success: true, bio };
      } catch (err: any) {
        logger.error({ accountId, err: err.message }, 'Failed to update profile bio');
        return reply.code(500).send({ error: err.message || 'Failed to update bio' });
      }
    }
  );

  // POST /api/profile/:accountId/picture — update profile picture
  app.post<{ Params: { accountId: string }; Body: { data: string } }>(
    '/:accountId/picture',
    async (request, reply) => {
      const { accountId } = request.params;
      const { data } = request.body;

      if (!data || typeof data !== 'string') {
        return reply.code(400).send({ error: 'data is required (base64 encoded image)' });
      }

      const rateLimitMsg = checkRateLimit(accountId, 'picture');
      if (rateLimitMsg) {
        return reply.code(429).send({ error: rateLimitMsg });
      }

      const sm = getSessionManager();
      const sock = sm.getSocket(accountId);

      if (!sock) {
        return reply.code(404).send({ error: 'Session not found or not connected' });
      }

      try {
        const jid = sock.user?.id;
        if (!jid) {
          return reply.code(400).send({ error: 'Session not fully initialized (no user JID)' });
        }

        // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
        const base64Data = data.includes(',') ? data.split(',')[1] : data;
        const buffer = Buffer.from(base64Data, 'base64');

        // Validate minimum size (must be a real image, not empty)
        if (buffer.length < 1024) {
          return reply.code(400).send({ error: 'Image data too small — must be a valid image' });
        }

        // Max 5MB
        if (buffer.length > 5 * 1024 * 1024) {
          return reply.code(400).send({ error: 'Image too large — max 5MB' });
        }

        await sock.updateProfilePicture(jid, buffer);
        logger.info({ accountId, sizeKb: Math.round(buffer.length / 1024) }, 'Profile picture updated');
        return { success: true, sizeKb: Math.round(buffer.length / 1024) };
      } catch (err: any) {
        logger.error({ accountId, err: err.message }, 'Failed to update profile picture');
        return reply.code(500).send({ error: err.message || 'Failed to update picture' });
      }
    }
  );
};
