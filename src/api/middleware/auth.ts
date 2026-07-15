import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../../services/AuthService.js';

const authService = new AuthService();

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Skip auth for auth routes
  if (request.url.startsWith('/api/auth/')) return;

  // Check API key first (for programmatic access)
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const key = request.headers['x-api-key'] as string;
    if (key === apiKey) return;
  }

  // Check JWT token
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return reply.code(401).send({ error: 'Autenticacao necessaria' });
  }

  try {
    const payload = authService.verifyToken(token);
    (request as any).user = payload;
  } catch {
    return reply.code(401).send({ error: 'Token invalido ou expirado' });
  }
}
