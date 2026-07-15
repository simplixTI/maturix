import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { resolveSpintax } from '../../core/messaging/SpintaxParser.js';
import { reserveDailySlot, releaseDailySlot } from '../../core/warmup/DailyLimitGuard.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('warming-groups');

/**
 * Casual group messages pool -- spintax-powered, Portuguese slang.
 * NO links, NO adult content, varied types.
 */
const WARMING_MESSAGES: string[] = [
  '{kkkkk|kkkk|hahaha|rsrsrs} {demais|mano|cara|vei}',
  '{bom dia|boa tarde|boa noite} {galera|pessoal|turma|gente}',
  '{concordo|pois e|exatamente|isso mesmo|vdd}',
  '{que {massa|top|show|legal|dahora}|{muito|mt} {bom|foda|massa}}',
  '{eita|opa|oxe|mds|nossa}',
  '{alguem|galera} {viu isso|sabe|ta sabendo}?',
  '{mano|cara|vei} {que loucura|inacreditavel|surreal}',
  '{sera|acho que|talvez} {sim|nao|pode ser}',
  '{boa|tmj|valeu|show}',
  '{to de boa|suave|tranquilo|de boas}',
  '{quem|alguem} {topa|quer|bora|partiu}?',
  '{exato|certissimo|e isso|faz sentido}',
  '{tava pensando|pensei nisso|refletindo} {nisso|sobre isso|aqui}',
  '{gente|pessoal|galera}, {olha|ve} {isso|essa|esse}',
  '{quem mais|alguem mais} {concorda|pensa assim|acha isso}?',
  '{simm|siim|sss|s} {pode crer|com certeza|total}',
  '{nao|nn} {acredito|creio|acho|to acreditando} {nisso|nessa|nesse}',
  '{salve|fala|ei} {galera|povo|turma}',
  '{alguem ai|alo|salve salve}',
  '{bora|partiu|vamo|vamos la}',
  '{to aqui|presente|cheguei|opa}',
  '{interessante|legal|bacana} {isso|esse assunto|essa parada}',
  '{verdade|fato|real|confere}',
  '{tenso|complicado|dificil|pesado} {isso|essa|hein}',
  '{ah sim|entendi|saquei|compreendi}',
];

/**
 * Extract invite code from a WhatsApp group invite link.
 * Accepts:
 *   https://chat.whatsapp.com/CODE
 *   http://chat.whatsapp.com/CODE
 *   chat.whatsapp.com/CODE
 *   Just the CODE itself
 */
function extractInviteCode(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;

  // Full URL or partial URL
  const match = trimmed.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
  if (match) return match[1];

  // If it looks like a raw code (alphanumeric, 20+ chars)
  if (/^[A-Za-z0-9]{15,}$/.test(trimmed)) return trimmed;

  return null;
}

