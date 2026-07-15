import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../database/client.js';
import { createChildLogger } from '../../utils/logger.js';
import {
  searchGoogle,
  searchAllFree,
  searchGoogleFree,
  searchDuckDuckGo,
  searchBing,
  scrapeWhatsGroupLink,
  scrapeWhatsGroupLinkAll,
  scrapeAppGroupLink,
  scrapeDirectory,
  extractLinksFromText,
  validateLink,
  validateWithBaileys,
  classifyNiche,
  NICHE_KEYWORDS,
  NICHE_LABELS,
  NICHE_LIST,
} from '../../core/discovery/GroupDiscovery.js';

const logger = createChildLogger('discovery-routes');

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // ── GET /api/discovery/search ── search for WhatsApp groups
  app.get<{
    Querystring: {
      q?: string;
      source?: 'google' | 'free' | 'duckduckgo' | 'bing' | 'directory' | 'text' | 'whatsgrouplink' | 'appgrouplink';
      niche?: string;
      page?: string;
      proxy?: string;
    };
  }>('/search', async (request, reply) => {
    const { q, source = 'free', niche, page: pageStr, proxy: proxyUrl } = request.query;
    const page = parseInt(pageStr || '1', 10);

    // Only free-text extraction strictly needs a query. Directory scrapers
    // (free/appgrouplink/etc) work without a term — they browse listings.
    if (!q && source === 'text') {
      return reply.code(400).send({ error: 'q (texto) é obrigatório para extração de texto' });
    }

    try {
      // FREE search - all engines combined (default)
      if (source === 'free' || source === 'google') {
        const searchQuery = niche
          ? `${q || ''} ${niche} grupo whatsapp`.trim()
          : `${q || ''} grupo whatsapp`.trim();

        // Try Google CSE API first if configured
        const apiKey = process.env.GOOGLE_CSE_API_KEY;
        const cx = process.env.GOOGLE_CSE_CX;

        if (source === 'google' && apiKey && cx) {
          const start = (page - 1) * 10 + 1;
          const { results, totalResults } = await searchGoogle(searchQuery, apiKey, cx, start);
          const enriched = results.map((r) => ({
            ...r, niche: classifyNiche(r.title, r.snippet), source: 'google' as const,
          }));
          return { results: enriched, totalResults, page, source: 'google' };
        }

        // Free search across all engines
        const { results, sources } = await searchAllFree(searchQuery, proxyUrl);
        const enriched = results.map((r) => ({
          ...r, niche: classifyNiche(r.title, r.snippet), source: 'free' as const,
        }));
        return { results: enriched, totalResults: enriched.length, page, source: 'free', engines: sources };
      }

      // DuckDuckGo only
      if (source === 'duckduckgo') {
        const searchQuery = niche ? `${q || ''} ${niche} grupo whatsapp`.trim() : `${q || ''} grupo whatsapp`.trim();
        const { results } = await searchDuckDuckGo(searchQuery);
        const enriched = results.map((r) => ({ ...r, niche: classifyNiche(r.title, r.snippet), source: 'duckduckgo' as const }));
        return { results: enriched, totalResults: enriched.length, page, source: 'duckduckgo' };
      }

      // WhatsGroupLink - all categories
      if (source === 'whatsgrouplink') {
        const { results } = await scrapeWhatsGroupLinkAll();
        const enriched = results.map((r) => ({ ...r, niche: classifyNiche(r.title, r.snippet), source: 'whatsgrouplink' as const }));
        return { results: enriched, totalResults: enriched.length, page, source: 'whatsgrouplink' };
      }

      // AppGroupLink
      if (source === 'appgrouplink') {
        const { results } = await scrapeAppGroupLink();
        const enriched = results.map((r) => ({ ...r, niche: classifyNiche(r.title, r.snippet), source: 'appgrouplink' as const }));
        return { results: enriched, totalResults: enriched.length, page, source: 'appgrouplink' };
      }

      // Bing only
      if (source === 'bing') {
        const searchQuery = niche ? `${q || ''} ${niche} grupo whatsapp`.trim() : `${q || ''} grupo whatsapp`.trim();
        const { results } = await searchBing(searchQuery, proxyUrl);
        const enriched = results.map((r) => ({ ...r, niche: classifyNiche(r.title, r.snippet), source: 'bing' as const }));
        return { results: enriched, totalResults: enriched.length, page, source: 'bing' };
      }

      if (source === 'directory') {
        const category = niche || q || '';
        const { results, hasMore } = await scrapeDirectory(category, page);

        // Classify results
        const enriched = results.map((r) => ({
          ...r,
          niche: r.category || classifyNiche(r.groupName, ''),
          source: 'directory' as const,
        }));

        return {
          results: enriched,
          hasMore,
          page,
          source: 'directory',
        };
      }

      // source === 'text'
      if (!q) {
        return reply.code(400).send({ error: 'q (text) is required for text extraction' });
      }

      const links = extractLinksFromText(q);
      return {
        results: links.map((l) => ({
          ...l,
          niche: 'geral',
          source: 'text' as const,
        })),
        totalResults: links.length,
        page: 1,
        source: 'text',
      };
    } catch (err: any) {
      logger.error({ err: err.message, source }, 'Discovery search failed');
      return reply.code(500).send({ error: 'Search failed', detail: err.message });
    }
  });

  // ── POST /api/discovery/validate ── validate invite links
  app.post<{
    Body: { links: string[]; accountId?: string };
  }>('/validate', async (request, reply) => {
    const { links, accountId } = request.body;

    if (!links || !Array.isArray(links) || links.length === 0) {
      return reply.code(400).send({ error: 'links array is required' });
    }

    if (links.length > 50) {
      return reply.code(400).send({ error: 'max 50 links per request' });
    }

    const deps = (app as any).deps;
    // Use provided accountId or find any connected socket
    let sock = accountId ? deps.sessionManager?.getSocket(accountId) : null;
    if (!sock) {
      const socketIds = deps.sessionManager?.getSocketIds() ?? [];
      for (const id of socketIds) {
        sock = deps.sessionManager?.getSocket(id);
        if (sock) break;
      }
    }

    const results: Array<{
      inviteCode: string;
      isActive: boolean;
      groupName?: string;
      description?: string;
      memberCount?: number;
      niche?: string;
    }> = [];

    for (const link of links) {
      // Extract code from link
      const codeMatch = link.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9]{15,25})/);
      const code = codeMatch ? codeMatch[1] : link.trim();

      if (!code || code.length < 15) {
        results.push({ inviteCode: code || link, isActive: false });
        continue;
      }

      let validation: {
        inviteCode: string;
        isActive: boolean;
        groupName?: string;
        description?: string;
        memberCount?: number;
      };

      // Prefer Baileys validation if socket is available
      try {
        if (sock) {
          validation = await validateWithBaileys(sock, code);
          // Small delay between Baileys validations to avoid rate limiting
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        } else {
          validation = await validateLink(code);
        }
      } catch {
        validation = { inviteCode: code, isActive: false };
      }

      const niche = validation.groupName
        ? classifyNiche(validation.groupName, validation.description || '')
        : 'geral';

      results.push({ ...validation, niche });

      // If active, upsert into DiscoveredGroup
      if (validation.isActive) {
        try {
          await db.discoveredGroup.upsert({
            where: { inviteCode: code },
            create: {
              inviteCode: code,
              inviteLink: `https://chat.whatsapp.com/${code}`,
              groupName: validation.groupName || null,
              description: validation.description || null,
              memberCount: validation.memberCount || null,
              niche,
              source: 'validation',
              isActive: true,
              lastChecked: new Date(),
            },
            update: {
              groupName: validation.groupName || undefined,
              description: validation.description || undefined,
              memberCount: validation.memberCount || undefined,
              niche,
              isActive: true,
              lastChecked: new Date(),
            },
          });
        } catch (err: any) {
          logger.warn({ code, err: err.message }, 'Failed to upsert discovered group');
        }
      } else {
        // Mark as inactive if it exists
        try {
          await db.discoveredGroup.updateMany({
            where: { inviteCode: code },
            data: { isActive: false, lastChecked: new Date() },
          });
        } catch {
          // ignore
        }
      }

      // Small delay between validations to avoid rate limiting
      await new Promise((r) => setTimeout(r, 500));
    }

    const active = results.filter((r) => r.isActive).length;
    const inactive = results.filter((r) => !r.isActive).length;

    return { results, total: results.length, active, inactive };
  });

  // ── POST /api/discovery/extract ── extract links from pasted text (saves as pending, NOT active)
  app.post<{
    Body: { text: string };
  }>('/extract', async (request, reply) => {
    const { text } = request.body;

    if (!text || typeof text !== 'string') {
      return reply.code(400).send({ error: 'text is required' });
    }

    const links = extractLinksFromText(text);

    let saved = 0;
    for (const link of links) {
      try {
        await db.discoveredGroup.upsert({
          where: { inviteCode: link.inviteCode },
          create: {
            inviteCode: link.inviteCode,
            inviteLink: link.inviteLink,
            source: 'text_extract',
            isActive: false,
          },
          update: {},
        });
        saved++;
      } catch {}
    }

    return { links, total: links.length, saved };
  });

  // ── POST /api/discovery/save-validated ── validate via Baileys THEN save only active groups
  app.post<{
    Body: { links: string[]; accountId?: string };
  }>('/save-validated', async (request, reply) => {
    const { links, accountId } = request.body;

    if (!links || !Array.isArray(links) || links.length === 0) {
      return reply.code(400).send({ error: 'links array is required' });
    }

    const deps = (app as any).deps;
    let sock = accountId ? deps.sessionManager?.getSocket(accountId) : null;
    if (!sock) {
      const socketIds = deps.sessionManager?.getSocketIds() ?? [];
      for (const id of socketIds) {
        sock = deps.sessionManager?.getSocket(id);
        if (sock) break;
      }
    }

    const results: Array<{
      inviteCode: string;
      isActive: boolean;
      groupName?: string;
      description?: string;
      memberCount?: number;
      niche?: string;
      saved: boolean;
    }> = [];

    for (const link of links) {
      const codeMatch = link.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9]{15,25})/);
      const code = codeMatch ? codeMatch[1] : link.trim();

      if (!code || code.length < 15) {
        results.push({ inviteCode: code || link, isActive: false, saved: false });
        continue;
      }

      let validation: {
        inviteCode: string;
        isActive: boolean;
        groupName?: string;
        description?: string;
        memberCount?: number;
      };

      try {
        if (sock) {
          validation = await validateWithBaileys(sock, code);
          await new Promise(r => setTimeout(r, 800 + Math.random() * 1500));
        } else {
          validation = await validateLink(code);
        }
      } catch {
        validation = { inviteCode: code, isActive: false };
      }

      const niche = validation.groupName
        ? classifyNiche(validation.groupName, validation.description || '')
        : 'geral';

      if (validation.isActive) {
        try {
          await db.discoveredGroup.upsert({
            where: { inviteCode: code },
            create: {
              inviteCode: code,
              inviteLink: `https://chat.whatsapp.com/${code}`,
              groupName: validation.groupName || null,
              description: validation.description || null,
              memberCount: validation.memberCount || null,
              niche,
              source: 'validated_save',
              isActive: true,
              lastChecked: new Date(),
            },
            update: {
              groupName: validation.groupName || undefined,
              description: validation.description || undefined,
              memberCount: validation.memberCount || undefined,
              niche,
              isActive: true,
              lastChecked: new Date(),
            },
          });
          results.push({ ...validation, niche, saved: true });
        } catch (err: any) {
          logger.warn({ code, err: err.message }, 'Failed to save validated group');
          results.push({ ...validation, niche, saved: false });
        }
      } else {
        // Dead link - remove from DB if it exists
        try {
          await db.discoveredGroup.deleteMany({ where: { inviteCode: code } });
        } catch {}
        results.push({ ...validation, niche, saved: false });
      }
    }

    const active = results.filter(r => r.isActive).length;
    const saved = results.filter(r => r.saved).length;
    const dead = results.filter(r => !r.isActive).length;

    return { results, total: results.length, active, saved, dead };
  });

  // ── GET /api/discovery/niches ── list all niches with counts
  app.get('/niches', async () => {
    const niches = NICHE_LIST.map((key) => ({
      key,
      label: NICHE_LABELS[key] || key,
      keywords: NICHE_KEYWORDS[key] || [],
    }));

    // Get counts from DB
    const counts = await db.discoveredGroup.groupBy({
      by: ['niche'],
      _count: { id: true },
      where: { isActive: true },
    });

    const countMap: Record<string, number> = {};
    for (const c of counts) {
      countMap[c.niche] = c._count.id;
    }

    const totalActive = await db.discoveredGroup.count({ where: { isActive: true } });
    const totalAll = await db.discoveredGroup.count();

    return {
      niches: niches.map((n) => ({
        ...n,
        count: countMap[n.key] || 0,
      })),
      totalActive,
      totalAll,
    };
  });

  // ── GET /api/discovery/groups ── list discovered groups
  app.get<{
    Querystring: {
      niche?: string;
      active?: string;
      source?: string;
      page?: string;
      limit?: string;
    };
  }>('/groups', async (request) => {
    const { niche, active, source, page: pageStr, limit: limitStr } = request.query;
    const page = parseInt(pageStr || '1', 10);
    const limit = Math.min(parseInt(limitStr || '50', 10), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (niche) where.niche = niche;
    if (active !== undefined) where.isActive = active === 'true';
    if (source) where.source = source;

    const [groups, total] = await Promise.all([
      db.discoveredGroup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      db.discoveredGroup.count({ where }),
    ]);

    return {
      groups,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // ── DELETE /api/discovery/groups/all ── remove ALL discovered groups
  app.delete('/groups/all', async () => {
    const { count } = await db.discoveredGroup.deleteMany({});
    return { status: 'removed_all', deleted: count };
  });

  // ── DELETE /api/discovery/groups/:id ── remove a discovered group
  app.delete<{ Params: { id: string } }>('/groups/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      await db.discoveredGroup.delete({ where: { id } });
      return { status: 'removed', id };
    } catch {
      return reply.code(404).send({ error: 'Group not found' });
    }
  });

  // ── POST /api/discovery/groups/:id/add-to-warming ── add discovered group to warming queue
  app.post<{
    Params: { id: string };
    Body: { accountId?: string };
  }>('/groups/:id/add-to-warming', async (request, reply) => {
    const { id } = request.params;
    const { accountId } = request.body;

    const group = await db.discoveredGroup.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'Group not found' });

    // Check if already in warming groups
    const existing = await db.warmingGroup.findFirst({
      where: { inviteCode: group.inviteCode },
    });

    if (existing) {
      return reply.code(400).send({ error: 'Group already in warming queue', warmingGroupId: existing.id });
    }

    const warmingGroup = await db.warmingGroup.create({
      data: {
        inviteLink: group.inviteLink,
        inviteCode: group.inviteCode,
        groupName: group.groupName,
        status: 'pending',
        accountId: accountId || null,
      },
    });

    return { status: 'added', warmingGroup };
  });
};
