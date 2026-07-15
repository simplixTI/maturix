import type { PrismaClient } from '@prisma/client';
import type { SessionManager } from '../session/SessionManager.js';
import type { BehaviorEngine } from '../antiban/BehaviorEngine.js';
import { createChildLogger } from '../../utils/logger.js';
import { rememberInbound } from '../messaging/RecentInbound.js';
import { saveInboundContact } from '../messaging/ContactSaver.js';
import { getProtectionSettings } from '../../config/protectionSettings.js';

const logger = createChildLogger('message-handler');

/**
 * Handles incoming messages from the warmup pool.
 *
 * When a message arrives from another account in our pool:
 *   1. Mark the message as read (with a natural gaussian delay via BehaviorEngine)
 *   2. Optionally react to it (probability-based, also with natural delay)
 *   3. Increment the receiving account's msgsReceivedToday counter
 */
export class MessageHandler {
  /** Cache of phone numbers belonging to our accounts (refreshed periodically) */
  private knownPhones = new Map<string, string>(); // phoneNumber -> accountId
  /** Learned LID → accountId map (WhatsApp may address pool contacts by @lid) */
  private knownLids = new Map<string, string>(); // lidUser -> accountId
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly behaviorEngine: BehaviorEngine,
    private readonly db: PrismaClient,
  ) {}

  async start(): Promise<void> {
    // Build initial phone cache
    await this.refreshKnownPhones();

    // Refresh every 60s so newly added accounts are picked up
    this.refreshTimer = setInterval(() => {
      this.refreshKnownPhones().catch((err) => {
        logger.warn({ err: err?.message }, 'Failed to refresh known phones cache');
      });
    }, 60_000);

    // Listen for incoming messages
    this.sessionManager.on('message:received', (accountId, msg) => {
      this.handleMessage(accountId, msg).catch((err) => {
        logger.warn({ err: err?.message, accountId }, 'Error handling received message');
      });
    });

    logger.info('MessageHandler started – listening for warmup pool messages');
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ----------------------------------------------------------------
  // Internal
  // ----------------------------------------------------------------

  private async refreshKnownPhones(): Promise<void> {
    const accounts = await this.db.account.findMany({
      select: { id: true, phoneNumber: true },
    });
    this.knownPhones.clear();
    for (const acc of accounts) {
      this.knownPhones.set(acc.phoneNumber, acc.id);
    }
    logger.debug({ count: this.knownPhones.size }, 'Known phones cache refreshed');
  }

  /** Extract the user part (digits) of a phone JID, or null for non-PN JIDs. */
  private phoneOf(jid?: string | null): string | null {
    if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
    return jid.split('@')[0].split(':')[0];
  }

  /** Extract the user part of a LID JID, or null. */
  private lidOf(jid?: string | null): string | null {
    if (!jid || !jid.endsWith('@lid')) return null;
    return jid.split('@')[0].split(':')[0];
  }

  /** Pull the human-readable text out of an incoming Baileys message (plain text,
   * extended text, or an image/video caption) so the inbound log stores the real
   * content instead of a bare "[TEXT]" placeholder. */
  private extractText(msg: any): string {
    const m = msg?.message ?? {};
    return (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      ''
    ).slice(0, 1000);
  }

  private async handleMessage(receiverAccountId: string, msg: any): Promise<void> {
    const key = msg.key ?? {};
    const remoteJid: string | undefined = key.remoteJid;
    if (!remoteJid) return;

    // Status updates ("stories"): view them like a human (read receipt after a
    // natural delay). Viewing contacts' statuses is normal engagement that a real
    // user does — not just posting them.
    if (remoteJid === 'status@broadcast') {
      await this.maybeViewStatus(receiverAccountId, msg);
      return;
    }

    // Skip groups / other broadcasts; everything else (PN @s.whatsapp.net or @lid) is a 1:1 chat.
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) return;

    // Resolve the sender account. With the LID system, an incoming message's
    // remoteJid can be a `@lid` JID; the phone-number (PN) form is then carried
    // in `remoteJidAlt` / `senderPn`. Try every PN-bearing field, then fall back
    // to a learned LID → account map.
    const senderPhone =
      this.phoneOf(remoteJid) ??
      this.phoneOf(key.remoteJidAlt) ??
      this.phoneOf(key.senderPn) ??
      this.phoneOf(key.participantPn) ??
      this.phoneOf(key.participantAlt);

    const lidUser = this.lidOf(remoteJid) ?? this.lidOf(key.participant);

    let senderAccountId = senderPhone ? this.knownPhones.get(senderPhone) : undefined;
    if (!senderAccountId && lidUser) senderAccountId = this.knownLids.get(lidUser);

    // Sender is NOT one of our pool chips → it's an external/real contact. A real
    // person saves people who message them, so (optionally) auto-save the sender
    // in WhatsApp. Fire-and-forget (its own human pacing + dedup), then stop —
    // we don't run the mesh auto-read/react logic for outsiders.
    if (!senderAccountId) {
      if (senderPhone && getProtectionSettings().autoSaveInboundContacts) {
        const sock = this.sessionManager.getSocket(receiverAccountId);
        if (sock) {
          void saveInboundContact(sock, receiverAccountId, senderPhone, msg.pushName);
        }
      }
      return;
    }

    // Learn the LID → account mapping for future messages that arrive LID-only.
    if (lidUser && !this.knownLids.has(lidUser)) {
      this.knownLids.set(lidUser, senderAccountId);
    }

    // Remember this message so the receiver can quote it when it replies.
    rememberInbound(receiverAccountId, senderAccountId, msg);

    const sock = this.sessionManager.getSocket(receiverAccountId);
    if (!sock) {
      logger.debug({ receiverAccountId }, 'No active socket for receiver, skipping auto-read');
      return;
    }

    logger.debug(
      {
        receiverAccountId,
        senderAccountId,
        msgId: key.id,
        remoteJid,
        remoteJidAlt: key.remoteJidAlt,
        resolvedVia: senderPhone ? 'pn' : 'lid',
      },
      'Processing warmup pool message',
    );

    // 1. Mark as read with a natural delay (5-15s gaussian, handled inside simulateReadReceipt)
    try {
      await this.behaviorEngine.simulateReadReceipt(sock, [msg.key]);
      logger.debug({ receiverAccountId, msgId: msg.key?.id }, 'Read receipt sent');
    } catch (err: any) {
      logger.warn({ err: err?.message, receiverAccountId }, 'Failed to send read receipt');
    }

    // 2. Maybe react (probability-based with natural delay)
    try {
      // Determine if this is a new contact (first interaction between these two)
      const isNewContact = await this.isNewContact(receiverAccountId, senderAccountId);
      const reacted = await this.behaviorEngine.maybeReact(sock, msg.key, isNewContact);
      if (reacted) {
        logger.debug({ receiverAccountId, msgId: msg.key?.id }, 'Reaction sent');
      }
    } catch (err: any) {
      logger.warn({ err: err?.message, receiverAccountId }, 'Failed to send reaction');
    }

    // 3. Increment msgsReceivedToday on the receiving account + log the inbound
    //    message so received traffic is auditable and direction-based metrics work.
    try {
      await this.db.$transaction([
        this.db.account.update({
          where: { id: receiverAccountId },
          data: {
            msgsReceivedToday: { increment: 1 },
            lastActiveAt: new Date(),
          },
        }),
        this.db.messageLog.create({
          data: {
            senderId: senderAccountId,
            receiverId: receiverAccountId,
            messageType: 'TEXT',
            direction: 'INBOUND',
            status: 'DELIVERED',
            deliveredAt: new Date(),
            // Store the actual received text so the Conversas history shows the
            // real content instead of a "[TEXT]" placeholder.
            spintaxOutput: this.extractText(msg) || null,
          },
        }),
      ]);
    } catch (err: any) {
      logger.warn({ err: err?.message, receiverAccountId }, 'Failed to update received counter');
    }
  }

  /** View a received status update after a natural delay (most of the time). */
  private async maybeViewStatus(receiverAccountId: string, msg: any): Promise<void> {
    if (Math.random() > 0.85) return; // occasionally skip — humans don't view every status
    const sock = this.sessionManager.getSocket(receiverAccountId);
    if (!sock || !msg.key) return;
    const delayMs = 3000 + Math.floor(Math.random() * 25000); // 3–28s
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      await sock.readMessages([msg.key]);
      logger.debug({ receiverAccountId, author: msg.key.participant }, 'Status viewed');
    } catch (err: any) {
      logger.debug({ err: err?.message, receiverAccountId }, 'Failed to view status');
    }
  }

  private async isNewContact(accountId: string, contactAccountId: string): Promise<boolean> {
    const existing = await this.db.contactRelation.findUnique({
      where: {
        accountId_contactId: {
          accountId,
          contactId: contactAccountId,
        },
      },
    });
    return !existing;
  }
}
