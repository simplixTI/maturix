import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('group-discovery');

/**
 * Regex to extract WhatsApp group invite links from any text.
 * Matches https://chat.whatsapp.com/CODE and variants.
 */
const INVITE_LINK_REGEX = /https?:\/\/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9]{15,25})/g;

/**
 * Niche keyword map (PT-BR) for auto-classifying groups.
 */
export const NICHE_KEYWORDS: Record<string, string[]> = {
  marketing_digital: ['marketing', 'trafego', 'leads', 'copywriting', 'lancamento', 'infoproduto', 'tráfego', 'lançamento'],
  vendas: ['vendas', 'comercial', 'prospeccao', 'closer', 'crm', 'prospecção'],
  crypto: ['bitcoin', 'cripto', 'trade', 'binance', 'defi', 'nft', 'crypto', 'criptomoeda'],
  fitness: ['treino', 'academia', 'dieta', 'maromba', 'musculacao', 'crossfit', 'musculação'],
  ecommerce: ['shopify', 'dropshipping', 'mercado livre', 'loja virtual', 'ecommerce', 'e-commerce'],
  emprego: ['vaga', 'emprego', 'curriculo', 'freelancer', 'trabalho remoto', 'currículo'],
  educacao: ['curso', 'faculdade', 'enem', 'concurso', 'estudos', 'educação', 'educacao'],
  culinaria: ['receita', 'cozinha', 'confeitaria', 'gastronomia', 'culinária', 'culinaria'],
  religiao: ['igreja', 'oracao', 'biblia', 'evangelico', 'catolico', 'oração', 'bíblia', 'evangélico', 'católico'],
  investimentos: ['investimento', 'acoes', 'renda fixa', 'fundo', 'bolsa', 'ações', 'dividendos'],
  tecnologia: ['programacao', 'dev', 'python', 'javascript', 'ti', 'programação', 'developer', 'software'],
  saude: ['medico', 'enfermagem', 'farmacia', 'psicologia', 'nutricao', 'médico', 'farmácia', 'nutrição', 'saúde'],
  moda: ['moda', 'roupas', 'looks', 'fashion', 'estilo'],
  musica: ['musica', 'violao', 'piano', 'banda', 'funk', 'sertanejo', 'música', 'violão'],
  esportes: ['futebol', 'time', 'campeonato', 'apostas', 'bet', 'esporte'],
  geral: ['grupo', 'whatsapp', 'amizade', 'bate-papo', 'conhecer', 'conversa'],
};

/**
 * All niche keys.
 */
export const NICHE_LIST = Object.keys(NICHE_KEYWORDS);

/**
 * Niche labels for display.
 */
export const NICHE_LABELS: Record<string, string> = {
  marketing_digital: 'Marketing Digital',
  vendas: 'Vendas',
  crypto: 'Crypto',
  fitness: 'Fitness',
  ecommerce: 'E-commerce',
  emprego: 'Emprego',
  educacao: 'Educacao',
  culinaria: 'Culinaria',
  religiao: 'Religiao',
  investimentos: 'Investimentos',
  tecnologia: 'Tecnologia',
  saude: 'Saude',
  moda: 'Moda',
  musica: 'Musica',
  esportes: 'Esportes',
  geral: 'Geral',
};

export interface GoogleSearchResult {
  inviteCode: string;
  inviteLink: string;
  title: string;
  snippet: string;
}

export interface DirectoryResult {
  inviteCode: string;
  inviteLink: string;
  groupName: string;
  category: string;
  memberCount?: number;
}

export interface ExtractedLink {
  inviteCode: string;
  inviteLink: string;
}

export interface LinkValidation {
  inviteCode: string;
  isActive: boolean;
  groupName?: string;
  description?: string;
  memberCount?: number;
}

export interface BaileysValidation {
  inviteCode: string;
  isActive: boolean;
  groupJid?: string;
  groupName?: string;
  description?: string;
  memberCount?: number;
  creation?: number;
}

