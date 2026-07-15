import { getDb } from '../../database/client.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('job-store');

/**
 * Persistence for the durable queue. Jobs are mirrored to the QueuedJob table so
 * scheduled work (e.g. conversation messages with multi-minute delays) survives a
 * process restart and is restored on boot. Only queues marked `durable` are
 * persisted; ephemeral/recreatable queues (health checks) are not.
 */

export async function persistJob(
  queue: string,
  name: string,
  data: any,
  runAtMs: number,
  attempts: number,
  maxAttempts: number,
): Promise<string | undefined> {
  try {
    const row = await getDb().queuedJob.create({
      data: { queue, name, data: data as any, runAt: new Date(runAtMs), attempts, maxAttempts },
    });
    return row.id;
  } catch (err: any) {
    logger.warn({ err: err?.message, queue }, 'Failed to persist job (continuing in-memory)');
    return undefined;
  }
}

export async function removeJob(id?: string): Promise<void> {
  if (!id) return;
  await getDb().queuedJob.delete({ where: { id } }).catch(() => {});
}

export async function updateJobForRetry(id: string | undefined, runAtMs: number, attempts: number): Promise<void> {
  if (!id) return;
  await getDb().queuedJob
    .update({ where: { id }, data: { runAt: new Date(runAtMs), attempts } })
    .catch(() => {});
}

export interface PersistedJob {
  id: string;
  queue: string;
  name: string;
  data: any;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
}

export async function loadAllJobs(): Promise<PersistedJob[]> {
  try {
    return (await getDb().queuedJob.findMany({ orderBy: { runAt: 'asc' } })) as unknown as PersistedJob[];
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'Failed to load persisted jobs');
    return [];
  }
}
