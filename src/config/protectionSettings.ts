import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('protection-settings');
const FILE = join(process.cwd(), 'data', 'protection-settings.json');

/**
 * Operator-tunable anti-ban protection flags, changeable live from the dashboard.
 */
export interface ProtectionSettings {
  /**
   * Treat an unexpected WhatsApp logout (401) as a probable BAN: mark the number
   * as banned, pause it, and fire a BAN_DETECTED alert. A 401 can also be a manual
   * unlink, but on a warming fleet it is almost always a ban — surfacing it loudly
   * is more useful than silently showing "disconnected".
   */
  banOnLogout: boolean;
  /**
   * Automatically pause a number when its ban risk reaches CRITICAL (high block
   * rate / low reply rate). When off, CRITICAL only blocks sends + alerts; you
   * stay in control of pausing.
   */
  autoPauseOnCritical: boolean;
  /**
   * When someone NOT in the warmup pool (a real person / business) messages a
   * chip, save them as a contact in WhatsApp (addOrEditContact). A real person
   * saves the people who message them — having saved contacts on both sides is a
   * trust signal. Deduped + paced so it isn't a burst.
   */
  autoSaveInboundContacts: boolean;
  /**
   * Auto-reject incoming calls on the warming numbers. Letting calls ring and
   * pile up as missed looks odd on a fresh number, so by default we reject every
   * incoming offer immediately. Turn off to let calls ring (e.g. if a number is
   * also used by a real person).
   */
  rejectCalls: boolean;
}

const DEFAULTS: ProtectionSettings = {
  banOnLogout: true,
  autoPauseOnCritical: false,
  autoSaveInboundContacts: true,
  rejectCalls: true,
};

let cache: ProtectionSettings = { ...DEFAULTS };

function sanitize(s: Partial<ProtectionSettings>): ProtectionSettings {
  return {
    banOnLogout: typeof s.banOnLogout === 'boolean' ? s.banOnLogout : DEFAULTS.banOnLogout,
    autoPauseOnCritical: typeof s.autoPauseOnCritical === 'boolean' ? s.autoPauseOnCritical : DEFAULTS.autoPauseOnCritical,
    autoSaveInboundContacts: typeof s.autoSaveInboundContacts === 'boolean' ? s.autoSaveInboundContacts : DEFAULTS.autoSaveInboundContacts,
    rejectCalls: typeof s.rejectCalls === 'boolean' ? s.rejectCalls : DEFAULTS.rejectCalls,
  };
}

/** Load persisted flags into the in-memory cache (call on boot). */
export async function loadProtectionSettings(): Promise<void> {
  try {
    const raw = await readFile(FILE, 'utf8');
    cache = sanitize({ ...DEFAULTS, ...JSON.parse(raw) });
    logger.info(cache, 'Protection settings loaded');
  } catch {
    cache = { ...DEFAULTS };
  }
}

/** Current protection flags — read live at each decision point. */
export function getProtectionSettings(): ProtectionSettings {
  return cache;
}

/** Update + persist protection flags. Returns the effective values. */
export async function setProtectionSettings(partial: Partial<ProtectionSettings>): Promise<ProtectionSettings> {
  cache = sanitize({ ...cache, ...partial });
  try {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(cache, null, 2), 'utf8');
    logger.info(cache, 'Protection settings updated');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to persist protection settings');
  }
  return cache;
}