/**
 * Search Google Custom Search Engine for WhatsApp group links.
 */
export async function searchGoogle(
  query: string,
  apiKey: string,
  cx: string,
  start: number = 1,
): Promise<{ results: GoogleSearchResult[]; totalResults: number }> {
  const searchQuery = encodeURIComponent(query);
  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${apiKey}` +
    `&cx=${cx}` +
    `&q=${searchQuery}` +
    `&siteSearch=chat.whatsapp.com` +
    `&siteSearchFilter=i` +
    `&dateRestrict=m1` +
    `&num=10` +
    `&start=${start}`;

  logger.info({ query, start }, 'Searching Google CSE for WhatsApp groups');

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error({ status: res.status, body }, 'Google CSE request failed');
    throw new Error(`Google CSE error: ${res.status}`);
  }

  const data = await res.json() as {
    searchInformation?: { totalResults?: string };
    items?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  const results: GoogleSearchResult[] = [];

  if (data.items) {
    for (const item of data.items) {
      const link = item.link || '';
      const match = link.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9]{15,25})/);
      if (match) {
        results.push({
          inviteCode: match[1],
          inviteLink: `https://chat.whatsapp.com/${match[1]}`,
          title: item.title || '',
          snippet: item.snippet || '',
        });
      }
    }
  }

  const totalResults = parseInt(data.searchInformation?.totalResults || '0', 10);
  logger.info({ found: results.length, totalResults }, 'Google CSE results');
  return { results, totalResults };
}

/**
 * Scrape whatsgrouplink.com - CONFIRMED WORKING, server-rendered HTML.
 */
export async function scrapeWhatsGroupLink(
  category: string = 'active-whatsapp-group-links',
): Promise<{ results: GoogleSearchResult[] }> {
  const url = `https://whatsgrouplink.com/${category}/`;
  logger.info({ url }, 'Scraping whatsgrouplink.com');

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();

  const results: GoogleSearchResult[] = [];
  const seen = new Set<string>();
  // Match both /invite/ and direct links
  const matches = html.matchAll(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9]{10,25})/g);
  for (const match of matches) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push({
        inviteCode: match[1],
        inviteLink: `https://chat.whatsapp.com/${match[1]}`,
        title: '',
        snippet: '',
      });
    }
  }

  logger.info({ found: results.length }, 'whatsgrouplink.com results');
  return { results };
}

/**
 * Scrape appgrouplink.com - CONFIRMED WORKING, server-rendered HTML.
 * Fetches multiple pages for more results.
 */
export async function scrapeAppGroupLink(maxPages: number = 5): Promise<{ results: GoogleSearchResult[] }> {
  const results: GoogleSearchResult[] = [];
  const seen = new Set<string>();

  const urls = [
    'https://appgrouplink.com/',
    'https://appgrouplink.com/page/2/',
    'https://appgrouplink.com/page/3/',
    'https://appgrouplink.com/page/4/',
    'https://appgrouplink.com/page/5/',
  ].slice(0, maxPages);

  for (const url of urls) {
    try {
      logger.info({ url }, 'Scraping appgrouplink.com page');
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) break;
      const html = await res.text();

      const matches = html.matchAll(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9]{10,25})/g);
      for (const match of matches) {
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          results.push({ inviteCode: match[1], inviteLink: `https://chat.whatsapp.com/${match[1]}`, title: '', snippet: '' });
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch { break; }
  }

  logger.info({ found: results.length }, 'appgrouplink.com total results');
  return { results };
}

/**
 * Scrape whatsgrouplink.com - multiple categories for more results.
 */
