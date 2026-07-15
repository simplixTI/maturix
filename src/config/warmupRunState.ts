import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('warmup-run-state');
const FILE = join(process.cwd(), 'data', 'warmup-run-state.json');

let running = false;

/**
 * Load the persisted "is warming running" flag (call on boot). The warmup engine
 * and conversation service are NOT auto-started by the process — they're toggled
 * from the dashboard. Without persistence, every restart/deploy silently stopped
 * warming. This flag lets the boot sequence resume warming if it was on before.
 */
export async function loadWarmupRunState(): Promise<boolean> {
  try {
    const raw = await readFile(FILE, 'utf8');
    running = !!JSON.parse(raw).running;
  } catch {
    running = false;
  }
  return running;
}

export function isWarmupRunning(): boolean {
  return running;
}

/** Persist the running flag so a restart can resume the same state. */
export async function setWarmupRunning(value: boolean): Promise<void> {
  running = value;
  try {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify({ running: value }, null, 2), 'utf8');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to persist warmup run state');
  }
}
