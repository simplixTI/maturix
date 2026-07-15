import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { ownerId } from '../ownerScope.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('group-generator');

// Random group-name building blocks (casual PT-BR).
const NAME_A = ['Família', 'Galera', 'Turma', 'Amigos', 'Pessoal', 'Resenha', 'Bonde', 'Squad', 'Tropa', 'Equipe', 'Rolê', 'Parças', 'Time', 'Clube', 'União'];
const NAME_B = ['do Zap', 'Unidos', 'Top', 'Reunidos', 'da Firma', 'VIP', 'do Bairro', 'Animados', 'da Quebrada', 'Oficial', 'Premium', 'do Trampo', 'da Vizinhança', 'Sempre Junto', '2024'];
const EMOJI = ['', '', '', '🔥', '😎', '🎉', '💬', '⚽', '🍻'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function randomGroupName(prefix?: string): string {
  const base = `${pick(NAME_A)} ${pick(NAME_B)}`;
  const emoji = pick(EMOJI);
  return `${prefix ? prefix + ' ' : ''}${base}${emoji ? ' ' + emoji : ''}`.trim();
}

export const groupRoutes: FastifyPluginAsync = async (app) => {
  // List all groups for an account
  app.get<{ Params: { accountId: string } }>('/:accountId', async (request, reply) => {
    const { accountId } = request.params;
    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });

    try {
      const groups: Record<string, any> = await sock.groupFetchAllParticipating();
      const list = Object.values(groups).map((g: any) => ({
        jid: g.id,
        subject: g.subject,
        owner: g.owner,
        desc: g.desc || '',
        participantCount: g.participants?.length || 0,
        creation: g.creation,
        myRole: g.participants?.find(
          (p: any) => p.id === sock.user?.id || p.id?.replace(/:.*@/, '@') === sock.user?.id?.replace(/:.*@/, '@')
        )?.admin || 'member',
      }));
      return { groups: list, total: list.length };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to fetch groups', detail: err.message });
    }
  });

  // Get single group metadata
  app.get<{ Params: { accountId: string; groupJid: string } }>('/:accountId/:groupJid', async (request, reply) => {
    const { accountId, groupJid } = request.params;
    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });

    try {
      const meta = await sock.groupMetadata(groupJid);
      return {
        jid: meta.id,
        subject: meta.subject,
        owner: meta.owner,
        desc: meta.desc || '',
        participants: meta.participants?.map((p: any) => ({
          jid: p.id,
          admin: p.admin || null,
        })) || [],
        creation: meta.creation,
      };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to fetch group metadata', detail: err.message });
    }
  });

  // Send message to group
  app.post<{
    Params: { accountId: string };
    Body: { groupJid: string; content: string; messageType?: string };
  }>('/:accountId/send', async (request, reply) => {
    const { accountId } = request.params;
    const { groupJid, content, messageType = 'text' } = request.body;
    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });
    if (!groupJid || !content) return reply.code(400).send({ error: 'groupJid and content required' });

    try {
      // Typing simulation
      await sock.sendPresenceUpdate('composing', groupJid);
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
      await sock.sendPresenceUpdate('paused', groupJid);

      let msg: any;
      if (messageType === 'text') {
        msg = await sock.sendMessage(groupJid, { text: content });
      } else if (messageType === 'image') {
        msg = await sock.sendMessage(groupJid, { image: { url: content }, caption: '' });
      } else {
        msg = await sock.sendMessage(groupJid, { text: content });
      }

      return { status: 'sent', messageId: msg?.key?.id };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to send message', detail: err.message });
    }
  });

  // Create group
  app.post<{
    Params: { accountId: string };
    Body: { name: string; participants: string[] };
  }>('/:accountId/create', async (request, reply) => {
    const { accountId } = request.params;
    const { name, participants } = request.body;
    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });
    if (!name || !participants || participants.length === 0) {
      return reply.code(400).send({ error: 'name and participants required' });
    }

    try {
      // Normalize JIDs
      const jids = participants.map(p => {
        const clean = p.replace(/\D/g, '');
        return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
      });
      const result = await sock.groupCreate(name, jids);
      return { status: 'created', group: { jid: result.id, subject: result.subject } };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to create group', detail: err.message });
    }
  });

  // Join group via invite code
  app.post<{
    Params: { accountId: string };
    Body: { code: string };
  }>('/:accountId/join', async (request, reply) => {
    const { accountId } = request.params;
    const { code } = request.body;
    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });
    if (!code) return reply.code(400).send({ error: 'invite code required' });

    try {
      // Extract code from full URL if provided
      const inviteCode = code.includes('chat.whatsapp.com/')
        ? code.split('chat.whatsapp.com/').pop()!.trim()
        : code.trim();
      const groupJid = await sock.groupAcceptInvite(inviteCode);
      return { status: 'joined', groupJid };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to join group', detail: err.message });
    }
  });

  // Leave group
  app.post<{
    Params: { accountId: string };
    Body: { groupJid: string };
  }>('/:accountId/leave', async (request, reply) => {
    const { accountId } = request.params;
    const { groupJid } = request.body;
    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(accountId);
    if (!sock) return reply.code(400).send({ error: 'Account not connected' });
    if (!groupJid) return reply.code(400).send({ error: 'groupJid required' });

    try {
      await sock.groupLeave(groupJid);
      return { status: 'left', groupJid };
    } catch (err: any) {
      return reply.code(500).send({ error: 'Failed to leave group', detail: err.message });
    }
  });

  // Get invite link for a group
  app.get<{ Params: { accountId: string; groupJid: string } }>(
    '/:accountId/:groupJid/invite',
    async (request, reply) => {
      const { accountId, groupJid } = request.params;
      const deps = (app as any).deps;
      const sock = deps.sessionManager.getSocket(accountId);
      if (!sock) return reply.code(400).send({ error: 'Account not connected' });

      try {
        const code = await sock.groupInviteCode(groupJid);
        return { code, link: `https://chat.whatsapp.com/${code}` };
      } catch (err: any) {
        return reply.code(500).send({ error: 'Failed to get invite link', detail: err.message });
      }
    }
  );

  // ── POST /api/groups/generate ──
  // Auto-create N groups among the CONNECTED accounts, randomizing the group
  // name, the creator, the number of members and which accounts join each.
  // Runs in the background with anti-ban delays between creations.
  app.post<{
    Body: { count?: number; minMembers?: number; maxMembers?: number; namePrefix?: string };
  }>('/generate', async (request, reply) => {
    const deps = (app as any).deps;
    const sm = deps.sessionManager;
    const db = getDb();

    const socketIds: string[] = sm?.getSocketIds?.() ?? [];
    const accounts = await db.account.findMany({
      where: { id: { in: socketIds }, status: 'CONNECTED', ownerId: ownerId(request) },
      select: { id: true, phoneNumber: true },
    });
    const usable = accounts.filter((a) => sm.getSocket(a.id));

    if (usable.length < 2) {
      return reply.code(400).send({ error: 'É preciso pelo menos 2 contas conectadas para gerar grupos.' });
    }

    const count = clamp(Math.round(request.body.count ?? 1), 1, 20);
    const minMembers = clamp(Math.round(request.body.minMembers ?? 1), 1, usable.length - 1);
    const maxMembers = clamp(Math.round(request.body.maxMembers ?? Math.min(usable.length - 1, 4)), minMembers, usable.length - 1);
    const namePrefix = (request.body.namePrefix || '').trim() || undefined;

    // Respond immediately; create in the background.
    reply.send({
      status: 'generating',
      planned: count,
      connected: usable.length,
      message: `Gerando ${count} grupo(s) com ${minMembers}–${maxMembers} membros. Veja em "Grupos ao vivo" em instantes.`,
    });

    (async () => {
      for (let i = 0; i < count; i++) {
        const creator = pick(usable);
        const others = usable.filter((a) => a.id !== creator.id);
        const memberCount = clamp(randInt(minMembers, maxMembers), 1, others.length);
        const members = shuffle(others).slice(0, memberCount);
        const jids = members.map((m) => `${m.phoneNumber}@s.whatsapp.net`);
        const name = randomGroupName(namePrefix);
        const sock = sm.getSocket(creator.id);
        if (!sock) continue;

        try {
          const res = await sock.groupCreate(name, jids);
          await db.account.update({
            where: { id: creator.id },
            data: { lastActiveAt: new Date() },
          }).catch(() => {});
          logger.info({ creatorId: creator.id, name, members: jids.length, groupJid: res?.id }, 'Group generated');
        } catch (err: any) {
          logger.error({ creatorId: creator.id, name, err: err.message }, 'Failed to generate group');
        }

        // Anti-ban delay between group creations (20–45s)
        if (i < count - 1) {
          await new Promise((r) => setTimeout(r, 20000 + Math.random() * 25000));
        }
      }
      logger.info({ count }, 'Group generation batch finished');
    })().catch((err) => logger.error({ err: err.message }, 'Group generation batch failed'));
  });
};