export async function scrapeWhatsGroupLinkAll(): Promise<{ results: GoogleSearchResult[] }> {
  const categories = [
    'active-whatsapp-group-links',
    'chat-room-whatsapp-group-links',
    'business-whatsapp-group-links',
    'funny-whatsapp-group-links',
    'entertainment-whatsapp-group-links',
    'education-whatsapp-group-links',
    'news-whatsapp-group-links',
    'sports-whatsapp-group-links',
    'technology-whatsapp-group-links',
    'gaming-whatsapp-group-links',
  ];

  const results: GoogleSearchResult[] = [];
  const seen = new Set<string>();

  for (const cat of categories) {
    try {
      const { results: catResults } = await scrapeWhatsGroupLink(cat);
      for (const r of catResults) {
        if (!seen.has(r.inviteCode)) { seen.add(r.inviteCode); results.push(r); }
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch {}
  }

  logger.info({ found: results.length, categories: categories.length }, 'whatsgrouplink.com all categories');
  return { results };
}

/**
 * FREE Google scraping with proxy (no API key needed).
 */
export async function searchGoogleFree(
  query: string,
  proxyUrl?: string,
): Promise<{ results: GoogleSearchResult[] }> {
  const searchQuery = encodeURIComponent(`site:chat.whatsapp.com ${query}`);
  const url = `https://www.google.com/search?q=${searchQuery}&num=50&hl=pt-BR`;

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  };

  const fetchOpts: any = { headers, signal: AbortSignal.timeout(15000) };
  if (proxyUrl) {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    fetchOpts.agent = new HttpsProxyAgent(proxyUrl);
  }

  logger.info({ query }, 'Scraping Google for WhatsApp groups (free)');
  const res = await fetch(url, fetchOpts);
  const html = await res.text();

  const results: GoogleSearchResult[] = [];
  const linkMatches = html.matchAll(/chat\.whatsapp\.com\/([a-zA-Z0-9]{15,25})/g);
  const seen = new Set<string>();
  for (const match of linkMatches) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push({
        inviteCode: match[1],
        inviteLink: `https://chat.whatsapp.com/${match[1]}`,
        title: '',
        snippet: '',
      });
    }
  }

  logger.info({ found: results.length }, 'Google free scrape results');
  return { results };
}

/**
 * FREE DuckDuckGo search (no API key, no proxy needed).
 */
export async function searchDuckDuckGo(
  query: string,
): Promise<{ results: GoogleSearchResult[] }> {
  const searchQuery = encodeURIComponent(`site:chat.whatsapp.com ${query}`);
  const url = `https://html.duckduckgo.com/html/?q=${searchQuery}`;

  logger.info({ query }, 'Searching DuckDuckGo for WhatsApp groups');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();

  const results: GoogleSearchResult[] = [];
  const linkMatches = html.matchAll(/chat\.whatsapp\.com\/([a-zA-Z0-9]{15,25})/g);
  const seen = new Set<string>();
  for (const match of linkMatches) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push({
        inviteCode: match[1],
        inviteLink: `https://chat.whatsapp.com/${match[1]}`,
        title: '',
        snippet: '',
      });
    }
  }

  logger.info({ found: results.length }, 'DuckDuckGo results');
  return { results };
}

/**
 * FREE Bing search scraping.
 */
export async function searchBing(
  query: string,
  proxyUrl?: string,
): Promise<{ results: GoogleSearchResult[] }> {
  const searchQuery = encodeURIComponent(`site:chat.whatsapp.com ${query}`);
  const url = `https://www.bing.com/search?q=${searchQuery}&count=50`;

  const fetchOpts: any = {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15000),
  };
  if (proxyUrl) {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    fetchOpts.agent = new HttpsProxyAgent(proxyUrl);
  }

  logger.info({ query }, 'Scraping Bing for WhatsApp groups');
  const res = await fetch(url, fetchOpts);
  const html = await res.text();

  const results: GoogleSearchResult[] = [];
  const linkMatches = html.matchAll(/chat\.whatsapp\.com\/([a-zA-Z0-9]{15,25})/g);
  const seen = new Set<string>();
  for (const match of linkMatches) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push({
        inviteCode: match[1],
        inviteLink: `https://chat.whatsapp.com/${match[1]}`,
        title: '',
        snippet: '',
      });
    }
  }

  logger.info({ found: results.length }, 'Bing results');
  return { results };
}

