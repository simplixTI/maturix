import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('warmup-features');
const FILE = join(process.cwd(), 'data', 'warmup-features.json');

/**
 * Operator-tunable switches for WHICH warming activities the engine performs.
 * Project-wide (shared, like the warming pool) and changeable live from the
 * dashboard. All default ON = current behavior; turning one off makes the engine
 * stop scheduling / stop sending that activity across every chip.
 */
export interface WarmupFeatureSettings {
  /** Post status/stories on the warming numbers. */
  status: boolean;
  /** Send photos (images) in conversations and standalone. */
  photos: boolean;
  /** Send videos. */
  videos: boolean;
  /** Send voice notes (audio). */
  audios: boolean;
  /** Send stickers. */
  stickers: boolean;
  /** Message real WhatsApp Business numbers (outside traffic). */
  business: boolean;
  /** Set/mature the WhatsApp profile NAME on the chips. */
  profileName: boolean;
  /** Set/refresh the profile "about/recado" (bio) text. */
  profileBio: boolean;
  /** Set the profile photo. */
  profilePhoto: boolean;
}

const DEFAULTS: WarmupFeatureSettings = {
  status: true,
  photos: true,
  videos: true,
  audios: true,
  stickers: true,
  business: true,
  profileName: true,
  profileBio: true,
  profilePhoto: true,
};

let cache: WarmupFeatureSettings = { ...DEFAULTS };

function sanitize(s: Partial<WarmupFeatureSettings>): WarmupFeatureSettings {
  return {
    status: typeof s.status === 'boolean' ? s.status : DEFAULTS.status,
    photos: typeof s.photos === 'boolean' ? s.photos : DEFAULTS.photos,
    videos: typeof s.videos === 'boolean' ? s.videos : DEFAULTS.videos,
    audios: typeof s.audios === 'boolean' ? s.audios : DEFAULTS.audios,
    stickers: typeof s.stickers === 'boolean' ? s.stickers : DEFAULTS.stickers,
    business: typeof s.business === 'boolean' ? s.business : DEFAULTS.business,
    profileName: typeof s.profileName === 'boolean' ? s.profileName : DEFAULTS.profileName,
    profileBio: typeof s.profileBio === 'boolean' ? s.profileBio : DEFAULTS.profileBio,
    profilePhoto: typeof s.profilePhoto === 'boolean' ? s.profilePhoto : DEFAULTS.profilePhoto,
  };
}

/** Load persisted feature switches into memory (call on boot). */
export async function loadWarmupFeatures(): Promise<void> {
  try {
    const raw = await readFile(FILE, 'utf8');
    cache = sanitize({ ...DEFAULTS, ...JSON.parse(raw) });
    logger.info(cache, 'Warmup features loaded');
  } catch {
    cache = { ...DEFAULTS };
  }
}

/** Current feature switches — read live at each decision point. */
export function getWarmupFeatures(): WarmupFeatureSettings {
  return cache;
}

/** Update + persist feature switches. Returns the effective values. */
export async function setWarmupFeatures(partial: Partial<WarmupFeatureSettings>): Promise<WarmupFeatureSettings> {
  cache = sanitize({ ...cache, ...partial });
  try {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(cache, null, 2), 'utf8');
    logger.info(cache, 'Warmup features updated');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to persist warmup features');
  }
  return cache;
}

/** True if a media message type is currently allowed by the operator's switches. */
export function isMediaTypeEnabled(type: string): boolean {
  switch (type) {
    case 'image': return cache.photos;
    case 'video': return cache.videos;
    case 'audio': return cache.audios;
    case 'sticker': return cache.stickers;
    default: return true; // text/reaction always allowed
  }
}
