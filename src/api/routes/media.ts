// Media library API: list/upload/delete/reload the warmup media pools
// (media/{images,audio,video,stickers}). Uploads are routed by MIME, deduped by
// content hash, and trigger a MediaManager pool reload.
import type { FastifyPluginAsync } from 'fastify';
import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MEDIA_CATEGORIES, type MediaCategory } from '../../core/messaging/MediaManager.js';
import { MEDIA_SCHEDULE } from '../../config/media-schedule.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('media-routes');

/** Allowed file extensions per category. */
const ALLOWED_EXT: Record<MediaCategory, string[]> = {
  images: ['.jpg', '.jpeg', '.png', '.webp'],
  stickers: ['.webp', '.png'],
  audio: ['.mp3', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.wav'],
  video: ['.mp4', '.mov', '.webm', '.3gp', '.m4v'],
  avatars: ['.jpg', '.jpeg', '.png', '.webp'],
};

const MIME_TO_CATEGORY: Array<[RegExp, MediaCategory]> = [
  [/^image\//, 'images'],
  [/^audio\//, 'audio'],
  [/^video\//, 'video'],
];

function categoryFromMime(mimetype: string): MediaCategory | null {
  for (const [re, cat] of MIME_TO_CATEGORY) if (re.test(mimetype)) return cat;
  return null;
}

function isValidCategory(c: string): c is MediaCategory {
  return (MEDIA_CATEGORIES as readonly string[]).includes(c);
}

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  const deps = () => (app as any).deps as { mediaManager?: any; mediaDir?: string };

  function mediaDir(): string {
    return deps().mediaDir || join(process.cwd(), 'media');
  }

  async function listCategory(cat: MediaCategory): Promise<string[]> {
    try {
      const files = await readdir(join(mediaDir(), cat));
      return files.filter((f) => !f.startsWith('.') && ALLOWED_EXT[cat].includes(extname(f).toLowerCase()));
    } catch {
      return [];
    }
  }

  async function existingHashes(cat: MediaCategory): Promise<Set<string>> {
    const set = new Set<string>();
    const files = await listCategory(cat);
    for (const f of files) {
      try {
        const buf = await readFile(join(mediaDir(), cat, f));
        set.add(createHash('sha256').update(buf).digest('hex'));
      } catch {}
    }
    return set;
  }

  // The per-day media mixing schedule (single source of truth for the UI).
  app.get('/schedule', async () => {
    return MEDIA_SCHEDULE.map((p) => {
      const early = p.perDay(p.fromDay);
      const late = p.perDay(99);
      return {
        type: p.type,
        fromDay: p.fromDay,
        perDay: early === late ? `${early}/dia` : `${early}–${late}/dia`,
        chancePct: Math.round(p.chance * 100),
        everyNDays: p.everyNDays ?? null,
      };
    });
  });

  // List all pools with counts + filenames
  app.get('/', async () => {
    const result: Record<string, { count: number; files: string[] }> = {};
    for (const cat of MEDIA_CATEGORIES) {
      const files = await listCategory(cat);
      result[cat] = { count: files.length, files };
    }
    return result;
  });

  // Upload one or more files (multipart). Routed by MIME unless ?category= forces it.
  app.post<{ Querystring: { category?: string } }>('/upload', async (request, reply) => {
    const forced = request.query.category;
    if (forced && !isValidCategory(forced)) {
      return reply.code(400).send({ error: `category inválida: ${forced}` });
    }

    const saved: Array<{ filename: string; category: string }> = [];
    const skipped: Array<{ filename: string; reason: string }> = [];

    let parts: AsyncIterableIterator<any>;
    try {
      parts = (request as any).files();
    } catch {
      return reply.code(400).send({ error: 'Envie arquivos como multipart/form-data' });
    }

    // Cache existing hashes per category to dedupe within this request too.
    const hashCache = new Map<MediaCategory, Set<string>>();

    for await (const part of parts) {
      const original = part.filename as string;
      const mimetype = part.mimetype as string;
      const ext = extname(original).toLowerCase();

      const category = (forced as MediaCategory) ?? categoryFromMime(mimetype);
      if (!category) {
        await part.toBuffer().catch(() => {});
        skipped.push({ filename: original, reason: `tipo não suportado (${mimetype})` });
        continue;
      }
      if (!ALLOWED_EXT[category].includes(ext)) {
        await part.toBuffer().catch(() => {});
        skipped.push({ filename: original, reason: `extensão não permitida para ${category} (${ext})` });
        continue;
      }

      const buffer: Buffer = await part.toBuffer();
      const hash = createHash('sha256').update(buffer).digest('hex');

      if (!hashCache.has(category)) hashCache.set(category, await existingHashes(category));
      const seen = hashCache.get(category)!;
      if (seen.has(hash)) {
        skipped.push({ filename: original, reason: 'duplicado (mesmo conteúdo já existe)' });
        continue;
      }

      const dir = join(mediaDir(), category);
      await mkdir(dir, { recursive: true });
      const safeName = `${randomUUID().slice(0, 8)}${ext}`;
      await writeFile(join(dir, safeName), buffer);
      seen.add(hash);
      saved.push({ filename: safeName, category });
    }

    await deps().mediaManager?.reloadPools?.();
    logger.info({ saved: saved.length, skipped: skipped.length }, 'Media upload processed');
    return { saved, skipped, counts: deps().mediaManager?.getPoolSizes?.() ?? null };
  });

  // Stream a file (for dashboard previews)
  app.get<{ Params: { category: string; filename: string } }>('/file/:category/:filename', async (request, reply) => {
    const { category, filename } = request.params;
    if (!isValidCategory(category)) return reply.code(404).send({ error: 'categoria inválida' });
    const safe = basename(filename); // prevent path traversal
    try {
      const buf = await readFile(join(mediaDir(), category, safe));
      return reply.type('application/octet-stream').send(buf);
    } catch {
      return reply.code(404).send({ error: 'arquivo não encontrado' });
    }
  });

  // Delete a file
  app.delete<{ Params: { category: string; filename: string } }>('/:category/:filename', async (request, reply) => {
    const { category, filename } = request.params;
    if (!isValidCategory(category)) return reply.code(400).send({ error: 'categoria inválida' });
    const safe = basename(filename);
    try {
      await unlink(join(mediaDir(), category, safe));
      await deps().mediaManager?.reloadPools?.();
      return { success: true };
    } catch (err: any) {
      return reply.code(404).send({ error: 'arquivo não encontrado', detail: err.message });
    }
  });

  // Re-scan folders (after a manual drop into media/*)
  app.post('/reload', async () => {
    await deps().mediaManager?.reloadPools?.();
    return { success: true, counts: deps().mediaManager?.getPoolSizes?.() ?? null };
  });
};
