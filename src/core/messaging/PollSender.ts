import type { WASocket } from '@whiskeysockets/baileys';
import { resolveSpintax } from './SpintaxParser.js';
import { createChildLogger } from '../../utils/logger.js';
import { getDb } from '../../database/client.js';
import { reserveDailySlot, releaseDailySlot } from '../warmup/DailyLimitGuard.js';

const logger = createChildLogger('poll-sender');

export interface PollTemplate {
  question: string;
  options: string[];
  selectableCount: number;
}

/**
 * 30+ realistic poll templates in Portuguese with spintax
 */
const POLL_TEMPLATES: PollTemplate[] = [
  // --- FOOD ---
  {
    question: '{Qual|Qual é} {sua|a sua} comida {favorita|preferida}? {🍕|🍔|🍗}',
    options: ['Pizza', 'Hambúrguer', 'Churrasco', 'Sushi', 'Açaí'],
    selectableCount: 1,
  },
  {
    question: '{Almoço|Jantar} de {hoje|domingo}, o que {comer|pedir}? {🤔|🍽️}',
    options: ['Comida caseira', 'iFood', 'Churrasco', 'Japonesa', 'Lanche'],
    selectableCount: 1,
  },
  {
    question: 'Melhor {lanche|fast food} {da vida|de todos}? {🍔|🌭}',
    options: ['McDonald\'s', 'Burger King', 'Bob\'s', 'Subway', 'Popeyes'],
    selectableCount: 1,
  },
  {
    question: '{Café|Cafezinho} {preferido|favorito}? {☕|🤎}',
    options: ['Expresso', 'Cappuccino', 'Latte', 'Café com leite', 'Café gelado'],
    selectableCount: 1,
  },
  {
    question: 'Melhor {sabor de pizza|pizza}? {🍕|🤤}',
    options: ['Calabresa', 'Mussarela', 'Portuguesa', 'Frango c/ catupiry', '4 queijos'],
    selectableCount: 1,
  },

  // --- SPORTS ---
  {
    question: '{Qual|Qual é o} melhor time {do Brasil|brasileiro}? {⚽|🏆}',
    options: ['Flamengo', 'Corinthians', 'Palmeiras', 'São Paulo', 'Grêmio'],
    selectableCount: 1,
  },
  {
    question: 'Quem {ganha|leva} {o campeonato|o Brasileirão} {esse ano|2026}? {🏆|⚽}',
    options: ['Flamengo', 'Palmeiras', 'Botafogo', 'Atlético-MG', 'Outro'],
    selectableCount: 1,
  },
  {
    question: '{Melhor|Maior} jogador {brasileiro|da história}? {⚽|🐐}',
    options: ['Pelé', 'Neymar', 'Ronaldo', 'Ronaldinho', 'Zico'],
    selectableCount: 1,
  },

  // --- ENTERTAINMENT ---
  {
    question: '{Netflix|Streaming} ou {cinema|ir ao cinema}? {🎬|🍿}',
    options: ['Netflix em casa', 'Cinema sempre', 'Depende do filme', 'Os dois'],
    selectableCount: 1,
  },
  {
    question: 'Melhor {série|série de todos os tempos}? {📺|🎬}',
    options: ['Breaking Bad', 'Game of Thrones', 'La Casa de Papel', 'Stranger Things', 'The Office'],
    selectableCount: 1,
  },
  {
    question: '{Qual|Que tipo de} {música|estilo musical} {você curte|vc escuta}? {🎵|🎶}',
    options: ['Sertanejo', 'Funk', 'Pagode', 'Rock', 'Pop', 'Rap'],
    selectableCount: 2,
  },
  {
    question: '{Melhor|Maior} {cantor|artista} {brasileiro|do momento}? {🎤|🎵}',
    options: ['Anitta', 'Jorge & Mateus', 'Marília Mendonça', 'Gusttavo Lima', 'MC Cabelinho'],
    selectableCount: 1,
  },

  // --- LIFESTYLE ---
  {
    question: '{Praia|Campo} ou {montanha|serra}? {🏖️|⛰️}',
    options: ['Praia sempre', 'Montanha/Serra', 'Depende da época', 'Tanto faz'],
    selectableCount: 1,
  },
  {
    question: '{Manhã|Noite}: quando {vc é mais produtivo|rende mais}? {🌅|🌙}',
    options: ['De manhã cedo', 'De tarde', 'De noite', 'De madrugada'],
    selectableCount: 1,
  },
  {
    question: '{Qual|Que} {estação|época} do ano {vc prefere|vc gosta mais}? {🌦️|☀️}',
    options: ['Verão', 'Inverno', 'Outono', 'Primavera'],
    selectableCount: 1,
  },
  {
    question: '{Pet|Animal} {favorito|preferido}? {🐶|🐱}',
    options: ['Cachorro', 'Gato', 'Os dois', 'Outro', 'Nenhum'],
    selectableCount: 1,
  },
  {
    question: '{Carro|Moto} ou {transporte público|Uber}? {🚗|🚌}',
    options: ['Carro próprio', 'Moto', 'Uber/99', 'Transporte público', 'Bicicleta'],
    selectableCount: 1,
  },

  // --- WORK / DAILY ---
  {
    question: '{Home office|Presencial} ou {híbrido|misto}? {💼|🏠}',
    options: ['Home office', 'Presencial', 'Híbrido', 'Freelancer em qualquer lugar'],
    selectableCount: 1,
  },
  {
    question: '{Melhor|Qual o melhor} dia da {semana|semana pra vc}? {📅|😎}',
    options: ['Segunda', 'Quarta', 'Sexta', 'Sábado', 'Domingo'],
    selectableCount: 1,
  },
  {
    question: '{Quanto|Quantas horas} de sono {por noite|vc dorme}? {😴|🛏️}',
    options: ['Menos de 6h', '6-7 horas', '7-8 horas', 'Mais de 8h', 'Depende do dia'],
    selectableCount: 1,
  },

  // --- TRAVEL ---
  {
    question: '{Próxima|Sua próxima} viagem {vai ser|seria} pra onde? {✈️|🌍}',
    options: ['Praia no Nordeste', 'Serra Gaúcha', 'Exterior', 'Interior do estado', 'Não sei ainda'],
    selectableCount: 1,
  },
  {
    question: 'Melhor {destino|praia} {do Brasil|no litoral}? {🏖️|🌊}',
    options: ['Fernando de Noronha', 'Jericoacoara', 'Floripa', 'Porto de Galinhas', 'Trancoso'],
    selectableCount: 1,
  },

  // --- TECH ---
  {
    question: '{iPhone|Android}: {qual|qual é} {melhor|o melhor}? {📱|🤔}',
    options: ['iPhone', 'Android', 'Tanto faz', 'Os dois são bons'],
    selectableCount: 1,
  },
  {
    question: 'Melhor {rede social|app} {atualmente|hoje}? {📲|👀}',
    options: ['Instagram', 'TikTok', 'Twitter/X', 'YouTube', 'WhatsApp'],
    selectableCount: 1,
  },

  // --- RANDOM FUN ---
  {
    question: '{Superpoder|Poder}: {qual|qual vc escolheria}? {🦸|✨}',
    options: ['Voar', 'Invisibilidade', 'Super força', 'Ler mentes', 'Teletransporte'],
    selectableCount: 1,
  },
  {
    question: '{Se pudesse|Podendo}, {morar|viver} em {qual cidade|que lugar}? {🏙️|🌍}',
    options: ['São Paulo', 'Rio de Janeiro', 'Florianópolis', 'Lisboa', 'Miami'],
    selectableCount: 1,
  },
  {
    question: '{Chocolate|Doce} {preferido|favorito}? {🍫|🍬}',
    options: ['Bis', 'KitKat', 'Diamante Negro', 'Laka', 'Trident conta?'],
    selectableCount: 1,
  },
  {
    question: 'Melhor {refrigerante|refri}? {🥤|🧊}',
    options: ['Coca-Cola', 'Guaraná Antarctica', 'Pepsi', 'Fanta', 'Nenhum, bebo água'],
    selectableCount: 1,
  },
  {
    question: '{Cerveja|Breja} {favorita|preferida}? {🍺|🍻}',
    options: ['Heineken', 'Brahma', 'Skol', 'Budweiser', 'Artesanal'],
    selectableCount: 1,
  },
  {
    question: '{Fim de semana|Fds} {perfeito|ideal}? {🎉|😎}',
    options: ['Descansar em casa', 'Sair com amigos', 'Praia/piscina', 'Churrasco', 'Viajar'],
    selectableCount: 1,
  },
  {
    question: '{Você é|Vc é} mais {introvertido|extrovertido}? {🤔|🧐}',
    options: ['Introvertido total', 'Mais introvertido', 'Depende do dia', 'Mais extrovertido', 'Extrovertido total'],
    selectableCount: 1,
  },
  {
    question: 'Melhor {exercício|esporte} {pra fazer|pra praticar}? {💪|🏃}',
    options: ['Academia', 'Corrida', 'Futebol', 'Natação', 'Nenhum kk'],
    selectableCount: 1,
  },
];

