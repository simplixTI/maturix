import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { ownerId } from '../ownerScope.js';

export const proxyRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  app.get('/', async (request) => {
    const proxies = await db.proxy.findMany({
      where: { ownerId: ownerId(request) },
      include: { _count: { select: { assignedAccounts: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return proxies;
  });

  app.post<{ Body: { host: string; port: number; username?: string; password?: string; protocol?: string; type?: string } }>(
    '/',
    async (request) => {
      const deps = (app as any).deps;
      const id = await deps.proxyManager.addProxy(request.body, ownerId(request));
      deps.proxyManager.checkProxyById(id).catch(() => {});
      return { id };
    }
  );

  app.post<{ Body: { lines: string[] } }>('/bulk-import', async (request) => {
    const deps = (app as any).deps;
    const imported = await deps.proxyManager.bulkImport(request.body.lines, ownerId(request));
    deps.proxyManager.checkAllProxies().catch(() => {});
    return { imported };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const proxy = await db.proxy.findFirst({ where: { id: request.params.id, ownerId: ownerId(request) } });
    if (!proxy) return reply.code(404).send({ error: 'Proxy não encontrado' });
    await db.proxy.delete({ where: { id: request.params.id } });
    return { success: true };
  });

  app.post('/check-all', async () => {
    const deps = (app as any).deps;
    await deps.proxyManager.checkAllProxies();
    return { status: 'checking' };
  });
};
