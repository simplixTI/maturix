import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import type { WASocket } from '@whiskeysockets/baileys';
import { createChildLogger } from '../../utils/logger.js';
import { accountUnit } from '../../utils/accountIdentity.js';
import { getWarmupFeatures } from '../../config/warmupFeatures.js';

const logger = createChildLogger('profile-maturation');

// Realistic Brazilian display names and WhatsApp "recado" (about) texts. A brand
// new number with no name, photo or bio looks fake — real people fill these in
// over the first days, so we mature the profile gradually instead of all at once.
const FIRST_NAMES = [
  'Lucas', 'Ana', 'Pedro', 'Mariana', 'Gabriel', 'Júlia', 'Rafael', 'Beatriz',
  'Thiago', 'Larissa', 'Bruno', 'Camila', 'Felipe', 'Amanda', 'Mateus', 'Letícia',
  'Gustavo', 'Carol', 'Diego', 'Fernanda', 'Rodrigo', 'Patrícia', 'André', 'Vanessa',
  'João', 'Maria', 'Carlos', 'Juliana', 'Marcos', 'Aline', 'Vinícius', 'Bianca',
  'Leonardo', 'Sabrina', 'Eduardo', 'Tatiane', 'Henrique', 'Priscila', 'Caio', 'Renata',
  'Davi', 'Isabela', 'Igor', 'Natália', 'Murilo', 'Jéssica', 'Ricardo', 'Débora',
];
const LAST_INITIALS = ['', '', '', ' S.', ' A.', ' M.', ' R.', ' O.', ' L.', ' C.', ' P.', ' F.'];

const BIOS = [
  'Disponível', 'Ocupado', 'Foco e fé', 'Bom dia ☀️', 'Deus é fiel 🙏',
  'Sem tempo irmão', 'Vivendo um dia de cada vez', 'Trabalhando 💼',
  'Família em primeiro lugar ❤️', 'Bora que bora', 'Gratidão 🙌',
  'Na correria', 'Paz ✌️', 'Simbora', 'Foco no objetivo 🎯', 'Só vem 2025',
  'Disponível apenas para chamadas', 'Ocupado(a)', 'Em reunião', 'No trabalho',
  'Carpe diem', 'Um dia de cada vez', 'Fé em Deus 🙏', 'Vivendo e aprendendo',
  'Bola pra frente ⚽', 'Positividade ✨', 'Café ☕ e foco', 'Vamos que vamos 🚀',
];

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

/** Stable display name for an account (seeded — consistent identity over time). */
export function plannedName(accountId: string): string {
  const first = FIRST_NAMES[Math.floor(accountUnit(accountId, 'name') * FIRST_NAMES.length)];
  const last = LAST_INITIALS[Math.floor(accountUnit(accountId, 'last') * LAST_INITIALS.length)];
  return `${first}${last}`;
}

/** Stable "about/recado" text for an account. `vary` rotates it over time. */
export function plannedBio(accountId: string, vary = 0): string {
  return BIOS[Math.floor(accountUnit(accountId, `bio${vary}`) * BIOS.length)];
}

interface ProfileState {
  name?: boolean;
  bio?: boolean;
  photo?: boolean;
  lastBioDay?: number;
}

/**
 * Gradually fills in name → bio → photo over the first days, then occasionally
 * refreshes the bio (people change their status text). Tracked in memory; a
 * restart may re-apply a step once, which is harmless. Names/bios are stable per
 * account (seeded) so a chip keeps a consistent identity.
 */
export class ProfileMaturation {
  private state: Record<string, ProfileState> = {};
  private loaded = false;
  private readonly file = join(process.cwd(), 'data', 'profile-state.json');