export function pickRandomPoll(): PollTemplate {
  return POLL_TEMPLATES[Math.floor(Math.random() * POLL_TEMPLATES.length)];
}

/**
 * Send a poll message to a target JID.
 */
export async function sendPoll(
  sock: WASocket,
  senderAccountId: string,
  recipientJid: string,
  template?: PollTemplate,
): Promise<void> {
  const poll = template ?? pickRandomPoll();
  const resolvedQuestion = resolveSpintax(poll.question);

  // Respect the hard daily cap before sending.
  if (!(await reserveDailySlot(senderAccountId))) return;

  try {
    await sock.sendMessage(recipientJid, {
      poll: {
        name: resolvedQuestion,
        values: poll.options,
        selectableCount: poll.selectableCount,
      },
    });
  } catch (err) {
    await releaseDailySlot(senderAccountId);
    throw err;
  }

  const db = getDb();
  const receiverPhone = recipientJid.replace('@s.whatsapp.net', '');
  const receiverAccount = await db.account.findUnique({ where: { phoneNumber: receiverPhone } });

  await db.messageLog.create({
    data: {
      senderId: senderAccountId,
      receiverId: receiverAccount?.id ?? senderAccountId,
      messageType: 'TEXT',
      direction: 'OUTBOUND',
      spintaxOutput: `[poll] ${resolvedQuestion}`,
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  // Daily counter already incremented by the reservation above.

  logger.info({ accountId: senderAccountId, question: resolvedQuestion }, 'Poll sent');
}

export { POLL_TEMPLATES };
