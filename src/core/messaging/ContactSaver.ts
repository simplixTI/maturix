import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { WASocket } from '@whiskeysockets/baileys';
import { getDb } from '../../database/client.js';
import { gaussianClamp, sleep } from '../../utils/gaussian.js';
import { plannedName } from './ProfileMaturation.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('contact-saver');

// Persisted dedup of inbound numbers we've already saved, per receiver account,
// so we don't re-save (and re-presence-subscribe) the same person on every
// message. accountId -> list of saved phone numbers.
const SAVED_FILE = join(process.cwd(), 'data', 'saved-inbound-contacts.json');
let savedCache: Record<string, string[]> | null = null;

async function loadSaved(): Promise<Record<string, string[]>> {
  if (savedCache) return savedCache;
  try {
    savedCache = JSON.parse(await readFile(SAVED_FILE, 'utf8'));
  } catch {
    savedCache = {};
  }
  return savedCache!;
}

async function markSaved(accountId: string, phone: string): Promise<void> {
  const c = await loadSaved();
  (c[accountId] ??= []).push(phone);
  try {
    await mkdir(dirname(SAVED_FILE), { recursive: true });
    await writeFile(SAVED_FILE, JSON.stringify(c), 'utf8');
  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to persist saved-contacts');
  }
}

/**
 * Auto-save an EXTERNAL contact that messaged one of our chips (a real person /
 * business — NOT another pool chip). Verifies the number, behaves human-like
 * (presence subscribe + delays), then saves it in WhatsApp via addOrEditContact.
 * Deduped + persisted so each number is saved at most once per chip. Fire-and-
 * forget from the inbound handler; never throws.
 */
export async function saveInboundContact(
  sock: WASocket,
  receiverAccountId: string,
  senderPhone: string,
  pushName?: string,
): Promise<void> {
  try {
    const saved = await loadSaved();
    if ((saved[receiverAccountId] ?? []).includes(senderPhone)) return; // already saved

    const jid = `${senderPhone}@s.whatsapp.net`;

    // Pace like a human opening the chat before saving the contact.
    await sleep(gaussianClamp(2500, 800, 1200, 6000));

    const results = await sock.onWhatsApp(senderPhone);
    if (!results?.[0]?.exists) return;

    try { await sock.presenceSubscribe(jid); } catch { /* best effort */ }
    await sleep(gaussianClamp(1500, 500, 800, 3000));

    // Prefer the sender's own WhatsApp display name; fall back to "DDD ####".
    const clean = (pushName ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const name = clean || `${senderPhone.slice(2, 4)} ${senderPhone.slice(-4)}`;

    await sock.addOrEditContact(jid, {
      fullName: name,
      firstName: name.split(' ')[0],
      saveOnPrimaryAddressbook: true,
    });
    await markSaved(receiverAccountId, senderPhone);
    logger.info({ receiverAccountId, senderPhone, name }, 'Inbound contact SAVED in WhatsApp');
  } catch (err: unknown) {
    logger.warn(
      { receiverAccountId, senderPhone, err: err instanceof Error ? err.message : String(err) },
      'Inbound contact save failed',
    );
  }
}

/**
 * Saves a contact IN WhatsApp using addOrEditContact (app state sync).
 * This is the "Salvar no WhatsApp" feature - the contact appears
 * in WhatsApp's contact list without needing phone address book sync.
 *
 * Flow:
 * 1. Check if number exists on WhatsApp (onWhatsApp)
 * 2. Subscribe to presence (like opening the chat)
 * 3. View profile picture + status (human behavior)
 * 4. sock.addOrEditContact() - ACTUALLY saves in WhatsApp
 * 5. Mark in DB so we don't save again
 */
export async function saveContactBeforeChat(
  sock: WASocket,
  senderAccountId: string,
  recipientJid: string,
): Promise<{ exists: boolean; saved: boolean }> {
  const phone = recipientJid.replace('@s.whatsapp.net', '');
  const db = getDb();

  const receiverAccount = await db.account.findUnique({
    where: { phoneNumber: phone },
  });
  if (!receiverAccount) {
    return { exists: true, saved: false };
  }

  const relation = await db.contactRelation.findUnique({
    where: {
      accountId_contactId: {
        accountId: senderAccountId,
        contactId: receiverAccount.id,
      },
    },
  });

  // Already saved
  if (relation?.firstContactAt) {
    return { exists: true, saved: false };
  }

  try {
    // 1. Verify number exists on WhatsApp
    const results = await sock.onWhatsApp(phone);
    const result = results?.[0];
    if (!result?.exists) {
      logger.info({ senderAccountId, phone }, 'Number not on WhatsApp');
      return { exists: false, saved: false };
    }

    await sleep(gaussianClamp(1500, 500, 800, 3000));

    // 2. Subscribe to presence
    try {
      await sock.presenceSubscribe(recipientJid);
    } catch {}

    await sleep(gaussianClamp(1000, 400, 500, 2000));

    // 3. Build contact name — use the chip's realistic profile name (the SAME
    // name it sets as its WhatsApp display name) so saved contacts look real
    // ("João R."), not an internal label like "chip2". Falls back to "DDD ####".
    const contactName = plannedName(receiverAccount.id) || `${phone.slice(2, 4)} ${phone.slice(-4)}`;

    // 4. SAVE CONTACT IN WHATSAPP. saveOnPrimaryAddressbook:true propagates the
    // contact to the device address book so it actually shows as a saved contact
    // (with the name), instead of staying an invisible WhatsApp-only entry.
    try {
      await sock.addOrEditContact(recipientJid, {
        fullName: contactName,
        firstName: contactName.split(' ')[0],
        saveOnPrimaryAddressbook: true,
      });
      logger.info({ senderAccountId, phone, contactName }, 'Contact SAVED in WhatsApp (addOrEditContact)');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ senderAccountId, phone, err: msg }, 'addOrEditContact failed, continuing without save');
    }

    // 5. Mark in DB
    await db.contactRelation.upsert({
      where: {
        accountId_contactId: {
          accountId: senderAccountId,
          contactId: receiverAccount.id,
        },
      },
      create: {
        accountId: senderAccountId,
        contactId: receiverAccount.id,
        firstContactAt: new Date(),
      },
      update: {
        firstContactAt: new Date(),
      },
    });

    return { exists: true, saved: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ senderAccountId, phone, err: msg }, 'Contact save flow failed');
    return { exists: true, saved: false };
  }
}
