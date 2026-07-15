import type { FastifyPluginAsync } from 'fastify';
import { AuthService } from '../../services/AuthService.js';

const authService = new AuthService();

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { email: string; password: string; name: string } }>('/register', async (request, reply) => {
    const { email, password, name } = request.body;

    if (!email || !password || !name) {
      return reply.code(400).send({ error: 'email, password e name sao obrigatorios' });
    }

    try {
      const result = await authService.register({ email, password, name });
      return { user: result.user, token: result.token };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post<{ Body: { email: string; password: string } }>('/login', async (request, reply) => {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.code(400).send({ error: 'email e password sao obrigatorios' });
    }

    try {
      const result = await authService.login(email, password);
      return { user: result.user, token: result.token };
    } catch (err: any) {
      return reply.code(401).send({ error: err.message });
    }
  });

  app.get('/me', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'Token nao fornecido' });

    try {
      const payload = authService.verifyToken(token);
      const db = (await import('../../database/client.js')).getDb();
      const user = await db.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      });
      if (!user || !user.isActive) return reply.code(401).send({ error: 'Usuario invalido' });
      return user;
    } catch {
      return reply.code(401).send({ error: 'Token invalido' });
    }
  });
};
