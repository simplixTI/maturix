import { createChildLogger } from '../../utils/logger.js';
import { persistJob, removeJob, updateJobForRetry, loadAllJobs } from './JobStore.js';

const logger = createChildLogger('queue-manager');

export interface Job<T = any> {
  id: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  delay: number;
  createdAt: number;
  /** DB row id when the job is persisted (durable queues only). */
  persistId?: string;
}

export interface SimpleQueue {
  add(name: string, data: any, opts?: { delay?: number; repeat?: { every: number } }): Promise<Job>;
  getWaitingCount(): Promise<number>;
  getActiveCount(): Promise<number>;
  getDelayedCount(): Promise<number>;
  getFailedCount(): Promise<number>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  drain(): Promise<void>;
  close(): Promise<void>;
}

export class QueueManager {
  private queues = new Map<string, InMemoryQueue>();
  private workers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  createQueue(name: string, opts?: { durable?: boolean }): SimpleQueue {
    const queue = new InMemoryQueue(name, opts?.durable ?? false);
    this.queues.set(name, queue);
    logger.info({ queue: name, durable: opts?.durable ?? false }, 'Queue created');
    return queue;
  }

  /**
   * Restore persisted jobs into their in-memory queues after a restart. Call once
   * on boot, after the durable queues have been created.
   */
  async restoreJobs(): Promise<void> {
    const jobs = await loadAllJobs();
    let restored = 0;
    for (const row of jobs) {
      const queue = this.queues.get(row.queue);
      if (!queue) continue; // queue no longer exists — leave the row for later
      queue.enqueueRestored({
        id: `${row.queue}-restored-${row.id.slice(0, 8)}`,
        data: row.data,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        delay: 0,
        createdAt: new Date(row.runAt).getTime(),
        persistId: row.id,
      });
      restored++;
    }
    if (restored > 0) logger.info({ restored }, 'Restored persisted jobs after restart');
  }

  createWorker(
    name: string,
    processor: (job: Job) => Promise<any>,
    concurrency: number = 5
  ): void {
    const queue = this.queues.get(name);
    if (!queue) {
      logger.warn({ queue: name }, 'Queue not found for worker');
      return;
    }

    let activeCount = 0;

    const tick = async () => {
      if (this.stopped || queue.isPaused) return;

      while (activeCount < concurrency) {
        const job = queue.dequeue();
        if (!job) break;

        activeCount++;
        processor(job)
          .then(() => {
            queue.completed++;
            removeJob(job.persistId); // durable: drop the persisted row on success
            logger.debug({ queue: name, jobId: job.id }, 'Job completed');
          })
          .catch((err) => {
            queue.failed++;
            job.attempts++;
            if (job.attempts < job.maxAttempts) {
              job.delay = Math.min(30000 * Math.pow(2, job.attempts), 300000);
              job.createdAt = Date.now();
              queue.enqueue(job);
              updateJobForRetry(job.persistId, job.createdAt + job.delay, job.attempts);
            } else {
              removeJob(job.persistId); // exhausted retries → stop persisting it
            }
            logger.error({ queue: name, jobId: job.id, err: err?.message }, 'Job failed');
          })
          .finally(() => { activeCount--; });
      }
    };

    const interval = setInterval(tick, 500);
    this.workers.set(name, interval);
  }

  getQueue(name: string): SimpleQueue | undefined {
    return this.queues.get(name);
  }

  async closeAll(): Promise<void> {
    this.stopped = true;
    for (const [_name, interval] of this.workers) {
      clearInterval(interval);
    }
    this.workers.clear();
    this.queues.clear();
  }
}

let jobCounter = 0;

class InMemoryQueue implements SimpleQueue {
  name: string;
  private durable: boolean;
  private jobs: Job[] = [];
  private repeats: NodeJS.Timeout[] = [];
  isPaused = false;
  completed = 0;
  failed = 0;

  constructor(name: string, durable = false) {
    this.name = name;
    this.durable = durable;
  }

  async add(name: string, data: any, opts?: { delay?: number; repeat?: { every: number } }): Promise<Job> {
    const job: Job = {
      id: `${this.name}-${++jobCounter}`,
      data,
      attempts: 0,
      maxAttempts: 3,
      delay: opts?.delay ?? 0,
      createdAt: Date.now(),
    };

    // Persist BEFORE making the job runnable, so it can't be processed (and the
    // row deleted) before its persistId exists. Repeat jobs are recreated on boot,
    // so they're never persisted.
    if (this.durable && !opts?.repeat) {
      job.persistId = await persistJob(this.name, name, data, job.createdAt + job.delay, 0, job.maxAttempts);
    }

    this.jobs.push(job);

    if (opts?.repeat) {
      const interval = setInterval(() => {
        if (!this.isPaused) {
          this.add(name, data);
        }
      }, opts.repeat.every);
      this.repeats.push(interval);
    }

    return job;
  }

  /** Re-insert a job loaded from persistence on boot (already has persistId). */
  enqueueRestored(job: Job): void {
    this.jobs.push(job);
  }

  dequeue(): Job | undefined {
    const now = Date.now();
    const idx = this.jobs.findIndex(j => (j.createdAt + j.delay) <= now);
    if (idx === -1) return undefined;
    return this.jobs.splice(idx, 1)[0];
  }

  enqueue(job: Job): void {
    this.jobs.push(job);
  }

  async getWaitingCount(): Promise<number> { return this.jobs.filter(j => (j.createdAt + j.delay) <= Date.now()).length; }
  async getActiveCount(): Promise<number> { return 0; }
  async getDelayedCount(): Promise<number> { return this.jobs.filter(j => (j.createdAt + j.delay) > Date.now()).length; }
  async getFailedCount(): Promise<number> { return this.failed; }

  async pause(): Promise<void> { this.isPaused = true; }
  async resume(): Promise<void> { this.isPaused = false; }
  async drain(): Promise<void> { this.jobs = []; }
  async close(): Promise<void> {
    this.repeats.forEach(clearInterval);
    this.repeats = [];
    this.jobs = [];
  }
}
