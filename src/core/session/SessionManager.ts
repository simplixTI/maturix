import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
} from '@whiskeysockets/baileys';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { Boom } from '@hapi/boom';
import pLimit from 'p-limit';
import { EventEmitter } from 'eventemitter3';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getDb } from '../../database/client.js';
import { createEnrichedAlert } from '../../services/alertLog.js';
import { getProtectionSettings } from '../../config/protectionSettings.js';
import { SessionHealth } from './SessionHealth.js';
import { getStealthSocketConfig, rampPresenceAfterConnect } from '../antiban/StealthConnect.js';
import { ReconnectThrottle } from '../antiban/ReconnectThrottle.js';
import { createChildLogger } from '../../utils/logger.js';
import { sleep } from '../../utils/gaussian.js';
import { SESSION } from '../../config/constants.js';
import type { Proxy } from '@prisma/client';

const logger = createChildLogger('session-manager');

// After this many failed reconnect attempts through a proxy, drop the proxy and
// recover on a direct connection so a bad proxy never bricks a number.
const PROXY_FALLBACK_ATTEMPTS = 4;

export interface SessionEvents {
  'session:connected': (accountId: string) => void;
  'session:disconnected': (accountId: string, reason: string) => void;
  'session:banned': (accountId: string) => void;
  'session:qr': (accountId: string, qr: string) => void;
  'session:pairing-code': (accountId: string, code: string) => void;
  'message:received': (accountId: string, msg: any) => void;
  'call:rejected': (accountId: string, fromJid: string, isVideo: boolean) => void;
}

export class SessionManager extends EventEmitter<SessionEvents> {
  private sockets = new Map<string, WASocket>();
  // Account IDs whose socket has reached the 'open' state (truly connected, not
  // merely connecting). Authoritative source for reconciling the DB status when
  // a late 'close' from a replaced socket races ahead of 'open' and wrongly
  // leaves the account marked DISCONNECTED while it is in fact sending.
  private openSockets = new Set<string>();
  // Accounts in a manual-reconnect attempt: try existing creds first, and ONLY
  // if that attempt hits loggedOut (401, dead creds) do we wipe + re-pair (QR).
  // Cleared on the next 'open' (reconnect succeeded with the existing creds).
  private rePairOnLogout = new Set<string>();
  // Which proxy the CURRENTLY-OPEN session was created with (null = direct).
  private sessionProxyId = new Map<string, string | null>();
  private connectionLimit = pLimit(SESSION.MAX_CONCURRENT_CONNECTIONS);
  private reconnectAttempts = new Map<string, number>();
  private reconnectThrottle = new ReconnectThrottle();
  private sessionHealth = new SessionHealth();
  // Timers that clear the reconnect backoff only after a connection proves stable.
  private stableTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // A connection must stay open this long before we consider it healthy and
  // reset the backoff counter. Shorter-lived opens are flaps (e.g. the number is
  // connected elsewhere → connectionReplaced) and must keep the backoff growing.
  private readonly STABLE_CONNECTION_MS = 45000;
  // Track which accounts are in the initial QR pairing phase
  // so we don't reconnect on QR rotation closes
  private pairingSessions = new Map<string, { qrCount: number; credsRegistered: boolean }>();

  getSocketIds(): string[] {
    return Array.from(this.sockets.keys());
  }

  getSocket(accountId: string): WASocket | undefined {
    return this.sockets.get(accountId);
  }

  isConnected(accountId: string): boolean {
    return this.sockets.has(accountId);
  }

  async startAll(): Promise<void> {
    const db = getDb();
    // Reconnect ALL accounts that have saved credentials (any status except BANNED)
    const accounts = await db.account.findMany({
      where: { status: { not: 'BANNED' } },
      include: { proxy: true },
    });

    logger.info({ count: accounts.length }, 'Auto-reconnecting all accounts on startup');

    for (let i = 0; i < accounts.length; i += SESSION.RECONNECT_BATCH_SIZE) {
      const batch = accounts.slice(i, i + SESSION.RECONNECT_BATCH_SIZE);
      await Promise.all(
        batch.map(account =>
          this.connectionLimit(() =>
            this.createSession(account.id, account.proxy).catch(err => {
              logger.warn({ accountId: account.id, err: err?.message }, 'Failed to reconnect on startup, will retry');
            })
          )
        )
      );
      if (i + SESSION.RECONNECT_BATCH_SIZE < accounts.length) {
        await sleep(SESSION.RECONNECT_BATCH_DELAY_MS);
      }
    }
  }

