import type { Job } from '../QueueManager.js';
import type { SessionManager } from '../../session/SessionManager.js';
import { BehaviorEngine } from '../../antiban/BehaviorEngine.js';
import { SafeZoneGuard } from '../../antiban/SafeZoneGuard.js';
import { resolveSpintax } from '../../messaging/SpintaxParser.js';
import { saveContactBeforeChat } from '../../messaging/ContactSaver.js';
import { mediaProcessor } from '../../messaging/MediaProcessor.js';
import { peekInbound } from '../../messaging/RecentInbound.js';
import { getDailyLimitForAccount, tryReserveDailySlot, releaseDailySlot } from '../../warmup/DailyLimitGuard.js';
import { getDb } from '../../../database/client.js';
import { createChildLogger } from '../../../utils/logger.js';

const logger = createChildLogger('message-worker');

export interface MessageJobData {
  accountId: string;
  recipientJid: string;
  content: string;
  messageType: 'text' | 'image' | 'audio' | 'sticker' | 'video' | 'reaction';
  conversationPairId?: string;
  stepIndex?: number;
  mediaPath?: string;
  reactionEmoji?: string;
  reactionKey?: any;
}

export function createMessageProcessor(
  sessionManager: SessionManager,
  behaviorEngine: BehaviorEngine,
  safeZoneGuard: SafeZoneGuard
) {
  return async (job: Job<MessageJobData>) => {
    const { accountId, recipientJid, content, messageType, mediaPath, reactionEmoji, reactionKey } = job.data;

    const sock = sessionManager.getSocket(accountId);
    if (!sock) {
      throw new Error(`No active socket for account ${accountId}`);
    }

    const resolvedText = resolveSpintax(content || '');

    const canSend = await safeZoneGuard.canSend(accountId, resolvedText);
    if (!canSend.allowed) {
      logger.info({ accountId, reason: canSend.reason }, 'Blocked by SafeZoneGuard');
      throw new Error(`Rate limited: ${canSend.reason}`);
    }

    // HARD DAILY CAP: atomically reserve a slot for today before sending.
    // If the cap is reached, drop this message instead of overshooting the
    // daily limit. This is the enforcement that conversation-level scheduling
    // (which is predictive only) cannot guarantee on its own.
    const dailyLimit = await getDailyLimitForAccount(accountId);
    const reserved = await tryReserveDailySlot(accountId, dailyLimit);
    if (!reserved) {
      logger.info({ accountId, dailyLimit }, 'Daily limit reached — dropping queued message');
      return { status: 'skipped', reason: 'daily-limit-reached' };
    }

    // Send message based on type. Any failure after this point releases the
    // reserved slot so a transient error does not consume the day's quota.
    let sentMsg: any;
    try {
      // Save contact before first message (onWhatsApp + presence + profile view)
      if (job.data.stepIndex === 0 || job.data.stepIndex === undefined) {
        await saveContactBeforeChat(sock, accountId, recipientJid);
      } else {
        try {
          await sock.presenceSubscribe(recipientJid);
        } catch {}
      }

      // Simulate typing for text messages
      if (messageType === 'text' || messageType === 'image') {
        await behaviorEngine.simulateTyping(sock, recipientJid, resolvedText.length || 10);
      }

      // Show "recording audio…" before a voice note, like a real person.
      if (messageType === 'audio') {
        try { await sock.sendPresenceUpdate('recording', recipientJid); } catch {}
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 4000));
        try { await sock.sendPresenceUpdate('paused', recipientJid); } catch {}
      }

      // Quoted reply: within a conversation, occasionally quote the last message
      // received from this contact (very human, templates never do this).
      let quoted: any = undefined;
      if (messageType === 'text' && job.data.conversationPairId && Math.random() < 0.35) {
        const recipientPhone = recipientJid.replace('@s.whatsapp.net', '');
        const partner = await getDb().account.findUnique({
          where: { phoneNumber: recipientPhone },
          select: { id: true },
        });
        if (partner) quoted = peekInbound(accountId, partner.id) ?? undefined;
      }

      // Re-encode media at send time so each send has a unique hash (anti-pattern
      // defense). Falls back to the original file when sharp/ffmpeg are absent.
      let processed: { buffer: Buffer; mimetype?: string } | null = null;
      if (mediaPath && (messageType === 'image' || messageType === 'audio' || messageType === 'video' || messageType === 'sticker')) {
        processed = await mediaProcessor.processForSend(mediaPath, messageType);
      }
      const imageSrc = processed?.buffer ?? (mediaPath ? { url: mediaPath } : undefined);

      switch (messageType) {
      case 'text':
        sentMsg = await sock.sendMessage(
          recipientJid,
          { text: resolvedText },
          quoted ? { quoted } : undefined,
        );
        break;

      case 'image':
        if (imageSrc) {
          sentMsg = await sock.sendMessage(recipientJid, {
            image: imageSrc as any,
            caption: resolvedText || undefined,
          });
        } else {
          sentMsg = await sock.sendMessage(recipientJid, { text: resolvedText });
        }
        break;

      case 'audio':
        if (imageSrc) {
          sentMsg = await sock.sendMessage(recipientJid, {
            audio: imageSrc as any,
            mimetype: processed?.mimetype ?? 'audio/ogg; codecs=opus',
            ptt: true,
          });
        }
        break;

      case 'sticker':
        if (imageSrc) {
          sentMsg = await sock.sendMessage(recipientJid, {
            sticker: imageSrc as any,
          });
        }
        break;

      case 'video':
        if (imageSrc) {
          sentMsg = await sock.sendMessage(recipientJid, {
            video: imageSrc as any,
            caption: resolvedText || undefined,
          });
        }
        break;

      case 'reaction':
        if (reactionKey && reactionEmoji) {
          sentMsg = await sock.sendMessage(recipientJid, {
            react: { text: resolveSpintax(reactionEmoji), key: reactionKey },
          });
        }
        break;

      default:
        sentMsg = await sock.sendMessage(recipientJid, { text: resolvedText });
      }
    } catch (err) {
      // Send failed after reserving a slot — give the quota back.
      await releaseDailySlot(accountId);
      // Record FAILED only on the final attempt (the queue retries up to
      // maxAttempts), so the daily blockRate metric isn't inflated by retries.
      const lastAttempt = (job.attempts ?? 0) >= ((job.maxAttempts ?? 3) - 1);
      if (lastAttempt) {
        const mt = ['TEXT', 'IMAGE', 'AUDIO', 'STICKER', 'REACTION'].includes(messageType.toUpperCase())
          ? (messageType.toUpperCase() as any) : 'TEXT';
        await getDb().messageLog.create({
          data: {
            senderId: accountId,
            receiverId: accountId,
            messageType: mt,
            direction: 'OUTBOUND',
            spintaxOutput: `[falha:${messageType}]`,
            status: 'FAILED',
            errorMessage: String((err as any)?.message ?? err).slice(0, 500),
          },
        }).catch(() => {});
      }
      throw err;
    }

    // Record (the daily counter was already incremented by the reservation).
    safeZoneGuard.recordMessage(accountId, resolvedText);

    const db = getDb();

    const receiverPhone = recipientJid.replace('@s.whatsapp.net', '');
    const receiverAccount = await db.account.findUnique({ where: { phoneNumber: receiverPhone } });

    await db.messageLog.create({
      data: {
        senderId: accountId,
        receiverId: receiverAccount?.id ?? accountId,
        messageType: messageType.toUpperCase() as any,
        direction: 'OUTBOUND',
        spintaxOutput: resolvedText || `[${messageType}]`,
        status: 'SENT',
        sentAt: new Date(),
      },
    });

    logger.debug({ accountId, recipientJid, type: messageType, hasMedia: !!mediaPath }, 'Message sent');
    return { status: 'sent', messageId: sentMsg?.key?.id };
  };
}
