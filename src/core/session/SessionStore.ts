import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { proto } from '@whiskeysockets/baileys';
import { initAuthCreds } from '@whiskeysockets/baileys';
import { getDb } from '../../database/client.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('session-store');

interface StoredAuthState {
  creds: any;
  keys: Record<string, Record<string, any>>;
}

export async function useDBAuthState(accountId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const db = getDb();

  const session = await db.session.findFirst({
    where: { accountId },
    orderBy: { updatedAt: 'desc' },
  });

  let storedState: StoredAuthState | null = null;

  if (session?.authState) {
    try {
      const decrypted = decrypt(Buffer.from(session.authState));
      storedState = JSON.parse(decrypted.toString('utf-8'));
    } catch (err) {
      logger.warn({ accountId }, 'Failed to decrypt auth state, generating new creds');
    }
  }

  const creds = storedState?.creds
    ? Object.assign(initAuthCreds(), storedState.creds)
    : initAuthCreds();

  const keys: Record<string, Record<string, any>> = storedState?.keys ?? {};

  const saveCreds = async () => {
    const data: StoredAuthState = { creds, keys };
    const serialized = Buffer.from(JSON.stringify(data), 'utf-8');
    const encrypted = encrypt(serialized);

    await db.session.upsert({
      where: { id: session?.id ?? '' },
      create: {
        accountId,
        authState: new Uint8Array(encrypted),
        isActive: true,
      },
      update: {
        authState: new Uint8Array(encrypted),
        updatedAt: new Date(),
      },
    });
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: (type: keyof SignalDataTypeMap, ids: string[]) => {
        const typeKeys = keys[type] ?? {};
        const result: Record<string, any> = {};
        for (const id of ids) {
          if (typeKeys[id]) {
            let value = typeKeys[id];
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }
        }
        return result;
      },
      set: (data: Record<string, Record<string, any>>) => {
        for (const category of Object.keys(data)) {
          if (!keys[category]) keys[category] = {};
          for (const id of Object.keys(data[category])) {
            const value = data[category][id];
            if (value) {
              keys[category][id] = value;
            } else {
              delete keys[category][id];
            }
          }
        }
        saveCreds().catch(err =>
          logger.error({ err, accountId }, 'Failed to save keys')
        );
      },
    },
  };

  return { state, saveCreds };
}
