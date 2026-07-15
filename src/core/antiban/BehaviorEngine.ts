import type { WASocket } from '@whiskeysockets/baileys';
import { TIMING, REACTIONS_POOL, REACTIONS_WEIGHTS } from '../../config/constants.js';
import { gaussianClamp, sleep } from '../../utils/gaussian.js';
import { TypingModel } from './TypingModel.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('behavior-engine');

export class BehaviorEngine {
  private typingModel = new TypingModel();
  private subscribedJids = new Set<string>();

  async simulateTyping(sock: WASocket, jid: string, messageLength: number): Promise<void> {
    if (!this.subscribedJids.has(jid)) {
      await sock.presenceSubscribe(jid);
      this.subscribedJids.add(jid);
    }

    const plan = this.typingModel.computeTypingPlan(messageLength);
    await this.typingModel.executeTypingPlan(sock, jid, plan);
  }

  async simulateReadReceipt(sock: WASocket, msgKeys: any[]): Promise<void> {
    const delay = gaussianClamp(
      (TIMING.READ_RECEIPT_MIN_MS + TIMING.READ_RECEIPT_MAX_MS) / 2,
      3000,
      TIMING.READ_RECEIPT_MIN_MS,
      TIMING.READ_RECEIPT_MAX_MS
    );
    await sleep(delay);
    await sock.readMessages(msgKeys);
  }

  async maybeReact(sock: WASocket, msgKey: any, isNewContact: boolean = false): Promise<boolean> {
    // Lower reaction probability for new contacts (5-15% vs 30%)
    const probability = isNewContact ? 0.10 : TIMING.REACTION_PROBABILITY;
    if (Math.random() > probability) return false;

    const delay = gaussianClamp(
      (TIMING.REACTION_MIN_MS + TIMING.REACTION_MAX_MS) / 2,
      8000,
      TIMING.REACTION_MIN_MS,
      TIMING.REACTION_MAX_MS
    );
    await sleep(delay);

    const emoji = this.pickWeightedReaction();
    await sock.sendMessage(msgKey.remoteJid!, {
      react: { text: emoji, key: msgKey },
    });

    logger.debug({ jid: msgKey.remoteJid, emoji }, 'Sent reaction');
    return true;
  }

  private pickWeightedReaction(): string {
    const rand = Math.random();
    let cumulative = 0;
    for (let i = 0; i < REACTIONS_WEIGHTS.length; i++) {
      cumulative += REACTIONS_WEIGHTS[i];
      if (rand <= cumulative) return REACTIONS_POOL[i];
    }
    return REACTIONS_POOL[0];
  }

  clearSubscriptions(): void {
    this.subscribedJids.clear();
  }
}