  /** Load persisted per-account profile progress so restarts don't re-apply
   * every step (or re-upload the avatar) on each boot. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.state = {};
    }
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify(this.state), 'utf8');
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'Failed to persist profile state');
    }
  }

  /**
   * Apply the planned identity right after a number connects: name → bio → photo
   * (photo from day 2). Idempotent — each step runs once (tracked + persisted),
   * so reconnects don't spam profile updates. Runs even when the warmup engine is
   * stopped, so a chip always gets a real profile. Spaced out so it's not a burst.
   */
  async applyOnConnect(sock: WASocket, accountId: string, day: number, mediaDir: string): Promise<void> {
    await this.ensureLoaded();
    const st = (this.state[accountId] ??= {});
    const feat = getWarmupFeatures();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      if (!st.name && feat.profileName) {
        await sock.updateProfileName(this.nameFor(accountId));
        st.name = true;
        await this.save();
        logger.info({ accountId }, 'Profile name applied on connect');
        await sleep(4000 + Math.random() * 6000);
      }
      if (!st.bio && feat.profileBio) {
        await sock.updateProfileStatus(this.bioFor(accountId));
        st.bio = true;
        st.lastBioDay = day;
        await this.save();
        logger.info({ accountId }, 'Profile bio applied on connect');
        await sleep(4000 + Math.random() * 6000);
      }
      if (!st.photo && day >= 2 && mediaDir && feat.profilePhoto) {
        const raw = await this.pickAvatar(mediaDir);
        if (raw && raw.length >= 1024) {
          const jid = sock.user?.id;
          if (jid) {
            await sock.updateProfilePicture(jid, await this.toSquareJpeg(raw));
            st.photo = true;
            await this.save();
            logger.info({ accountId }, 'Profile photo applied on connect');
          }
        }
      }
    } catch (err: any) {
      logger.warn({ accountId, err: err?.message }, 'applyOnConnect step failed (will retry next connect)');
    }
  }

  private nameFor(accountId: string): string {
    return plannedName(accountId);
  }

  private bioFor(accountId: string, vary = 0): string {
    return plannedBio(accountId, vary);
  }

  private async pickAvatar(mediaDir: string): Promise<Buffer | null> {
    for (const dir of ['avatars', 'images']) {
      try {
        const full = join(mediaDir, dir);
        const files = (await readdir(full)).filter((f) => IMAGE_EXT.includes(extname(f).toLowerCase()));
        if (files.length === 0) continue;
        const pick = files[Math.floor(Math.random() * files.length)];
        return await readFile(join(full, pick));
      } catch {
        continue;
      }
    }
    return null;
  }

  private async toSquareJpeg(buffer: Buffer): Promise<Buffer> {
    try {
      const sharp = (await import('sharp')).default as any;
      return await sharp(buffer).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
    } catch {
      return buffer;
    }
  }

  /**
   * Possibly perform ONE profile maturation step for this account this tick.
   * Low probability so updates spread out and the fleet doesn't change in unison.
   */
  async maybeMature(sock: WASocket, accountId: string, day: number, mediaDir: string): Promise<void> {
    if (Math.random() > 0.08) return; // ~8% per tick

    await this.ensureLoaded();
    const st = (this.state[accountId] ??= {});
    const feat = getWarmupFeatures();

    try {
      if (!st.name && feat.profileName) {
        await sock.updateProfileName(this.nameFor(accountId));
        st.name = true;
        await this.save();
        logger.debug({ accountId }, 'Profile name set');
        return;
      }
      if (!st.bio && feat.profileBio) {
        await sock.updateProfileStatus(this.bioFor(accountId));
        st.bio = true;
        st.lastBioDay = day;
        await this.save();
        logger.debug({ accountId }, 'Profile bio set');
        return;
      }
      if (!st.photo && day >= 2 && mediaDir && feat.profilePhoto) {
        const raw = await this.pickAvatar(mediaDir);
        if (raw && raw.length >= 1024) {
          const jid = sock.user?.id;
          if (jid) {
            await sock.updateProfilePicture(jid, await this.toSquareJpeg(raw));
            st.photo = true;
            await this.save();
            logger.debug({ accountId }, 'Profile photo set');
          }
        }
        return;
      }
      // Occasionally refresh the bio from day 5+ (people change their status).
      if (feat.profileBio && day >= 5 && (st.lastBioDay === undefined || day - st.lastBioDay >= 4) && Math.random() < 0.5) {
        await sock.updateProfileStatus(this.bioFor(accountId, day));
        st.lastBioDay = day;
        await this.save();
        logger.debug({ accountId }, 'Profile bio refreshed');
      }
    } catch (err: any) {
      logger.debug({ accountId, err: err?.message }, 'Profile maturation step failed');
    }
  }
}
