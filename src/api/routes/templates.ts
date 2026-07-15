import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { previewSpintax } from '../../core/messaging/SpintaxParser.js';

export const templateRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  app.get('/', async () => {
    return db.conversationTemplate.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  });

  app.post<{ Body: { name: string; category: string; messages: any[] } }>(
    '/',
    async (request) => {
      const { name, category, messages } = request.body;
      return db.conversationTemplate.create({
        data: { name, category, messages },
      });
    }
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; category?: string; messages?: any[]; isActive?: boolean } }>(
    '/:id',
    async (request) => {
      return db.conversationTemplate.update({
        where: { id: request.params.id },
        data: request.body,
      });
    }
  );

  app.delete<{ Params: { id: string } }>('/:id', async (request) => {
    await db.conversationTemplate.delete({ where: { id: request.params.id } });
    return { success: true };
  });

  app.post<{ Body: { text: string; count?: number } }>('/preview-spintax', async (request) => {
    const { text, count = 5 } = request.body;
    return { variations: previewSpintax(text, count) };
  });
};