export const warmingGroupRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // ── GET /api/warming-groups ── list all warming groups
  app.get<{
    Querystring: { accountId?: string; status?: string };
  }>('/', async (request) => {
    const { accountId, status } = request.query;
    const where: Record<string, unknown> = {};
    if (accountId) where.accountId = accountId;
    if (status) where.status = status;

    const groups = await db.warmingGroup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const stats = {
      total: groups.length,
      pending: groups.filter((g) => g.status === 'pending').length,
      joined: groups.filter((g) => g.status === 'joined' || g.status === 'active').length,
      left: groups.filter((g) => g.status === 'left').length,
      failed: groups.filter((g) => g.status === 'failed').length,
      totalMessages: groups.reduce((s, g) => s + g.messagesSent, 0),
    };

    return { groups, stats };
  });

  // ── POST /api/warming-groups ── add group link(s)
  app.post<{
    Body: { links: string[]; accountId?: string };
  }>('/', async (request, reply) => {
    const { links, accountId } = request.body;
    if (!links || !Array.isArray(links) || links.length === 0) {
      return reply.code(400).send({ error: 'links array is required' });
    }

    const created: Array<{ inviteLink: string; inviteCode: string; status: string }> = [];
    const skipped: string[] = [];

    for (const link of links) {
      const code = extractInviteCode(link);
      if (!code) {
        skipped.push(link);
        continue;
      }

      // Check if already exists
      const existing = await db.warmingGroup.findFirst({
        where: { inviteCode: code },
      });
      if (existing) {
        skipped.push(link);
        continue;
      }

      const group = await db.warmingGroup.create({
        data: {
          inviteLink: link.trim(),
          inviteCode: code,
          status: 'pending',
          accountId: accountId || null,
        },
      });
      created.push({ inviteLink: group.inviteLink, inviteCode: group.inviteCode, status: group.status });
    }

    return { created: created.length, skipped: skipped.length, groups: created, skippedLinks: skipped };
  });

  // ── POST /api/warming-groups/:id/join ── join a pending group
  app.post<{
    Params: { id: string };
    Body: { accountId: string };
  }>('/:id/join', async (request, reply) => {
    const { id } = request.params;
    const { accountId } = request.body;

    const group = await db.warmingGroup.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    if (group.status === 'joined' || group.status === 'active') {
      return reply.code(400).send({ error: 'Group already joined' });
    }

    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });

    try {
      const groupJid = await sock.groupAcceptInvite(group.inviteCode);

      // Try to get group name
      let groupName: string | null = null;
      try {
        const meta = await sock.groupMetadata(groupJid);
        groupName = meta.subject || null;
      } catch {
        // metadata fetch is optional
      }

      await db.warmingGroup.update({
        where: { id },
        data: {
          status: 'joined',
          groupJid,
          groupName,
          accountId,
          joinedAt: new Date(),
        },
      });

      logger.info({ groupId: id, groupJid, accountId }, 'Joined warming group');
      return { status: 'joined', groupJid, groupName };
    } catch (err: any) {
      await db.warmingGroup.update({
        where: { id },
        data: { status: 'failed', accountId },
      });
      logger.error({ groupId: id, err: err.message }, 'Failed to join warming group');
      return reply.code(500).send({ error: 'Failed to join group', detail: err.message });
    }
  });

  // ── POST /api/warming-groups/:id/leave ── leave a group
  app.post<{
    Params: { id: string };
    Body: { accountId: string };
  }>('/:id/leave', async (request, reply) => {
    const { id } = request.params;
    const { accountId } = request.body;

    const group = await db.warmingGroup.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    if (!group.groupJid) return reply.code(400).send({ error: 'Group has no JID (never joined)' });

    const deps = (app as any).deps;
    const effectiveAccountId = accountId || group.accountId;
    if (!effectiveAccountId) return reply.code(400).send({ error: 'accountId required' });

    const sock = deps.sessionManager.getSocket(effectiveAccountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });

    try {
      await sock.groupLeave(group.groupJid);

      await db.warmingGroup.update({
        where: { id },
        data: { status: 'left' },
      });

      logger.info({ groupId: id, groupJid: group.groupJid }, 'Left warming group');
      return { status: 'left', groupJid: group.groupJid };
    } catch (err: any) {
      logger.error({ groupId: id, err: err.message }, 'Failed to leave warming group');
      return reply.code(500).send({ error: 'Failed to leave group', detail: err.message });
    }
  });

  // ── DELETE /api/warming-groups/:id ── remove from list
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const group = await db.warmingGroup.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'Group not found' });

    await db.warmingGroup.delete({ where: { id } });
    return { status: 'removed', id };
  });

  // ── POST /api/warming-groups/interact ── send a random message to a random joined group
  app.post<{
    Body: { accountId: string };
  }>('/interact', async (request, reply) => {
    const { accountId } = request.body;
    if (!accountId) return reply.code(400).send({ error: 'accountId required' });

    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });

    // Find a random joined group
    const joinedGroups = await db.warmingGroup.findMany({
      where: {
        status: { in: ['joined', 'active'] },
        accountId,
        groupJid: { not: null },
      },
    });

    if (joinedGroups.length === 0) {
      return reply.code(400).send({ error: 'No joined groups found for this account' });
    }

    const randomGroup = joinedGroups[Math.floor(Math.random() * joinedGroups.length)];
    const groupJid = randomGroup.groupJid!;

    // Respect the hard daily cap before sending.
    if (!(await reserveDailySlot(accountId))) {
      return reply.code(429).send({ status: 'skipped', reason: 'daily-limit-reached' });
    }

    try {
      // Typing simulation
      await sock.sendPresenceUpdate('composing', groupJid);
      const typingDelay = 800 + Math.random() * 2200;
      await new Promise((r) => setTimeout(r, typingDelay));
      await sock.sendPresenceUpdate('paused', groupJid);

      // Pick and resolve a random spintax message
      const template = WARMING_MESSAGES[Math.floor(Math.random() * WARMING_MESSAGES.length)];
      const text = resolveSpintax(template);

      await sock.sendMessage(groupJid, { text });

      // Update stats
      await db.warmingGroup.update({
        where: { id: randomGroup.id },
        data: {
          messagesSent: { increment: 1 },
          lastActivity: new Date(),
          status: 'active',
        },
      });

      // Daily counter already incremented by the reservation above.

      logger.info({ accountId, groupJid, text }, 'Warming group interaction sent');
      return {
        status: 'sent',
        groupJid,
        groupName: randomGroup.groupName,
        message: text,
      };
    } catch (err: any) {
      await releaseDailySlot(accountId);
      logger.error({ accountId, groupJid, err: err.message }, 'Failed to interact in warming group');
      return reply.code(500).send({ error: 'Failed to send message', detail: err.message });
    }
  });

  // ── POST /api/warming-groups/bulk-join ── join all pending groups (with delays)
  app.post<{
    Body: { accountId: string };
  }>('/bulk-join', async (request, reply) => {
    const { accountId } = request.body;
    if (!accountId) return reply.code(400).send({ error: 'accountId required' });

    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });

    const pendingGroups = await db.warmingGroup.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingGroups.length === 0) {
      return reply.code(400).send({ error: 'No pending groups to join' });
    }

    // Check account warmup day for daily limit
    const account = await db.account.findUnique({ where: { id: accountId } });
    const warmupDay = account?.warmupDay ?? 0;
    const maxJoinsToday = warmupDay < 15 ? 3 : 8;

    // Count how many groups were joined today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const joinedToday = await db.warmingGroup.count({
      where: {
        accountId,
        joinedAt: { gte: todayStart },
        status: { in: ['joined', 'active'] },
      },
    });

    const remaining = Math.max(0, maxJoinsToday - joinedToday);
    const toJoin = pendingGroups.slice(0, remaining);

    if (toJoin.length === 0) {
      return {
        status: 'limit_reached',
        message: `Daily join limit reached (${joinedToday}/${maxJoinsToday}). Wait until tomorrow.`,
        joinedToday,
        maxJoinsToday,
      };
    }

    // Start joining in background -- respond immediately
    const results: Array<{ id: string; status: string; groupJid?: string; error?: string }> = [];

    // We join sequentially with a small delay to be safe, but respond immediately
    // with what we plan to do
    reply.send({
      status: 'joining',
      planned: toJoin.length,
      maxJoinsToday,
      joinedToday,
      message: `Joining ${toJoin.length} groups with delays. Check status in a few minutes.`,
    });

    // Process in background (fire and forget)
    (async () => {
      for (let i = 0; i < toJoin.length; i++) {
        const group = toJoin[i];
        try {
          const groupJid = await sock.groupAcceptInvite(group.inviteCode);
          let groupName: string | null = null;
          try {
            const meta = await sock.groupMetadata(groupJid);
            groupName = meta.subject || null;
          } catch {}

          await db.warmingGroup.update({
            where: { id: group.id },
            data: {
              status: 'joined',
              groupJid,
              groupName,
              accountId,
              joinedAt: new Date(),
            },
          });

          logger.info({ groupId: group.id, groupJid }, 'Bulk-joined warming group');
        } catch (err: any) {
          await db.warmingGroup.update({
            where: { id: group.id },
            data: { status: 'failed', accountId },
          });
          logger.error({ groupId: group.id, err: err.message }, 'Bulk-join failed');
        }

        // Wait 30-60 seconds between joins to respect anti-ban rules
        if (i < toJoin.length - 1) {
          const delay = 30000 + Math.random() * 30000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    })().catch((err) => {
      logger.error({ err: err.message }, 'Bulk-join background process failed');
    });
  });

  // ── POST /api/warming-groups/bulk-leave ── leave all joined groups
  app.post<{
    Body: { accountId: string };
  }>('/bulk-leave', async (request, reply) => {
    const { accountId } = request.body;
    if (!accountId) return reply.code(400).send({ error: 'accountId required' });

    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });

    const joinedGroups = await db.warmingGroup.findMany({
      where: {
        status: { in: ['joined', 'active'] },
        accountId,
        groupJid: { not: null },
      },
    });

    if (joinedGroups.length === 0) {
      return reply.code(400).send({ error: 'No joined groups to leave' });
    }

    let leftCount = 0;
    let failedCount = 0;

    for (const group of joinedGroups) {
      try {
        await sock.groupLeave(group.groupJid!);
        await db.warmingGroup.update({
          where: { id: group.id },
          data: { status: 'left' },
        });
        leftCount++;
      } catch (err: any) {
        logger.error({ groupId: group.id, err: err.message }, 'Failed to leave group in bulk');
        failedCount++;
      }
    }

    return { status: 'done', left: leftCount, failed: failedCount };
  });
};
