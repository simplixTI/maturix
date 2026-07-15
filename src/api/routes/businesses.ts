import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import {
  getAllBusinesses,
  addBusiness,
  addManyBusinesses,
  updateBusiness,
  removeBusiness,
} from '../../config/businessStore.js';
import { validateAllBusinesses } from '../../core/messaging/BusinessContacts.js';

/** Parse pasted text (one per line, any of: "Nome 5511...", "5511..., Nome", "5511..."). */
function parseBulkText(text: string): Array<{ phoneNumber: string; name?: string }> {
  const out: Array<{ phoneNumber: string; name?: string }> = [];
  for (const line of text.split(/[\r\n]+/)) {
    const digits = (line.match(/\d{10,15}/g) || [])[0];
    if (!digits) continue;
    const name = line.replace(/[\d()+\-.\s,;|]+/g, ' ').trim();
    out.push({ phoneNumber: digits, name: name || undefined });
  }
  return out;
}

/**
 * Manage the external business contacts the chips message for outside traffic.
 * The list is editable (add your own verified bots, disable/remove bad ones) and
 * can be validated against WhatsApp so only real WhatsApp numbers get messaged.
 */
export const businessRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    return getAllBusinesses();
  });

  app.post<{ Body: { name: string; phoneNumber: string; category?: string; description?: string } }>(
    '/',
    async (request, reply) => {
      const { name, phoneNumber } = request.body || ({} as any);
      if (!name || !phoneNumber) {
        return reply.code(400).send({ error: 'name e phoneNumber são obrigatórios' });
      }
      return addBusiness(request.body);
    },
  );

  // Bulk add: paste many numbers at once (text blob) or send an items array.
  app.post<{ Body: { text?: string; items?: Array<{ name?: string; phoneNumber: string; category?: string }> } }>(
    '/bulk',
    async (request, reply) => {
      let items = request.body?.items ?? [];
      if ((!items || items.length === 0) && request.body?.text) {
        items = parseBulkText(request.body.text);
      }
      if (!items.length) return reply.code(400).send({ error: 'Nenhum número válido encontrado' });
      return addManyBusinesses(items);
    },
  );

  app.patch<{ Params: { id: string }; Body: { active?: boolean; name?: string; category?: string } }>(
    '/:id',
    async (request, reply) => {
      const b = await updateBusiness(request.params.id, request.body || {});
      if (!b) return reply.code(404).send({ error: 'Empresa não encontrada' });
      return b;
    },
  );

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const ok = await removeBusiness(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Empresa não encontrada' });
    return { ok: true };
  });

  // Validate every number against WhatsApp using a connected chip's socket.
  // Runs in the background (it can take ~30s for a long list); the UI re-fetches
  // the list afterwards to show the updated WhatsApp status per business.
  app.post('/validate', async (_request, reply) => {
    const deps = (app as any).deps;
    const db = getDb();
    const acc = await db.account.findFirst({ where: { status: 'CONNECTED' }, select: { id: true } });
    const sock = acc ? deps.sessionManager?.getSocket(acc.id) : null;
    if (!sock) {
      return reply.code(409).send({ error: 'Nenhum número conectado para validar. Conecte um chip primeiro.' });
    }
    validateAllBusinesses(sock).catch(() => {});
    return { status: 'started' };
  });
};
