import type { FastifyPluginAsync } from 'fastify';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../database/client.js';
import { saveContactBeforeChat } from '../../core/messaging/ContactSaver.js';
import { reserveDailySlot, releaseDailySlot } from '../../core/warmup/DailyLimitGuard.js';
import { ownerId } from '../ownerScope.js';

/**
 * Attempt to convert an image file to WebP sticker format (512x512, no background).
 * Uses sharp if available; returns the original buffer on failure.
 */
async function convertToStickerWebP(inputPath: string): Promise<{ buffer: Buffer; converted: boolean }> {
  try {
    const sharp = (await import('sharp')).default;
    const buffer = await sharp(inputPath)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 80 })
      .toBuffer();
    return { buffer, converted: true };
  } catch {
    // sharp unavailable or conversion failed - fall through to raw file
    const buffer = await readFile(inputPath);
    return { buffer, converted: false };
  }
}

export const sendRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // Upload file and return server path
  app.post('/upload', async (request, reply) => {
    const contentType = request.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      // Handle base64 JSON upload
      const body = request.body as { data: string; filename: string; type: string };
      if (!body?.data || !body?.filename) return reply.code(400).send({ error: 'data and filename required' });

      const ext = body.filename.split('.').pop() || 'bin';
      const newName = `${randomUUID().slice(0, 8)}.${ext}`;

      let dir = 'media/uploads';
      if (body.type?.startsWith('image')) dir = 'media/images';
      else if (body.type?.startsWith('audio')) dir = 'media/audio';
      else if (body.type?.startsWith('video')) dir = 'media/video';

      const fullDir = join(process.cwd(), dir);
      await mkdir(fullDir, { recursive: true });
      const filePath = join(dir, newName);

      const buffer = Buffer.from(body.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
      await writeFile(join(process.cwd(), filePath), buffer);

      return { path: filePath, filename: newName, size: buffer.length };
    }

    return reply.code(400).send({ error: 'Use JSON with base64 data' });
  });

  // Send message from a connected account to target numbers
  app.post<{
    Body: {
      fromAccountId: string;
      targets: string[];
      messageType: 'text' | 'image' | 'audio' | 'sticker' | 'video' | 'location' | 'contact' | 'poll';
      content?: string;
      mediaUrl?: string;
      caption?: string;
      location?: { lat: number; lng: number; name?: string };
      poll?: { question: string; options: string[] };
      vcard?: { name: string; phone: string };
      delay?: number;
    };
  }>('/', async (request, reply) => {
    const { fromAccountId, targets, messageType, content, mediaUrl, caption, location, poll, vcard, delay = 5 } = request.body;

    if (!fromAccountId || !targets || targets.length === 0) {
      return reply.code(400).send({ error: 'fromAccountId and targets required' });
    }

    // Multi-tenant: can only send FROM a number this operator owns.
    const ownsSender = await getDb().account.findFirst({ where: { id: fromAccountId, ownerId: ownerId(request) }, select: { id: true } });
    if (!ownsSender) return reply.code(404).send({ error: 'Account not found' });

    const deps = (app as any).deps;
    const sock = deps.sessionManager.getSocket(fromAccountId);
    if (!sock) {
      return reply.code(400).send({ error: 'Account not connected' });
    }

    const results: { target: string; status: string; error?: string }[] = [];
    const delayMs = Math.max(delay, 3) * 1000;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i].replace(/\D/g, '');
      const jid = `${target}@s.whatsapp.net`;

      try {
        // Respect the hard daily cap: manual sends now count toward the daily
        // limit instead of bypassing it. Skip the target if the cap is reached.
        if (!(await reserveDailySlot(fromAccountId))) {
          results.push({ target, status: 'skipped', error: 'daily-limit-reached' });
          continue;
        }

        // Save contact before sending (onWhatsApp + presence + profile view)
        await saveContactBeforeChat(sock, fromAccountId, jid);

        // Typing indicator
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
        await sock.sendPresenceUpdate('paused', jid);

        // Send based on type
        let msg: any;
        switch (messageType) {
          case 'text':
            msg = await sock.sendMessage(jid, { text: content || '' });
            break;
          case 'image':
            if (mediaUrl) {
              msg = await sock.sendMessage(jid, { image: { url: mediaUrl }, caption: caption || undefined });
            }
            break;
          case 'audio':
            if (mediaUrl) {
              msg = await sock.sendMessage(jid, { audio: { url: mediaUrl }, mimetype: 'audio/ogg; codecs=opus', ptt: true });
            }
            break;
          case 'sticker':
            if (mediaUrl) {
              const { buffer: stickerBuf, converted } = await convertToStickerWebP(
                join(process.cwd(), mediaUrl),
              );
              if (converted) {
                // Send the WebP buffer directly
                msg = await sock.sendMessage(jid, { sticker: stickerBuf });
              } else {
                // sharp unavailable - send as-is via URL
                msg = await sock.sendMessage(jid, { sticker: { url: mediaUrl } });
              }
            }
            break;
          case 'video':
            if (mediaUrl) {
              msg = await sock.sendMessage(jid, { video: { url: mediaUrl }, caption: caption || undefined });
            }
            break;
          case 'location':
            if (location) {
              msg = await sock.sendMessage(jid, {
                location: { degreesLatitude: location.lat, degreesLongitude: location.lng, name: location.name || '' },
              });
            }
            break;
          case 'contact':
            if (vcard) {
              const vcardStr = `BEGIN:VCARD\nVERSION:3.0\nFN:${vcard.name}\nTEL;type=CELL:${vcard.phone}\nEND:VCARD`;
              msg = await sock.sendMessage(jid, {
                contacts: { displayName: vcard.name, contacts: [{ vcard: vcardStr }] },
              });
            }
            break;
          case 'poll':
            if (poll) {
              msg = await sock.sendMessage(jid, {
                poll: { name: poll.question, values: poll.options, selectableCount: 1 },
              } as any);
            }
            break;
        }

        // Log
        await db.messageLog.create({
          data: {
            senderId: fromAccountId,
            receiverId: fromAccountId,
            messageType: messageType.toUpperCase() as any,
            direction: 'OUTBOUND',
            spintaxOutput: content || caption || `[${messageType}]`,
            status: 'SENT',
            sentAt: new Date(),
          },
        });

        results.push({ target, status: 'sent' });
      } catch (err: any) {
        // Give the reserved slot back and record the failure so blockRate sees it.
        await releaseDailySlot(fromAccountId);
        await db.messageLog.create({
          data: {
            senderId: fromAccountId,
            receiverId: fromAccountId,
            messageType: messageType.toUpperCase() as any,
            direction: 'OUTBOUND',
            spintaxOutput: content || caption || `[${messageType}]`,
            status: 'FAILED',
            errorMessage: String(err?.message ?? err).slice(0, 500),
          },
        }).catch(() => {});
        results.push({ target, status: 'failed', error: err.message });
      }

      // Delay between targets
      if (i < targets.length - 1) {
        await new Promise(r => setTimeout(r, delayMs + Math.random() * 2000));
      }
    }

    return { sent: results.filter(r => r.status === 'sent').length, failed: results.filter(r => r.status === 'failed').length, results };
  });

  // Get connected accounts for the "from" selector (this operator's only)
  app.get('/accounts', async (request) => {
    return db.account.findMany({
      where: { status: 'CONNECTED', ownerId: ownerId(request) },
      select: { id: true, phoneNumber: true, warmupDay: true, msgsSentToday: true },
    });
  });
};
