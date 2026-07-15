import { getDb } from './client.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('seed-templates');

/**
 * A conversation template's `messages` is an ordered array of steps.
 * Each step alternates between the two paired accounts:
 *   role: 'initiator' | 'responder'
 *   type: 'text' (media types also supported by the engine)
 *   text: message body — SPINTAX is supported, e.g. {oi|olá|e aí}
 * The warmup ConversationService walks these steps to simulate a real chat.
 */
interface Step {
  role: 'initiator' | 'responder';
  type: 'text';
  text: string;
}

function chat(lines: Array<[Step['role'], string]>): Step[] {
  return lines.map(([role, text]) => ({ role, type: 'text' as const, text }));
}

const DEFAULT_TEMPLATES: Array<{ name: string; category: string; messages: Step[] }> = [
  {
    name: 'Bate-papo casual',
    category: 'casual',
    messages: chat([
      ['initiator', '{oi|olá|e aí|opa}, {tudo bem|beleza|suave|de boa}?'],
      ['responder', '{tudo|tudo sim|por aqui tranquilo|de boa}, {e você|e aí|e contigo}?'],
      ['initiator', '{também|tô bem|tranquilo}, {graças a Deus|valeu}. {que que tá fazendo|no que tá|ocupado}?'],
      ['responder', '{nada demais|só descansando|aqui no celular|resolvendo umas coisas}, {e você|e tu}?'],
      ['initiator', '{mesma coisa|também|por aqui igual} kkk'],
      ['responder', '{kkk|hahaha|rsrs} {boa|show|massa}'],
    ]),
  },
  {
    name: 'Combinando algo',
    category: 'casual',
    messages: chat([
      ['initiator', '{e aí|opa|fala}, {bora marcar algo|vamo sair|que tal sair} {esse fim de semana|qualquer dia desses}?'],
      ['responder', '{bora|pode ser|massa|tô dentro}! {tava precisando|faz tempo que não saio}'],
      ['initiator', '{pensei em|tava pensando em} {um lanche|tomar um café|dar uma volta}, {topa|que acha}?'],
      ['responder', '{topo|fechou|perfeito|por mim ok}'],
      ['initiator', '{então combinado|show|fechado}, {te aviso a hora|depois acerto os detalhes}'],
      ['responder', '{valeu|beleza|tmj|show de bola}'],
    ]),
  },
  {
    name: 'Trocando novidades',
    category: 'casual',
    messages: chat([
      ['initiator', '{cara|mano|véi}, {viu a novidade|soube da última|fiquei sabendo de uma}?'],
      ['responder', '{não|que isso|conta aí|fala}'],
      ['initiator', '{depois te conto direito|é coisa boa|você não vai acreditar}, {mas tá tudo certo|deu tudo certo}'],
      ['responder', '{que bom|fico feliz|massa demais|aí sim}'],
      ['initiator', '{pois é|exato|isso aí}, {fiquei contente|tava esperando isso}'],
      ['responder', '{merece|você merece|parabéns}!'],
    ]),
  },
  {
    name: 'Conversa do dia a dia',
    category: 'casual',
    messages: chat([
      ['initiator', '{bom dia|boa tarde|opa}! {como foi o dia|como tá o dia|dia corrido}?'],
      ['responder', '{corrido|tranquilo|normal|puxado mas de boa}, {e o seu|e por aí}?'],
      ['initiator', '{também|na correria|aos poucos|tô resolvendo}'],
      ['responder', '{a gente leva|é assim mesmo|faz parte} kkk'],
      ['initiator', '{verdade|com certeza|pois é}'],
      ['responder', '{depois a gente conversa melhor|qualquer coisa chama|tmj}'],
    ]),
  },
];

/**
 * Seed starter conversation templates if the database has none.
 * Without at least one active template, the warmup engine cannot schedule
 * any conversations and no messages are ever sent.
 */
export async function seedConversationTemplates(): Promise<void> {
  const db = getDb();
  const count = await db.conversationTemplate.count();
  if (count > 0) return;

  for (const t of DEFAULT_TEMPLATES) {
    await db.conversationTemplate.create({
      data: { name: t.name, category: t.category, messages: t.messages as object[], isActive: true },
    });
  }
  logger.info({ seeded: DEFAULT_TEMPLATES.length }, 'Default conversation templates seeded');
}