/**
 * Search ALL free sources at once.
 */
export async function searchAllFree(
  query: string,
  proxyUrl?: string,
): Promise<{ results: GoogleSearchResult[]; sources: Record<string, number> }> {
  const allResults: GoogleSearchResult[] = [];
  const sources: Record<string, number> = {};
  const seen = new Set<string>();

  // DuckDuckGo (always free, no proxy needed)
  try {
    const ddg = await searchDuckDuckGo(query);
    for (const r of ddg.results) {
      if (!seen.has(r.inviteCode)) { seen.add(r.inviteCode); allResults.push(r); }
    }
    sources.duckduckgo = ddg.results.length;
  } catch { sources.duckduckgo = 0; }

  // Google (with proxy)
  try {
    const g = await searchGoogleFree(query, proxyUrl);
    for (const r of g.results) {
      if (!seen.has(r.inviteCode)) { seen.add(r.inviteCode); allResults.push(r); }
    }
    sources.google = g.results.length;
  } catch { sources.google = 0; }

  // Bing (with proxy)
  try {
    const b = await searchBing(query, proxyUrl);
    for (const r of b.results) {
      if (!seen.has(r.inviteCode)) { seen.add(r.inviteCode); allResults.push(r); }
    }
    sources.bing = b.results.length;
  } catch { sources.bing = 0; }

  // whatsgrouplink.com - ALL categories (confirmed working)
  try {
    const wgl = await scrapeWhatsGroupLinkAll();
    for (const r of wgl.results) {
      if (!seen.has(r.inviteCode)) { seen.add(r.inviteCode); allResults.push(r); }
    }
    sources.whatsgrouplink = wgl.results.length;
  } catch { sources.whatsgrouplink = 0; }

  // appgrouplink.com - multiple pages (confirmed working)
  try {
    const agl = await scrapeAppGroupLink(5);
    for (const r of agl.results) {
      if (!seen.has(r.inviteCode)) { seen.add(r.inviteCode); allResults.push(r); }
    }
    sources.appgrouplink = agl.results.length;
  } catch { sources.appgrouplink = 0; }

  // grupodezap.com.br
  try {
    const gdz = await scrapeGrupodeZap();
    for (const r of gdz.results) {
      if (!seen.has(r.inviteCode)) { seen.add(r.inviteCode); allResults.push(r); }
    }
    sources.grupodezap = gdz.results.length;
  } catch { sources.grupodezap = 0; }

  // linkdegrupo.com.br
  try {
    const ldg = await scrapeLinkdeGrupo();
    for (const r of ldg.results) {
      if (!seen.has(r.inviteCode)) { seen.add(r.inviteCode); allResults.push(r); }
    }
    sources.linkdegrupo = ldg.results.length;
  } catch { sources.linkdegrupo = 0; }

  // Directory (gruposwhats.app)
  try {
    const nicheKeywords = NICHE_KEYWORDS[query] ? query : '';
    const dir = await scrapeDirectory(nicheKeywords || query, 1);
    for (const r of dir.results) {
      if (!seen.has(r.inviteCode)) {
        seen.add(r.inviteCode);
        allResults.push({ inviteCode: r.inviteCode, inviteLink: r.inviteLink, title: r.groupName, snippet: '' });
      }
    }
    sources.diretorio = dir.results.length;
  } catch { sources.diretorio = 0; }

  logger.info({ total: allResults.length, sources }, 'All free sources searched');
  return { results: allResults, sources };
}

/**
 * Scrape gruposwhats.app for group links by category.
 */
