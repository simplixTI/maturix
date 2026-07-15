import type { FastifyRequest } from 'fastify';
import { getDb } from '../database/client.js';

/**
 * Multi-tenant scoping helpers. Every operator (User) sees ONLY their own chips
 * and the data derived from them. The owner is the logged-in user's id, set on
 * the request by the auth middleware.
 */

/** The logged-in operator's id. Empty string if somehow unauthenticated. */
export function ownerId(request: FastifyRequest): string {
  const u = (request as any).user;
  return (u?.userId as string) ?? '';
}

/**
 * Account ids owned by this operator — used to scope account-derived data
 * (messages, conversations, alerts, calls, metrics) to the operator's numbers.
 * Returns [] for an unknown owner so a bad/missing token sees nothing.
 */
export async function ownedAccountIds(owner: string): Promise<string[]> {
  if (!owner) return [];
  const rows = await getDb().account.findMany({
    where: { ownerId: owner },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
