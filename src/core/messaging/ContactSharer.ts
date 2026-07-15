import type { WASocket } from '@whiskeysockets/baileys';
import { createChildLogger } from '../../utils/logger.js';
import { getDb } from '../../database/client.js';
import { reserveDailySlot, releaseDailySlot } from '../warmup/DailyLimitGuard.js';

const logger = createChildLogger('contact-sharer');

/**
 * Build a vCard 3.0 string from name + phone.
 */
function buildVCard(displayName: string, phoneNumber: string): string {
  // Format phone number: ensure it starts with +
  const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

  // Split name into first/last for N field
  const parts = displayName.trim().split(/\s+/);
  const firstName = parts[0] || displayName;
  const lastName = parts.slice(1).join(' ') || '';

  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${displayName}`,
    `N:${lastName};${firstName};;;`,
    `TEL;type=CELL;type=VOICE;waid=${phoneNumber.replace(/\D/g, '')}:${formattedPhone}`,
    'END:VCARD',
  ].join('\n');
}

/**
 * Share one account's contact as a vCard to another account.
 * Used when chips in the warmup pool share each other's contacts.
 */
export async function shareContact(
  sock: WASocket,
  senderAccountId: string,
  recipientJid: string,
  contactDisplayName: string,
  contactPhoneNumber: string,
): Promise<void> {
  const vcard = buildVCard(contactDisplayName, contactPhoneNumber);

  // Respect the hard daily cap before sending.
  if (!(await reserveDailySlot(senderAccountId))) return;

  try {
    await sock.sendMessage(recipientJid, {
      contacts: {
        displayName: contactDisplayName,
        contacts: [{ vcard }],
      },
    });
  } catch (err) {
    await releaseDailySlot(senderAccountId);
    throw err;
  }

  const db = getDb();
  const receiverPhone = recipientJid.replace('@s.whatsapp.net', '');
  const receiverAccount = await db.account.findUnique({ where: { phoneNumber: receiverPhone } });

  await db.messageLog.create({
    data: {
      senderId: senderAccountId,
      receiverId: receiverAccount?.id ?? senderAccountId,
      messageType: 'TEXT',
      direction: 'OUTBOUND',
      spintaxOutput: `[vcard] ${contactDisplayName} (${contactPhoneNumber})`,
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  // Daily counter already incremented by the reservation above.

  logger.info(
    { accountId: senderAccountId, contactName: contactDisplayName },
    'Contact vCard shared',
  );
}

/**
 * Share a random account from the pool as a contact card.
 * Picks a random third account and shares its info with the recipient.
 */
export async function shareRandomPoolContact(
  sock: WASocket,
  senderAccountId: string,
  recipientJid: string,
): Promise<boolean> {
  const db = getDb();

  // Get all connected accounts except sender and recipient
  const receiverPhone = recipientJid.replace('@s.whatsapp.net', '');
  const candidates = await db.account.findMany({
    where: {
      status: 'CONNECTED',
      isPaused: false,
      id: { not: senderAccountId },
      phoneNumber: { not: receiverPhone },
    },
    select: { id: true, phoneNumber: true, displayName: true },
    take: 50,
  });

  if (candidates.length === 0) return false;

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const displayName = picked.displayName || `+${picked.phoneNumber}`;

  await shareContact(sock, senderAccountId, recipientJid, displayName, picked.phoneNumber);
  return true;
}