export async function scrapeDirectory(
  category: string = '',
  page: number = 1,
): Promise<{ results: DirectoryResult[]; hasMore: boolean }> {
  const baseUrl = 'https://gruposwhats.app';
  const url = category
    ? `${baseUrl}/categoria/${encodeURIComponent(category)}?page=${page}`
    : `${baseUrl}?page=${page}`;

  logger.info({ category, page, url }, 'Scraping directory');

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    logger.error({ status: res.status }, 'Directory scrape failed');
    throw new Error(`Directory scrape error: ${res.status}`);
  }

  const html = await res.text();
  const results: DirectoryResult[] = [];

  // Extract group cards from HTML.
  // Pattern: links to chat.whatsapp.com inside the page content.
  const linkMatches = html.matchAll(/href=["'](https?:\/\/chat\.whatsapp\.com\/([a-zA-Z0-9]{15,25}))["']/g);
  const seenCodes = new Set<string>();

  for (const m of linkMatches) {
    const code = m[2];
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);

    // Try to extract a nearby group name.
    // Look for patterns like title="...", alt="...", or text near the link.
    let groupName = '';
    const idx = m.index ?? 0;
    const surrounding = html.slice(Math.max(0, idx - 500), idx + 500);

    // Try to find a title/heading near the link
    const titleMatch = surrounding.match(/(?:title|alt)=["']([^"']{3,80})["']/i)
      || surrounding.match(/<h[2-5][^>]*>([^<]{3,80})<\/h[2-5]>/i)
      || surrounding.match(/<strong>([^<]{3,80})<\/strong>/i);

    if (titleMatch) {
      groupName = titleMatch[1].trim();
    }

    // Try to extract member count
    let memberCount: number | undefined;
    const memberMatch = surrounding.match(/(\d+)\s*(?:membros|participantes|members)/i);
    if (memberMatch) {
      memberCount = parseInt(memberMatch[1], 10);
    }

    results.push({
      inviteCode: code,
      inviteLink: `https://chat.whatsapp.com/${code}`,
      groupName,
      category: category || 'geral',
      memberCount,
    });
  }

  // Check if there's a next page link
  const hasMore = html.includes(`page=${page + 1}`)
    || html.includes('proxima')
    || html.includes('next')
    || html.includes('pagination');

  logger.info({ found: results.length, hasMore }, 'Directory scrape results');
  return { results, hasMore };
}

/**
 * Extract all WhatsApp group invite links from any text.
 */
export function extractLinksFromText(text: string): ExtractedLink[] {
  const results: ExtractedLink[] = [];
  const seen = new Set<string>();

  // Reset regex state
  INVITE_LINK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INVITE_LINK_REGEX.exec(text)) !== null) {
    const code = match[1];
    if (seen.has(code)) continue;
    seen.add(code);
    results.push({
      inviteCode: code,
      inviteLink: `https://chat.whatsapp.com/${code}`,
    });
  }

  // Also try to find bare codes that might be pasted without full URL
  const bareCodeRegex = /chat\.whatsapp\.com\/([a-zA-Z0-9]{15,25})/g;
  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = bareCodeRegex.exec(text)) !== null) {
    const code = bareMatch[1];
    if (seen.has(code)) continue;
    seen.add(code);
    results.push({
      inviteCode: code,
      inviteLink: `https://chat.whatsapp.com/${code}`,
    });
  }

  logger.info({ extracted: results.length }, 'Extracted links from text');
  return results;
}

/**
 * Validate a WhatsApp group invite link via HTTP (check og:title).
 * Does NOT require Baileys connection.
 */
