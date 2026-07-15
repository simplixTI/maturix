import { getDb } from '../../database/client.js';
import { PROXY } from '../../config/constants.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('proxy-manager');

export class ProxyManager {
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.healthCheckInterval = setInterval(
      () => this.checkAllProxies(),
      PROXY.HEALTH_CHECK_INTERVAL_MS
    );
    logger.info('Proxy health checks started');
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Ensure an account has a healthy proxy. Idempotent:
   *  - if the account already has a healthy proxy, keeps it;
   *  - otherwise picks the best available healthy proxy that is still under
   *    MAX_ACCOUNTS_PER_PROXY, prioritizing MOBILE > RESIDENTIAL > DATACENTER,
   *    then least-loaded, then lowest latency.
   * Returns the assigned proxyId, or null if no proxy is available.
   */
  async assignProxy(accountId: string): Promise<string | null> {
    const db = getDb();

    const account = await db.account.findUnique({
      where: { id: accountId },
      include: { proxy: true },
    });
    // Already has a healthy proxy -> respect it (manual choice / prior assignment)
    if (account?.proxy?.isHealthy) {
      return account.proxyId ?? null;
    }

    // Only assign proxies that have actually PASSED a health check
    // (lastCheckedAt set). A freshly-added proxy defaults to isHealthy=true
    // but is unverified — assigning it can silently break the WhatsApp
    // connection (no QR). Verified-only keeps connections reliable.
    // Multi-tenant: only assign proxies from THIS account's owner pool, so an
    // operator's numbers never go out through another operator's proxies.
    const proxies = await db.proxy.findMany({
      where: { isHealthy: true, lastCheckedAt: { not: null }, ownerId: account?.ownerId ?? null },
      include: { _count: { select: { assignedAccounts: true } } },
    });

    const typeRank: Record<string, number> = { MOBILE: 0, RESIDENTIAL: 1, DATACENTER: 2 };
    const chosen = proxies
      .filter((p) => p._count.assignedAccounts < PROXY.MAX_ACCOUNTS_PER_PROXY)
      .sort(
        (a, b) =>
          (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9) ||
          a._count.assignedAccounts - b._count.assignedAccounts ||
          (a.responseTimeMs ?? 99999) - (b.responseTimeMs ?? 99999)
      )[0];

    if (!chosen) {
      logger.warn({ accountId }, 'No healthy proxy available under capacity');
      return null;
    }

    await db.account.update({
      where: { id: accountId },
      data: { proxyId: chosen.id },
    });

    logger.info({ accountId, proxyId: chosen.id, host: chosen.host }, 'Proxy assigned');
    return chosen.id;
  }

