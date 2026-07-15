/**
 * Tiny in-memory cache of the most recent inbound message between two pool
 * accounts, keyed by (receiverAccountId, senderAccountId). It lets a chip quote
 * the message it is replying to — a very human touch that template-only chats
 * lack. Entries expire so stale messages are never quoted.
 */
interface Entry {
  msg: any;
  at: number;
}

const store = new Map<string, Entry>();
const TTL_MS = 10 * 60 * 1000;

function key(accountId: string, partnerAccountId: string): string {
  return `${accountId}:${partnerAccountId}`;
}

/** Remember the last message `accountId` received from `partnerAccountId`. */
export function rememberInbound(accountId: string, partnerAccountId: string, msg: any): void {
  store.set(key(accountId, partnerAccountId), { msg, at: Date.now() });
}

/** Get the last inbound message from a partner, or null if missing/expired. */
export function peekInbound(accountId: string, partnerAccountId: string): any | null {
  const k = key(accountId, partnerAccountId);
  const e = store.get(k);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    store.delete(k);
    return null;
  }
  return e.msg;
}
