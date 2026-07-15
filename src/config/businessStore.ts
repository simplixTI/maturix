import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createChildLogger } from '../utils/logger.js';
import { BUSINESS_CONTACTS } from '../core/messaging/BusinessContacts.js';

const logger = createChildLogger('business-store');
const FILE = join(process.cwd(), 'data', 'businesses.json');

export interface StoredBusiness {
  id: string; // = phoneNumber (natural key)
  name: string;
  phoneNumber: string;
  category: string;
  description: string;
  active: boolean;
  onWhatsapp: boolean | null; // null = not yet checked
  checkedAt: string | null;
}

let cache: StoredBusiness[] | null = null;

async function persist(): Promise<void> {
  try {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to persist businesses');
  }
}

/** Load the editable business list (seeds from the built-in list on first run). */
export async function loadBusinesses(): Promise<StoredBusiness[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    cache = BUSINESS_CONTACTS.map((b) => ({
      id: b.phoneNumber,
      name: b.name,
      phoneNumber: b.phoneNumber,
      category: b.category,
      description: b.description,
      active: true,
      onWhatsapp: null,
      checkedAt: null,
    }));
    await persist();
    logger.info({ count: cache.length }, 'Seeded businesses from built-in list');
  }
  return cache!;
}

export async function getAllBusinesses(): Promise<StoredBusiness[]> {
  return loadBusinesses();
}

/** Businesses eligible to message: active and not already known-invalid. */
export async function getMessageableBusinesses(): Promise<StoredBusiness[]> {
  return (await loadBusinesses()).filter((b) => b.active && b.onWhatsapp !== false);
}

export async function addBusiness(input: {
  name: string;
  phoneNumber: string;
  category?: string;
  description?: string;
}): Promise<StoredBusiness> {
  const list = await loadBusinesses();
  const phone = input.phoneNumber.replace(/\D/g, '');
  const existing = list.find((b) => b.phoneNumber === phone);
  if (existing) {
    existing.name = input.name || existing.name;
    existing.active = true;
    await persist();
    return existing;
  }
  const b: StoredBusiness = {
    id: phone,
    name: input.name,
    phoneNumber: phone,
    category: input.category || 'custom',
    description: input.description || '',
    active: true,
    onWhatsapp: null,
    checkedAt: null,
  };
  list.push(b);
  await persist();
  return b;
}

/** Add many businesses at once (dedup by number). Returns how many were new. */
export async function addManyBusinesses(
  items: Array<{ name?: string; phoneNumber: string; category?: string }>,
): Promise<{ added: number; skipped: number; total: number }> {
  const list = await loadBusinesses();
  const existing = new Set(list.map((b) => b.phoneNumber));
  let added = 0;
  let skipped = 0;
  for (const it of items) {
    const phone = (it.phoneNumber || '').replace(/\D/g, '');
    // Require a plausible BR/international length; skip junk lines.
    if (phone.length < 10 || phone.length > 15 || existing.has(phone)) { skipped++; continue; }
    existing.add(phone);
    list.push({
      id: phone,
      name: (it.name || '').trim() || `Empresa ${phone.slice(-4)}`,
      phoneNumber: phone,
      category: it.category || 'custom',
      description: '',
      active: true,
      onWhatsapp: null,
      checkedAt: null,
    });
    added++;
  }
  if (added > 0) await persist();
  return { added, skipped, total: list.length };
}

export async function updateBusiness(
  id: string,
  patch: Partial<Pick<StoredBusiness, 'active' | 'name' | 'category'>>,
): Promise<StoredBusiness | null> {
  const list = await loadBusinesses();
  const b = list.find((x) => x.id === id);
  if (!b) return null;
  if (patch.active !== undefined) b.active = patch.active;
  if (patch.name !== undefined) b.name = patch.name;
  if (patch.category !== undefined) b.category = patch.category;
  await persist();
  return b;
}

export async function removeBusiness(id: string): Promise<boolean> {
  const list = await loadBusinesses();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  await persist();
  return true;
}

/** Record an onWhatsApp verification result for a number. */
export async function setWhatsappStatus(phone: string, onWhatsapp: boolean, when: string): Promise<void> {
  const list = await loadBusinesses();
  const b = list.find((x) => x.phoneNumber === phone);
  if (b) {
    b.onWhatsapp = onWhatsapp;
    b.checkedAt = when;
    await persist();
  }
}