  async addProxy(data: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    protocol?: 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5';
    type?: 'RESIDENTIAL' | 'MOBILE' | 'DATACENTER';
  }, ownerId?: string): Promise<string> {
    const db = getDb();
    const proxy = await db.proxy.create({
      data: {
        host: data.host,
        port: data.port,
        username: data.username,
        password: data.password,
        protocol: data.protocol ?? 'HTTP',
        type: data.type ?? 'RESIDENTIAL',
        ownerId: ownerId ?? null,
      },
    });
    return proxy.id;
  }

  async bulkImport(lines: string[], ownerId?: string): Promise<number> {
    let imported = 0;
    for (const raw of lines) {
      const parsed = ProxyManager.parseProxyLine(raw);
      if (!parsed) continue;
      try {
        await this.addProxy(parsed, ownerId);
        imported++;
      } catch (err) {
        logger.warn({ line: raw, err }, 'Failed to import proxy');
      }
    }
    return imported;
  }

  /**
   * Parse a single proxy line in any of these formats:
   *   host:port
   *   host:port:user:pass
   *   user:pass@host:port
   *   protocol://host:port
   *   protocol://user:pass@host:port
   * Protocol is detected from the scheme (http/https/socks4/socks5), default HTTP.
   */
  static parseProxyLine(raw: string): {
    host: string;
    port: number;
    username?: string;
    password?: string;
    protocol: 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5';
  } | null {
    let line = raw.trim();
    if (!line || line.startsWith('#')) return null;

    let protocol: 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5' = 'HTTP';

    // Scheme prefix, e.g. socks5://
    const schemeMatch = line.match(/^([a-zA-Z0-9]+):\/\//);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toUpperCase();
      if (scheme === 'HTTP' || scheme === 'HTTPS' || scheme === 'SOCKS4' || scheme === 'SOCKS5') {
        protocol = scheme;
      } else if (scheme === 'SOCKS') {
        protocol = 'SOCKS5';
      }
      line = line.slice(schemeMatch[0].length);
    }

    let username: string | undefined;
    let password: string | undefined;
    let hostPort = line;

    // user:pass@host:port
    if (line.includes('@')) {
      const [creds, hp] = line.split('@');
      hostPort = hp;
      const ci = creds.indexOf(':');
      if (ci >= 0) {
        username = creds.slice(0, ci);
        password = creds.slice(ci + 1);
      } else {
        username = creds;
      }
    }

    const segs = hostPort.split(':');
    if (segs.length < 2) return null;

    const host = segs[0];
    const port = parseInt(segs[1], 10);
    if (!host || isNaN(port)) return null;

    // host:port:user:pass  (only when creds weren't already parsed via @)
    if (username === undefined && segs.length >= 4) {
      username = segs[2];
      password = segs[3];
    }

    return { host, port, username, password, protocol };
  }

  async checkAllProxies(): Promise<void> {
    const db = getDb();
    const proxies = await db.proxy.findMany();
    for (const proxy of proxies) {
      await this.applyCheck(proxy);
    }
  }

  /** Verify a single proxy by id (used right after a proxy is added). */
  async checkProxyById(id: string): Promise<void> {
    const db = getDb();
    const proxy = await db.proxy.findUnique({ where: { id } });
    if (proxy) await this.applyCheck(proxy);
  }

  /**
   * For brand-new (unchecked) proxies: a single failure shouldn't immediately
   * flip a never-tested proxy — but we DO record lastCheckedAt so the
   * verified-only assignment logic can consider it once it passes.
   */
  private async applyCheck(proxy: {
    id: string; host: string; port: number; username?: string | null;
    password?: string | null; protocol: string; failCount: number; isHealthy: boolean;
  }): Promise<void> {
    const db = getDb();
    const result = await this.checkProxy(proxy);
    const newFailCount = result.ok ? 0 : proxy.failCount + 1;
    const shouldMarkUnhealthy = newFailCount >= PROXY.MAX_FAIL_COUNT;

    await db.proxy.update({
      where: { id: proxy.id },
      data: {
        isHealthy: result.ok ? true : !shouldMarkUnhealthy,
        failCount: newFailCount,
        lastCheckedAt: new Date(),
        responseTimeMs: result.ok ? result.latencyMs : null,
      },
    });

    logger.info({ host: proxy.host, ok: result.ok, latencyMs: result.latencyMs }, 'Proxy check result');

    if (shouldMarkUnhealthy && proxy.isHealthy) {
      logger.warn({ proxyId: proxy.id, host: proxy.host }, 'Proxy marked unhealthy');
      await db.alertLog.create({
        data: {
          type: 'PROXY_FAILURE',
          severity: 'WARNING',
          message: `Proxy ${proxy.host}:${proxy.port} marcado como instável após ${PROXY.MAX_FAIL_COUNT} falhas`,
          metadata: { proxyId: proxy.id },
        },
      });
    }
  }

  private async checkProxy(proxy: { host: string; port: number; username?: string | null; password?: string | null; protocol: string }): Promise<{ ok: boolean; latencyMs: number }> {
    try {
      // Build the proxy URL EXACTLY like the live Baileys connection
      // (SessionManager.createProxyAgent) so the health check exercises the same
      // path: socks5h (remote DNS, so the residential exit resolves the target —
      // avoids the VPS resolving WhatsApp to a geo-mismatched IP) and URL-encoded
      // credentials. A mismatch here marks working proxies as "unstable".
      const auth = proxy.username
        ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
        : '';
      const scheme =
        proxy.protocol === 'SOCKS5' ? 'socks5h'
        : proxy.protocol === 'SOCKS4' ? 'socks4'
        : proxy.protocol.toLowerCase();
      const proxyUrl = `${scheme}://${auth}${proxy.host}:${proxy.port}`;

      let agent: any;
      if (proxy.protocol === 'SOCKS5' || proxy.protocol === 'SOCKS4') {
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        agent = new SocksProxyAgent(proxyUrl);
      } else {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        agent = new HttpsProxyAgent(proxyUrl);
      }

      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROXY.HEALTH_CHECK_TIMEOUT_MS);

      const { default: https } = await import('node:https');
      return new Promise<{ ok: boolean; latencyMs: number }>((resolve) => {
        const req = https.get('https://web.whatsapp.com', { agent, signal: controller.signal }, (res) => {
          clearTimeout(timeout);
          const latencyMs = Date.now() - start;
          resolve({ ok: res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301, latencyMs });
          res.resume();
        });
        req.on('error', () => {
          clearTimeout(timeout);
          resolve({ ok: false, latencyMs: Date.now() - start });
        });
      });
    } catch {
      return { ok: false, latencyMs: 0 };
    }
  }
}
