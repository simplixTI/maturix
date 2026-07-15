import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDb } from '../database/client.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('auth-service');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_ENCRYPTION_KEY || 'change-me';
const JWT_EXPIRES_IN = '7d';
const SALT_ROUNDS = 12;

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export class AuthService {
  async register(data: { email: string; password: string; name: string }): Promise<{ user: { id: string; email: string; name: string; role: string }; token: string }> {
    const db = getDb();

    const existing = await db.user.findUnique({ where: { email: data.email } });
    if (existing) throw new Error('Email ja cadastrado');

    if (data.password.length < 8) throw new Error('Senha deve ter no minimo 8 caracteres');

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    const user = await db.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        passwordHash,
        name: data.name.trim(),
      },
    });

    const token = this.generateToken(user);
    logger.info({ userId: user.id, email: user.email }, 'User registered');

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    };
  }

  async login(email: string, password: string): Promise<{ user: { id: string; email: string; name: string; role: string }; token: string }> {
    const db = getDb();

    const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) throw new Error('Credenciais invalidas');
    if (!user.isActive) throw new Error('Conta desativada');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('Credenciais invalidas');

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = this.generateToken(user);
    logger.info({ userId: user.id }, 'User logged in');

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    };
  }

  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  }

  private generateToken(user: { id: string; email: string; role: string }): string {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role } as JwtPayload,
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  }

  async seedAdmin(): Promise<void> {
    const db = getDb();
    // Primary admin is configured via env so credentials are never hardcoded in
    // the repo. Falls back to the historical default only if the vars are unset.
    const email = (process.env.ADMIN_EMAIL || 'admin@braske.com').toLowerCase().trim();
    const password = process.env.ADMIN_PASSWORD || 'braske2026';
    const name = process.env.ADMIN_NAME || 'Admin';

    const exists = await db.user.findUnique({ where: { email } });
    if (exists) return;

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.user.create({
      data: { email, passwordHash, name, role: 'ADMIN' },
    });
    logger.info({ email }, 'Admin user seeded');
  }
}