export async function validateLink(code: string): Promise<LinkValidation> {
  const url = `https://chat.whatsapp.com/${code}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { inviteCode: code, isActive: false };
    }

    const html = await res.text();

    // Check for "this invite link is invalid" or similar
    if (
      html.includes('invite link is invalid') ||
      html.includes('convite invalido') ||
      html.includes('link de convite') && html.includes('invalido') ||
      html.includes('This invite link has been revoked')
    ) {
      return { inviteCode: code, isActive: false };
    }

    // Extract og:title for group name
    let groupName: string | undefined;
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
    if (ogTitleMatch) {
      groupName = ogTitleMatch[1].trim();
    }

    // Extract og:description
    let description: string | undefined;
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i);
    if (ogDescMatch) {
      description = ogDescMatch[1].trim();
    }

    // If there's no og:title and the page seems like an error page, mark inactive
    if (!groupName && html.includes('404')) {
      return { inviteCode: code, isActive: false };
    }

    return {
      inviteCode: code,
      isActive: true,
      groupName,
      description,
    };
  } catch (err: any) {
    logger.warn({ code, err: err.message }, 'Link validation failed');
    return { inviteCode: code, isActive: false };
  }
}

/**
 * Validate a group invite using Baileys socket.
 * Gets full metadata without joining the group.
 */
export async function validateWithBaileys(
  sock: any,
  code: string,
): Promise<BaileysValidation> {
  try {
    const info = await sock.groupGetInviteInfo(code);

    return {
      inviteCode: code,
      isActive: true,
      groupJid: info.id,
      groupName: info.subject || undefined,
      description: info.desc || undefined,
      memberCount: info.size || info.participants?.length || undefined,
      creation: info.creation || undefined,
    };
  } catch (err: any) {
    logger.warn({ code, err: err.message }, 'Baileys validation failed');
    return {
      inviteCode: code,
      isActive: false,
    };
  }
}

/**
 * Scrape grupodezap.com.br - Brazilian WhatsApp group directory.
 */
export async function scrapeGrupodeZap(): Promise<{ results: GoogleSearchResult[] }> {
  const results: GoogleSearchResult[] = [];
  const seen = new Set<string>();
  const pages = [
    'https://grupodezap.com.br/',
    'https://grupodezap.com.br/page/2/',
    'https://grupodezap.com.br/page/3/',
    'https://grupodezap.com.br/page/4/',
    'https://grupodezap.com.br/page/5/',
  ];

  for (const url of pages) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) break;
      const html = await res.text();

      const matches = html.matchAll(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9]{10,25})/g);
      for (const match of matches) {
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          results.push({ inviteCode: match[1], inviteLink: `https://chat.whatsapp.com/${match[1]}`, title: '', snippet: '' });
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch { break; }
  }

  logger.info({ found: results.length }, 'grupodezap.com.br results');
  return { results };
}

/**
 * Scrape linkdegrupo.com.br - Brazilian WhatsApp group directory.
 */
export async function scrapeLinkdeGrupo(): Promise<{ results: GoogleSearchResult[] }> {
  const results: GoogleSearchResult[] = [];
  const seen = new Set<string>();
  const categories = ['amizade', 'vendas', 'marketing', 'emprego', 'noticias', 'esportes', 'jogos', 'educacao', 'tecnologia', 'entretenimento'];

  for (const cat of categories) {
    try {
      const url = `https://linkdegrupo.com.br/categoria/${cat}/`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const html = await res.text();

      const matches = html.matchAll(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9]{10,25})/g);
      for (const match of matches) {
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          results.push({ inviteCode: match[1], inviteLink: `https://chat.whatsapp.com/${match[1]}`, title: '', snippet: '' });
        }
      }
      await new Promise(r => setTimeout(r, 800));
    } catch { continue; }
  }

  logger.info({ found: results.length }, 'linkdegrupo.com.br results');
  return { results };
}

/**
 * Auto-classify a group into a niche based on its title and description.
 */
export function classifyNiche(title: string, description: string = ''): string {
  const text = `${title} ${description}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  let bestNiche = 'geral';
  let bestScore = 0;

  for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
    if (niche === 'geral') continue; // fallback, check last

    let score = 0;
    for (const kw of keywords) {
      const normalizedKw = kw.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (text.includes(normalizedKw)) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestNiche = niche;
    }
  }

  return bestNiche;
}
