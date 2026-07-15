import type { Job } from '../QueueManager.js';
import type { SessionManager } from '../../session/SessionManager.js';
import { BehaviorEngine } from '../../antiban/BehaviorEngine.js';
import { getDb } from '../../../database/client.js';
import { createChildLogger } from '../../../utils/logger.js';

const logger = createChildLogger('reaction-worker');

export interface ReactionJobData {
  accountId: string;
  messageKey: any;
  jid: string;
}

export function createReactionProcessor(
  sessionManager: SessionManager,
  behaviorEngine: BehaviorEngine
) {
  return async (job: Job<ReactionJobData>) => {
    const { accountId, messageKey } = job.data;

    const sock = sessionManager.getSocket(accountId);
    if (!sock) {
      logger.warn({ accountId }, 'No socket for reaction');
      return { status: 'skipped', reason: 'no_socket' };
    }

    // First simulate reading the message
    await behaviorEngine.simulateReadReceipt(sock, [messageKey]);

    // Then maybe react
    const reacted = await behaviorEngine.maybeReact(sock, messageKey);

    if (reacted) {
      const db = getDb();
      await db.messageLog.create({
        data: {
          senderId: accountId,
          receiverId: accountId,
          messageType: 'REACTION',
          direction: 'OUTBOUND',
          status: 'SENT',
          sentAt: new Date(),
        },
      });
    }

    return { status: 'done', reacted };
  };
}
