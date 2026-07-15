import type { WASocket } from '@whiskeysockets/baileys';
import { resolveSpintax } from './SpintaxParser.js';
import { createChildLogger } from '../../utils/logger.js';
import { getDb } from '../../database/client.js';
import { reserveDailySlot, releaseDailySlot } from '../warmup/DailyLimitGuard.js';

const logger = createChildLogger('group-warmer');

/**
 * Messages that look natural in group chats - short, casual, Portuguese slang.
 */
const GROUP_MESSAGES: string[] = [
  '{kkkkk|kkkk|hahaha|rsrsrs} {demais|mano|cara|vei}',
  '{bom dia|boa tarde|boa noite} {galera|pessoal|turma|gente} {🙏|☀️|🌙|👋}',
  '{concordo|pois é|exatamente|isso mesmo|vdd} {👍|💯}',
  '{que {massa|top|show|legal|dahora}|{muito|mt} {bom|foda|massa}} {🔥|💯|😎}',
  '{eita|opa|oxe|mds|nossa} {😂|😅|🤣}',
  '{alguém|galera} {viu isso|sabe|tá sabendo}?',
  '{mano|cara|vei} {que loucura|inacreditável|surreal} {😱|🤯|😳}',
  '{será|acho que|talvez} {sim|não|pode ser} {🤔|🧐}',
  '{boa|tmj|valeu|show} {👏|🙌|✌️}',
  '{tô de boa|suave|tranquilo|de boas} {😎|✌️|🤙}',
  '{quem|alguém} {topa|quer|bora|partiu}?',
  '{exato|certíssimo|é isso|faz sentido} {💯|✅}',
  '{tava pensando|pensei nisso|refletindo} {nisso|sobre isso|aqui}',
  '{gente|pessoal|galera}, {olha|vê} {isso|essa|esse}',
  '{quem mais|alguém mais} {concorda|pensa assim|acha isso}?',
  '{simm|siim|sss|s} {pode crer|com certeza|total}',
  '{não|nao|nn} {acredito|creio|acho|to acreditando} {nisso|nessa|nesse}',
  '{salve|fala|ei} {galera|povo|turma} {✌️|🤙}',
];

/**
 * Reactions commonly used in group chats
 */
const GROUP_REACTIONS = ['👍', '😂', '🔥', '❤️', '👏', '😍', '🤣', '💯', '😮', '🙏'];

/**
 * Send a casual message in a group.
 */
export async function sendGroupMessage(
  sock: WASocket,
  senderAccountId: string,
  groupJid: string,
): Promise<void> {
  const template = GROUP_MESSAGES[Math.floor(Math.random() * GROUP_MESSAGES.length)];
  const resolvedText = resolveSpintax(template);

  // Respect the hard daily cap before sending.
  if (!(await reserveDailySlot(senderAccountId))) return;

  try {
    await sock.sendMessage(groupJid, { text: resolvedText });
  } catch (err) {
    await releaseDailySlot(senderAccountId);
    throw err;
  }

  const db = getDb();
  await db.messageLog.create({
    data: {
      senderId: senderAccountId,
      receiverId: senderAccountId,
      messageType: 'TEXT',
      direction: 'OUTBOUND',
      spintaxOutput: `[group] ${resolvedText}`,
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  // Daily counter already incremented by the reservation above.

  logger.info({ accountId: senderAccountId, groupJid }, 'Group message sent');
}

/**
 * React to a message in a group.
 */
export async function reactToGroupMessage(
  sock: WASocket,
  senderAccountId: string,
  groupJid: string,
  messageKey: any,
): Promise<void> {
  const emoji = GROUP_REACTIONS[Math.floor(Math.random() * GROUP_REACTIONS.length)];

  await sock.sendMessage(groupJid, {
    react: { text: emoji, key: messageKey },
  });

  logger.debug({ accountId: senderAccountId, groupJid, emoji }, 'Reacted to group message');
}

/**
 * Get groups that this account is a member of.
 * Uses the groupMembership table + Baileys groupMetadata fallback.
 */
export async function getAccountGroups(
  sock: WASocket,
  accountId: string,
): Promise<string[]> {
  const db = getDb();

  // First try DB memberships
  const memberships = await db.groupMembership.findMany({
    where: { accountId, isActive: true },
    select: { groupJid: true },
  });

  if (memberships.length > 0) {
    return memberships.map(m => m.groupJid);
  }

  // Fallback: fetch from Baileys and cache
  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupJids = Object.keys(groups);

    // Cache in DB
    for (const jid of groupJids.slice(0, 20)) { // limit to 20 groups
      await db.groupMembership.upsert({
        where: {
          id: `${accountId}-${jid}`, // Will fail on first insert; handled below
        },
        create: {
          accountId,
          groupJid: jid,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      }).catch(() => {
        // If unique constraint fails, create without id
        return db.groupMembership.create({
          data: { accountId, groupJid: jid, isActive: true },
        }).catch(() => {}); // Ignore duplicates
      });
    }

    return groupJids;
  } catch (err: any) {
    logger.debug({ accountId, err: err.message }, 'Failed to fetch groups from Baileys');
    return [];
  }
}

/**
 * Perform a group warm-up action: send a message or react in a random group.
 */
export async function warmupGroupActivity(
  sock: WASocket,
  accountId: string,
): Promise<boolean> {
  const groups = await getAccountGroups(sock, accountId);
  if (groups.length === 0) return false;

  const randomGroupJid = groups[Math.floor(Math.random() * groups.length)];

  // 70% chance send message, 30% just react (if we have a recent msg)
  if (Math.random() < 0.7) {
    await sendGroupMessage(sock, accountId, randomGroupJid);
    return true;
  }

  // For reactions, we'd need a recent message key, which we skip if not available
  // Fallback to sending a message instead
  await sendGroupMessage(sock, accountId, randomGroupJid);
  return true;
}