  async createSession(accountId: string, proxy?: Proxy | null): Promise<void> {
    try {
      const sessionsDir = join(process.cwd(), 'sessions', accountId);
      await mkdir(sessionsDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(sessionsDir);
      const { version } = await fetchLatestBaileysVersion();

      const agent = proxy ? this.createProxyAgent(proxy, accountId) : undefined;

      // Determine if this is a fresh pairing (no creds yet) vs a reconnect of an
      // already-paired number. Baileys 7 leaves creds.registered=false even after
      // a successful pairing — the reliable "already paired" signal is a populated
      // creds.me (the account's own JID). Relying on registered alone made EVERY
      // reconnect look like a fresh QR pairing, so a paired number that dropped
      // before 'open' was treated as an unscanned QR and never auto-reconnected
      // (stuck DISCONNECTED while still linked on the phone).
      const isRegistered = !!state.creds.registered || !!state.creds.me?.id;
      if (!isRegistered) {
        this.pairingSessions.set(accountId, { qrCount: 0, credsRegistered: false });
        logger.info({ accountId }, 'Starting fresh pairing session (QR mode)');
      } else {
        // Existing creds - not a pairing session
        this.pairingSessions.delete(accountId);
      }

      const stealthConfig = getStealthSocketConfig(accountId);
      const sock = makeWASocket({
        ...stealthConfig,
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger as any),
        },
        agent: agent as any,
        fetchAgent: agent as any,
        printQRInTerminal: false,
        getMessage: async () => undefined,
      });

      this.sockets.set(accountId, sock);
      this.sessionProxyId.set(accountId, proxy?.id ?? null);
      this.setupEventHandlers(accountId, sock, saveCreds, proxy);

      logger.info({ accountId, isRegistered }, 'Session created');
    } catch (err) {
      logger.error({ err, accountId }, 'Failed to create session');
      await this.handleReconnect(accountId, proxy);
    }
  }

  private setupEventHandlers(
    accountId: string,
    sock: WASocket,
    saveCreds: () => Promise<void>,
    proxy?: Proxy | null
  ): void {
    // Wrap saveCreds to also track when creds become registered
    const wrappedSaveCreds = async () => {
      await saveCreds();
      // After creds are saved, mark pairing session as having creds
      const pairingState = this.pairingSessions.get(accountId);
      if (pairingState) {
        pairingState.credsRegistered = true;
        logger.info({ accountId }, 'Credentials registered during pairing');
      }
    };

    sock.ev.on('creds.update', wrappedSaveCreds);

    // Auto-reject incoming calls. Receiving calls on warming numbers and
    // letting them ring/accumulate as missed calls looks unnatural; we reject
    // every incoming offer immediately and log it for the dashboard.
    sock.ev.on('call', async (calls: any[]) => {
      const shouldReject = getProtectionSettings().rejectCalls;
      for (const call of calls) {
        if (call?.status !== 'offer') continue;
        const fromJid: string = call.from || call.chatId || '';
        const isVideo = !!call.isVideo;
        if (shouldReject) {
          try {
            await sock.rejectCall(call.id, fromJid);
          } catch (err: any) {
            logger.debug({ accountId, err: err?.message }, 'rejectCall failed');
          }
        }
        const fromPhone = fromJid.split('@')[0].split(':')[0] || null;
        try {
          await getDb().callLog.create({
            data: { accountId, fromJid, fromPhone, isVideo, action: shouldReject ? 'rejected' : 'received' },
          });
          await getDb().account.update({
            where: { id: accountId },
            data: { lastActiveAt: new Date() },
          }).catch(() => {});
        } catch (err: any) {
          logger.debug({ accountId, err: err?.message }, 'Failed to log call');
        }
        logger.info({ accountId, from: fromPhone, isVideo, rejected: shouldReject },
          shouldReject ? 'Incoming call auto-rejected' : 'Incoming call (rejection off — left ringing)');
        if (shouldReject) this.emit('call:rejected', accountId, fromJid, isVideo);
      }
    });

    sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      // --- QR Code Handling ---
      // Baileys rotates QR every ~20 seconds. Each new QR fires this event.
      // We must forward EVERY QR to the frontend, not just the first one.
      if (qr) {
        const pairingState = this.pairingSessions.get(accountId);
        if (pairingState) {
          pairingState.qrCount++;
          logger.info({ accountId, qrCount: pairingState.qrCount }, 'QR code generated');
        }
        this.emit('session:qr', accountId, qr);
      }

      // --- Connection Opened ---
      if (connection === 'open') {
        // Pairing complete - clean up pairing state
        this.pairingSessions.delete(accountId);
        this.openSockets.add(accountId);
        this.rePairOnLogout.delete(accountId); // reconnected with existing creds — no re-pair needed
        this.reconnectThrottle.onReconnect(accountId);
        await this.markConnected(accountId);
        this.emit('session:connected', accountId);
        // Stealth: delay presence ramp after connect
        rampPresenceAfterConnect(sock).catch(() => {});

        // Reset the backoff ONLY after the connection proves stable. If it drops
        // before then (a flap), the counter keeps growing so reconnects slow down
        // instead of hammering every ~1s.
        const prevTimer = this.stableTimers.get(accountId);
        if (prevTimer) clearTimeout(prevTimer);
        this.stableTimers.set(accountId, setTimeout(() => {
          this.reconnectAttempts.set(accountId, 0);
          this.stableTimers.delete(accountId);
        }, this.STABLE_CONNECTION_MS));
      }

      // --- Connection Closed ---
      if (connection === 'close') {
        // Connection dropped before proving stable → cancel the backoff reset so
        // the attempt counter keeps growing (exponential backoff actually engages).
        const stable = this.stableTimers.get(accountId);
        if (stable) { clearTimeout(stable); this.stableTimers.delete(accountId); }
        this.sockets.delete(accountId);
        this.openSockets.delete(accountId);
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const reason = DisconnectReason[statusCode as number] ?? `unknown-${statusCode}`;

        logger.warn({ accountId, statusCode, reason }, 'Session disconnected');

        // --- CASE 1: Logged out (401) or Forbidden (403) — almost always a BAN ---
        // On a warming fleet a 401 is almost always a ban, and 403 (forbidden) is
        // WhatsApp explicitly blocking the account — an unambiguous ban. When
        // banOnLogout is on (default), surface EITHER as a BAN (mark BANNED +
        // pause + BAN_DETECTED alert) instead of a silent "disconnected", so the
        // dashboard actually shows what happened.
        const isLoggedOut = statusCode === DisconnectReason.loggedOut; // 401
        const isForbidden = statusCode === DisconnectReason.forbidden; // 403
        if (isLoggedOut || isForbidden) {
          this.pairingSessions.delete(accountId);
          const stableTimer = this.stableTimers.get(accountId);
          if (stableTimer) { clearTimeout(stableTimer); this.stableTimers.delete(accountId); }

          // Manual reconnect that hit dead creds (401 ONLY) → safe to wipe and
          // re-pair with a fresh QR. A 403 ban can't be fixed by re-pairing the
          // same number, so it always falls through to the ban path below.
          if (isLoggedOut && this.rePairOnLogout.has(accountId)) {
            this.rePairOnLogout.delete(accountId);
            logger.warn({ accountId }, 'Manual reconnect found dead creds → wiping and re-pairing (fresh QR)');
            const sessionsDir = join(process.cwd(), 'sessions', accountId);
            await rm(sessionsDir, { recursive: true, force: true }).catch(() => {});
            await this.connectionLimit(() => this.createSession(accountId, null));
            return;
          }
          this.rePairOnLogout.delete(accountId);

          if (getProtectionSettings().banOnLogout) {
            logger.warn({ accountId, statusCode, reason }, 'Forbidden/logout (403/401) → treating as BAN');
            await this.markBanned(accountId);
            this.emit('session:banned', accountId);
          } else {
            const r = isForbidden ? 'forbidden' : 'logged_out';
            await this.markDisconnected(accountId, r);
            this.emit('session:disconnected', accountId, r);
          }
          // Do not auto-reconnect - requires manual re-link / it's banned.
          return;
        }

        // --- CASE 2: Initial pairing phase (QR not scanned yet) ---
        // During QR display, Baileys may close the socket for QR rotation
        // or timeout. We must NOT reconnect here -- the socket handles
        // its own QR rotation internally. Only reconnect if:
        //   a) Creds were saved (user scanned QR) and server requests restart
        //   b) QR timed out completely (statusCode undefined or 408/428)
        const pairingState = this.pairingSessions.get(accountId);
        if (pairingState) {
          if (pairingState.credsRegistered) {
            // User scanned QR, creds exist -- this is the expected
            // post-scan forced disconnect. Reconnect to complete auth.
            logger.info({ accountId }, 'Post-QR-scan disconnect, reconnecting with credentials');
            this.pairingSessions.delete(accountId);
            // Short delay then reconnect -- no exponential backoff needed
            await sleep(1000);
            await this.connectionLimit(() => this.createSession(accountId, proxy));
          } else {
            // QR phase ended without scan (timeout, error, etc.)
            // Do NOT reconnect automatically -- let frontend handle retry
            logger.info({ accountId, statusCode, qrCount: pairingState.qrCount },
              'Pairing session closed without scan (QR expired or error)');
            this.pairingSessions.delete(accountId);
            await this.markDisconnected(accountId, 'qr_expired');
            this.emit('session:disconnected', accountId, 'qr_expired');
          }
          return;
        }

        // --- CASE 3: Normal established session disconnect ---
        await this.markDisconnected(accountId, reason);
        this.emit('session:disconnected', accountId, reason);

        // Disconnect storm detection - log only, NEVER auto-pause
        const isStorm = this.sessionHealth.recordDisconnect(accountId);
        if (isStorm) {
          logger.warn({ accountId }, 'Disconnect storm detected - NOT pausing (user controls pause)');
        }

        // Auto-reconnect for recoverable disconnect reasons
        const accountProxy = proxy ?? await this.getAccountProxy(accountId);
        await this.handleReconnect(accountId, accountProxy);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          this.emit('message:received', accountId, msg);
        }
      }
    });
  }

  async requestPairingCode(accountId: string, phoneNumber: string): Promise<string | null> {
    const sock = this.sockets.get(accountId);
    if (!sock) return null;

    try {
      // Phone must be E.164 without + (e.g. 5511999999999)
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const code = await sock.requestPairingCode(cleanPhone);
      this.emit('session:pairing-code', accountId, code);
      logger.info({ accountId, code }, 'Pairing code generated');
      return code;
    } catch (err) {
      logger.error({ err, accountId }, 'Failed to generate pairing code');
      return null;
    }
  }

  private async handleReconnect(accountId: string, proxy?: Proxy | null): Promise<void> {
    const attempts = (this.reconnectAttempts.get(accountId) ?? 0) + 1;
    this.reconnectAttempts.set(accountId, attempts);

    if (attempts >= SESSION.MAX_RECONNECT_ATTEMPTS) {
      logger.error({ accountId, attempts }, 'Max reconnect attempts reached - stopping reconnect');
      await this.markDisconnected(accountId, 'max_reconnect_attempts');
      this.emit('session:disconnected', accountId, 'max_reconnect_attempts');
      return;
    }

    // Proxy fallback: a residential proxy that keeps failing must not keep the
    // number offline. After a few failed attempts through a proxy, drop it and
    // recover on a direct connection (operator is alerted to fix/replace it).
    let effectiveProxy = proxy;
    if (proxy && attempts >= PROXY_FALLBACK_ATTEMPTS) {
      logger.warn({ accountId, proxyId: proxy.id, attempts }, 'Proxy failing repeatedly — falling back to direct');
      await getDb().account.update({ where: { id: accountId }, data: { proxyId: null } }).catch(() => {});
      await createEnrichedAlert({
        accountId,
        type: 'PROXY_FAILURE',
        severity: 'WARNING',
        message: `Proxy ${proxy.host}:${proxy.port} falhou ${attempts}x — número voltou para conexão direta`,
        metadata: { proxyId: proxy.id },
      });
      effectiveProxy = null;
      this.reconnectAttempts.set(accountId, 0); // fresh attempts on the direct path
    }

    const baseDelay = Math.min(
      SESSION.RECONNECT_BASE_DELAY_MS * Math.pow(2, attempts - 1),
      SESSION.RECONNECT_MAX_DELAY_MS
    );
    const jitter = Math.random() * baseDelay * SESSION.RECONNECT_JITTER_FACTOR;
    const delay = Math.round(baseDelay + jitter);

    logger.info({ accountId, attempts, delayMs: delay }, 'Scheduling reconnect');
    await sleep(delay);

    await this.connectionLimit(() => this.createSession(accountId, effectiveProxy));
  }

  private createProxyAgent(proxy: Proxy, accountId?: string): HttpsProxyAgent<string> | SocksProxyAgent {
    // Use the credentials EXACTLY as stored. Do NOT auto-append a
    // "-session-XXXX" sticky-session suffix: that format is provider-specific
    // and breaks authentication for providers that don't use it (e.g. Decodo /
    // Smartproxy), which makes the WhatsApp socket fail silently with no QR.
    // If you want sticky sessions, encode them in the username per your
    // provider's docs when adding the proxy.
    const username = (proxy.username || '').trim();
    const password = proxy.password || '';
    const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
    // Use socks5h (remote DNS) for SOCKS5 so the exit node resolves the target —
    // required for residential proxies + WhatsApp (avoids DNS leaks / geo mismatch).
    const scheme =
      proxy.protocol === 'SOCKS5' ? 'socks5h'
      : proxy.protocol === 'SOCKS4' ? 'socks4'
      : proxy.protocol.toLowerCase();
    const url = `${scheme}://${auth}${proxy.host}:${proxy.port}`;

    logger.debug({ accountId, proxyHost: proxy.host, hasAuth: !!username }, 'Proxy agent created');

    if (proxy.protocol === 'SOCKS5' || proxy.protocol === 'SOCKS4') {
      return new SocksProxyAgent(url);
    }
    return new HttpsProxyAgent(url);
  }

  private async markConnected(accountId: string): Promise<void> {
    const db = getDb();
    await db.account.update({
      where: { id: accountId },
      data: {
        status: 'CONNECTED',
        lastActiveAt: new Date(),
      },
    });
    await db.session.updateMany({
      where: { accountId },
      data: {
        isActive: true,
        lastConnected: new Date(),
        reconnectAttempts: 0,
      },
    });
  }

  private async markDisconnected(accountId: string, reason: string): Promise<void> {
    const db = getDb();
    await db.account.update({
      where: { id: accountId },
      data: { status: 'DISCONNECTED' },
    });
    await db.session.updateMany({
      where: { accountId },
      data: {
        isActive: false,
        lastDisconnected: new Date(),
        disconnectReason: reason,
      },
    });
  }

  private async markBanned(accountId: string): Promise<void> {
    const db = getDb();
    await db.account.update({
      where: { id: accountId },
      data: {
        status: 'BANNED',
        banRisk: 'CRITICAL',
        isPaused: true,
        pauseReason: 'Account banned by WhatsApp',
      },
    });
    await createEnrichedAlert({
      accountId,
      type: 'BAN_DETECTED',
      severity: 'CRITICAL',
      message: 'Número banido pelo WhatsApp',
    });
  }

  private async pauseAccount(accountId: string, reason: string): Promise<void> {
    const db = getDb();
    await db.account.update({
      where: { id: accountId },
      data: { isPaused: true, pauseReason: reason, status: 'PAUSED' },
    });
  }

  /**
   * If the account has a proxy assigned but the LIVE session isn't on it (e.g. it
   * paired DIRECT for QR reliability), reconnect through the assigned proxy. Lets
   * a freshly-paired number move off the (datacenter) direct IP onto its own
   * residential proxy automatically, shortly after connecting. No-op if already
   * on the proxy or if there's no proxy / no live socket.
   */
  async migrateToProxy(accountId: string): Promise<void> {
    const proxy = await this.getAccountProxy(accountId);
    if (!proxy) return;
    if (this.sessionProxyId.get(accountId) === proxy.id) return; // already on it
    const sock = this.sockets.get(accountId);
    if (!sock) return;
    logger.info({ accountId, proxyId: proxy.id }, 'Migrating live connection onto its proxy');
    // Closing the socket triggers the close handler → handleReconnect, which now
    // uses the assigned proxy (getAccountProxy).
    try { sock.end(undefined); } catch {}
  }

  private async getAccountProxy(accountId: string): Promise<Proxy | null> {
    const db = getDb();
    const account = await db.account.findUnique({
      where: { id: accountId },
      include: { proxy: true },
    });
    return account?.proxy ?? null;
  }

  async disconnectSession(accountId: string): Promise<void> {
    const sock = this.sockets.get(accountId);
    if (sock) {
      sock.end(undefined);
      this.sockets.delete(accountId);
    }
    this.openSockets.delete(accountId);
  }

  /**
   * Manual reconnect from the dashboard. Tries to reconnect with the EXISTING
   * credentials first — no QR, no data loss — which is the right thing when the
   * device is still linked on WhatsApp and we merely lost our socket. Only if
   * that attempt comes back loggedOut (401, genuinely dead creds) do we wipe and
   * fall back to a fresh QR (handled in the 'close' handler via rePairOnLogout).
   * If there are NO creds at all (e.g. a previously orphaned number), createSession
   * naturally enters QR mode. NEVER wipes valid creds. DIRECT — the proxy is
   * re-attached automatically after the number connects.
   */
  async reconnectSession(accountId: string): Promise<void> {
    // Tear down any live/lingering socket first so it can't fire stale events.
    const sock = this.sockets.get(accountId);
    if (sock) {
      try { sock.end(undefined); } catch { /* already closed */ }
    }
    this.sockets.delete(accountId);
    this.openSockets.delete(accountId);
    this.sessionProxyId.delete(accountId);
    this.pairingSessions.delete(accountId);
    const stableTimer = this.stableTimers.get(accountId);
    if (stableTimer) { clearTimeout(stableTimer); this.stableTimers.delete(accountId); }
    this.reconnectAttempts.delete(accountId); // manual attempt — reset backoff

    // Arm the dead-creds fallback, then reconnect WITH existing creds.
    this.rePairOnLogout.add(accountId);
    logger.info({ accountId }, 'Manual reconnect: trying existing credentials first');
    await this.createSession(accountId, null);
  }

  async disconnectAll(): Promise<void> {
    for (const [accountId, sock] of this.sockets) {
      sock.end(undefined);
      logger.info({ accountId }, 'Session closed');
    }
    this.sockets.clear();
  }

  getActiveCount(): number {
    return this.sockets.size;
  }

  /**
   * Self-heal the DB status against the live socket state. A late 'close' from a
   * replaced socket can land after 'open' and wrongly leave an account marked
   * DISCONNECTED while its socket is actually open and sending. This re-asserts
   * CONNECTED for every account whose socket has truly reached 'open'. Only
   * upgrades transient states — never touches BANNED or PAUSED (operator/safety
   * decisions). Runs periodically from index.ts.
   */
  async reconcileStatuses(): Promise<void> {
    if (this.openSockets.size === 0) return;
    const db = getDb();
    const ids = [...this.openSockets];
    const stale = await db.account.findMany({
      where: { id: { in: ids }, status: { in: ['DISCONNECTED', 'CONNECTING', 'PENDING'] } },
      select: { id: true, status: true },
    });
    for (const a of stale) {
      await db.account.update({
        where: { id: a.id },
        data: { status: 'CONNECTED', lastActiveAt: new Date() },
      });
      logger.warn({ accountId: a.id, was: a.status }, 'Reconciled status: socket open → CONNECTED');
    }
  }
}
