import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { AuthService, type JwtPayload } from '../../services/AuthService.js';
import { getDb } from '../../database/client.js';

const authService = new AuthService();

/**
 * Ensure the caller is an authenticated ADMIN. The global auth middleware skips
 * all /api/auth/* routes, so admin-only endpoints enforce it here. Returns the
 * caller payload, or null after already sending the error response.
 */
function requireAdmin(request: FastifyRequest, reply: FastifyReply): JwtPayload | null {
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    reply.code(401).send({ error: 'Autenticacao necessaria' });
    return null;
  }
  try {
    const caller = authService.verifyToken(token);
    if (caller.role !== 'ADMIN') {
      reply.code(403).send({ error: 'Apenas administradores podem gerenciar usuarios' });
      return null;
    }
    return caller;
  } catch {
    reply.code(401).send({ error: 'Token invalido ou expirado' });
    return null;
  }
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { email: string; password: string; name: string; role?: 'ADMIN' | 'USER' } }>('/register', async (request, reply) => {
    // Only an authenticated ADMIN can create new users.
    if (!requireAdmin(request, reply)) return;

    const { email, password, name, role } = request.body;

    if (!email || !password || !name) {
      return reply.code(400).send({ error: 'email, password e name sao obrigatorios' });
    }

    try {
      const result = await authService.register({ email, password, name });
      // Optionally promote the new user to ADMIN (default is USER).
      if (role === 'ADMIN') {
        await getDb().user.update({ where: { id: result.user.id }, data: { role: 'ADMIN' } });
        result.user.role = 'ADMIN';
      }
      // Return only the created user — the admin's own session is unaffected.
      return { user: result.user };
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
      const db = getDb();
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

  // ── Admin: user management ─────────────────────────────────────────────────

  // List all users (admin-only).
  app.get('/users', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const db = getDb();
    const users = await db.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    // Attach how many chips each operator owns (helps decide before deleting).
    const counts = await db.account.groupBy({ by: ['ownerId'], _count: { _all: true } });
    const countMap = new Map(counts.map((c) => [c.ownerId, c._count._all]));
    return users.map((u) => ({ ...u, accountCount: countMap.get(u.id) ?? 0 }));
  });

  // Update a user (admin-only): reset password and/or toggle active.
  app.patch<{ Params: { id: string }; Body: { password?: string; isActive?: boolean } }>('/users/:id', async (request, reply) => {
    const caller = requireAdmin(request, reply);
    if (!caller) return;
    const { id } = request.params;
    const { password, isActive } = request.body ?? {};
    const db = getDb();

    const target = await db.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'Usuario nao encontrado' });

    const data: { passwordHash?: string; isActive?: boolean } = {};
    if (typeof password === 'string') {
      if (password.length < 8) return reply.code(400).send({ error: 'Senha deve ter no minimo 8 caracteres' });
      const bcrypt = (await import('bcrypt')).default;
      data.passwordHash = await bcrypt.hash(password, 12);
    }
    if (typeof isActive === 'boolean') {
      // Don't let an admin deactivate their own account (lock-out guard).
      if (id === caller.userId && isActive === false) {
        return reply.code(400).send({ error: 'Voce nao pode desativar a si mesmo' });
      }
      data.isActive = isActive;
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'Nada para atualizar' });

    const updated = await db.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    return { user: updated };
  });

  // Delete a user (admin-only). Guards: not self, not the last admin.
  app.delete<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const caller = requireAdmin(request, reply);
    if (!caller) return;
    const { id } = request.params;
    const db = getDb();

    if (id === caller.userId) {
      return reply.code(400).send({ error: 'Voce nao pode remover a si mesmo' });
    }
    const target = await db.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'Usuario nao encontrado' });

    if (target.role === 'ADMIN') {
      const admins = await db.user.count({ where: { role: 'ADMIN' } });
      if (admins <= 1) return reply.code(400).send({ error: 'Nao e possivel remover o unico administrador' });
    }

    await db.user.delete({ where: { id } });
    // Note: chips owned by this user keep their ownerId (no FK); they still warm
    // in the global pool but become unmanaged. Reassign them if needed.
    return { ok: true };
  });
};
