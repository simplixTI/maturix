import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getDb } from './client.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('instance-lock');

const LOCK_ID = 'session-lock';
// If the holder hasn't heartbeat within this window it's considered dead and the
// lock can be taken over (e.g. the previous process crashed without releasing).
const STALE_MS = 30_000;
const HEARTBEAT_MS = 10_000;

const HOST = hostname();
/** This process's unique holder id: `${host}-${pid}-${rand}`. */
export const HOLDER = `${HOST}-${process.pid}-${randomUUID().slice(0, 8)}`;

let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Parse host + pid out of a holder id (rand is the last segment). */
function parseHolder(holder: string): { host: string; pid: number } | null {
  const parts = holder.split('-');
  if (parts.length < 3) return null;
  const pid = Number.parseInt(parts[parts.length - 2], 10);
  if (!Number.isFinite(pid)) return null;
  return { host: parts.slice(0, parts.length - 2).join('-'), pid };
}

/** Whether a local PID is still running. EPERM means it exists but isn't ours. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/** A stale holder is one that's dead (same-host PID gone) or heartbeat-expired. */
function holderIsDead(holder: string, heartbeatAt: Date): boolean {
  const parsed = parseHolder(holder);
  // Same machine: trust the OS — if the PID is gone, the lock is free immediately.
  if (parsed && parsed.host === HOST && !isProcessAlive(parsed.pid)) return true;
  // Otherwise fall back to heartbeat staleness (covers cross-host / hung process).
  return Date.now() - new Date(heartbeatAt).getTime() >= STALE_MS;
}

/**
 * Acquire the single-instance lock (heartbeat-based, pool-safe).
 *   - no row → create and own it
 *   - row exists but stale (holder dead) → take it over
 *   - row exists and fresh → another instance is alive → refuse to start
 *
 * On success, starts a heartbeat so the lock stays fresh while we run.
 */
export async function acquireInstanceLock(): Promise<boolean> {
  const db = getDb();
  // Retry a few times: a predecessor (e.g. a dev-watch restart) may still be
  // releasing the lock during its graceful shutdown. A genuinely concurrent rival
  // instance keeps heartbeating and is refused after the grace period.
  const MAX_TRIES = 6;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const now = new Date();
    try {
      const existing = await db.appLock.findUnique({ where: { id: LOCK_ID } });

      if (!existing) {
        await db.appLock.create({ data: { id: LOCK_ID, holder: HOLDER, bootAt: now, heartbeatAt: now } });
      } else if (existing.holder !== HOLDER && !holderIsDead(existing.holder, existing.heartbeatAt)) {
        // A genuinely live holder. A predecessor may still be releasing during a
        // dev-watch restart — retry briefly before giving up.
        const age = now.getTime() - new Date(existing.heartbeatAt).getTime();
        if (attempt < MAX_TRIES) {
          logger.warn({ holder: existing.holder, ageMs: age, attempt }, 'Lock held by a live instance — waiting…');
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        logger.error({ holder: existing.holder, ageMs: age }, 'Another backend instance is alive — refusing to start');
        return false;
      } else {
        // Free (dead holder / heartbeat-expired) or already ours → take ownership.
        await db.appLock.update({
          where: { id: LOCK_ID },
          data: { holder: HOLDER, bootAt: now, heartbeatAt: now },
        });
        if (existing.holder !== HOLDER) {
          logger.warn({ previous: existing.holder }, 'Took over a free/stale instance lock');
        }
      }

      startHeartbeat();
      logger.info({ holder: HOLDER }, 'Instance lock acquired (single-instance guard active)');
      return true;
    } catch (err: any) {
      // Fail open: if the lock table/DB misbehaves, don't block startup entirely.
      logger.warn({ err: err?.message }, 'Instance lock check failed — starting without single-instance guard');
      return true;
    }
  }
  return false;
}

function startHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(async () => {
    try {
      const db = getDb();
      // Only refresh if we still own it (don't clobber a legitimate takeover).
      await db.appLock.updateMany({
        where: { id: LOCK_ID, holder: HOLDER },
        data: { heartbeatAt: new Date() },
      });
    } catch {
      /* transient DB hiccup — next tick retries */
    }
  }, HEARTBEAT_MS);
  // Don't keep the event loop alive just for the heartbeat.
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
}

/** Release the lock on graceful shutdown (only if we still own it). */
export async function releaseInstanceLock(): Promise<void> {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  try {
    const db = getDb();
    await db.appLock.deleteMany({ where: { id: LOCK_ID, holder: HOLDER } });
  } catch {
    /* ignore */
  }
}
