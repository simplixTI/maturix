import type { Job } from '../QueueManager.js';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { SessionManager } from '../../session/SessionManager.js';
import { resolveSpintax } from '../../messaging/SpintaxParser.js';
import { getDb } from '../../../database/client.js';
import { createChildLogger } from '../../../utils/logger.js';

const logger = createChildLogger('status-worker');

export interface StatusJobData {
  accountId: string;
  type: 'text' | 'image';
  text?: string;
  imagePath?: string;
}

/**
 * 50+ status text variations: motivational, daily life, humor, religion, work, etc.
 * All with heavy spintax for unique output each time.
 */
const STATUS_TEXTS: string[] = [
  // --- GREETINGS / TIME OF DAY ---
  '{Bom dia|Boa tarde|Boa noite} {a todos|galera|pessoal}! {🙏|☀️|🌙}',
  '{Bom dia|Bom diaaa} {com|cheio de} {fé|gratidão|esperança} {🙏|☀️|✨}',
  '{Boa noite|Bom descanso|Durma bem} {pra quem merece|galera|pessoal} {🌙|😴|💤}',

  // --- MOTIVATIONAL ---
  '{Gratidão|Obrigado|Grato} por {mais um dia|tudo|esse momento} {🙏|❤️}',
  '{Foco|Determinação|Perseverança} {sempre|é tudo|é a chave} {💪|🔥|✨}',
  '{A vida é|Cada dia é} {uma bênção|um presente|uma chance nova} {🌟|✨|🙏}',
  '{Nunca desista|Vai dar certo|Confie no processo} {🙌|💪|🔥}',
  '{Acredite|Confie|Creia}: {tudo acontece|o melhor vem|Deus sabe} {no tempo certo|na hora certa} {🙏|✨}',
  '{Levanta|Sacode a poeira|Não para} {e vai|e segue|e brilha} {💪|🔥|🚀}',
  '{O impossível|O difícil} é só {questão de tempo|uma etapa|um degrau} {🏆|💪|🔝}',
  '{Seja|Tente ser} {a mudança|a diferença|a luz} que {o mundo|você|a vida} {precisa|merece} {✨|🌟}',
  '{Força|Coragem|Fé} {pra quem|pra todo mundo que} {tá lutando|tá na batalha|não desiste} {💪|🙏|🔥}',
  '{Quem|A pessoa que} {acredita|tem fé|persiste} {sempre|sempre sempre} {conquista|alcança|chega lá} {🏆|✨}',
  '{Hoje|Amanhã|Essa semana} {vai ser|será} {incrível|maravilhoso|abençoado} {✨|🙌|🌟}',
  '{Deus|O universo|A vida} {é bom|é fiel|não falha} {o tempo todo|sempre|demais} {🙏|❤️|✨}',
  '{Enquanto|Quando} {houver|tiver} {fé|esperança|vontade}, {haverá|tem} {caminho|solução|saída} {🙏|🛤️}',
  '{Sonhe|Lute|Trabalhe} {grande|alto|forte}, {colha|receba|conquiste} {grandemente|com fartura} {🌻|🔥|💰}',
  '{Sua hora|Seu momento|Sua vez} {vai chegar|tá chegando|está próxima} {⏰|🕐|✨}',

  // --- DAILY LIFE ---
  '{Trabalhando|Correndo atrás|Buscando} {dos sonhos|do melhor|do objetivo} {💼|🚀|💪}',
  '{Família|Amor|Paz} {é tudo|acima de tudo|em primeiro lugar} {❤️|🏠|🙏}',
  '{Café|Cafezinho|Expresso} {da manhã|matinal|pra começar o dia} {☕|🤎|😊}',
  '{Fim de semana|Fds} {chegou|finalmente|é nosso}! {🎉|🍻|😎}',
  '{Segunda-feira|Começo de semana}, {bora|vamos|partiu} {trabalhar|produzir|conquistar}! {💼|💪|☕}',
  '{Dia|Mais um dia} de {correria|trabalho|luta|batalha} {mas|porém} {com|cheio de} {alegria|fé|gratidão} {💪|😊|🙏}',
  '{Chuva|Sol|Calor|Frio} {e eu|e a gente} {aqui|na correria|trabalhando|firme} {🌧️|☀️|🥵|🥶}',
  '{Sextou|Fds|Fim de semana} {com|na} {paz|alegria|tranquilidade|cervejinha} {🍻|😎|🎉}',
  '{Domingo|Domingão} é dia de {descanso|família|churrasco|preguiça} {🍖|🏠|😴|❤️}',
  '{Quarta|Quartou|Meio da semana}: {já|quase} {passou|acabou|chega sexta} {😅|💪|🙃}',
  '{Almoço|Comida|Marmita} {de hoje|do dia}: {nota 10|aprovada|delícia} {🍽️|😋|🤤}',
  '{Trânsito|Engarrafamento} {tá|tá de} {loucura|brabo|absurdo} {🚗|😤|🤯}',

  // --- HUMOR ---
  '{Kkkkk|Hahaha|Rsrs}, {quem|a pessoa que} {entendeu|sabe} {entendeu|sabe} {😂|🤣|😆}',
  '{Modo|Status|Humor}: {preguiça|cansaço|tô de boa|on|off} {😴|😂|🤷}',
  '{Adultar|Ser adulto|Vida adulta} {é difícil|não é fácil|é tenso} {demais|parceiro|mano} {😅|🤦|💀}',
  '{Quando|Se} {der|tiver} {certo|bom}: {amém|obrigado|é isso}. {Quando|Se} {não|não der}: {amém também|obrigado também|paciência} {🤷|😂|🙏}',
  '{Hoje|O dia de hoje} {o corpo|eu} {pediu|preciso de|merece} {descanso|preguiça|sofá} {😴|🛋️|😂}',
  '{Minha meta|Meu objetivo}: {dormir|descansar|ficar de boa|paz} {😂|😴|🙏}',

  // --- WORK / HUSTLE ---
  '{Empreender|Trabalhar|Lutar} {é|sempre foi} {pra quem|de quem} {não desiste|tem coragem|acredita} {🚀|💼|💪}',
  '{Mais um|Mais outro} {dia|passo|degrau} {de|na} {evolução|crescimento|conquista} {📈|🚀|💹}',
  '{Sucesso|A vitória|O resultado} {não vem|não é} {do nada|de graça|fácil}, {vem do|é fruto de} {trabalho|esforço|suor} {💼|💪|🏋️}',
  '{Disciplina|Consistência|Rotina} {gera|traz|produz} {resultado|fruto|conquista} {📊|✅|🔑}',

  // --- GRATITUDE / FAITH ---
  '{Obrigado|Grato|Agradecido} {Senhor|Deus|meu Deus} por {tudo|essa vida|esse dia} {🙏|❤️|✨}',
  '{Deus|O Senhor} {é|sempre foi|sempre será} {fiel|bom|maravilhoso} {🙏|❤️|✨}',
  '{Fé|Esperança|Confiança} {em Deus|no Senhor|na vida} {sempre|acima de tudo} {🙏|✝️|❤️}',
  '{Na mão|Nas mãos} de {Deus|quem pode|quem sabe} {✋|🙏|❤️}',

  // --- SELF CARE ---
  '{Cuide|Cuidem} de {você|vocês|si mesmo} {primeiro|sempre} {❤️|🫶|💆}',
  '{Saúde|Paz} {mental|interior|de espírito} {é|vale} {tudo|ouro|prioridade} {🧘|💆|🧠}',
  '{Treino|Academia|Exercício} {do dia|feito|concluído}: {check|✅|done} {💪|🏋️|🔥}',
  '{Meditando|Refletindo|Respirando}: {paz|calma|serenidade} {🧘|🕊️|😌}',

  // --- WEEKEND / LEISURE ---
  '{Churrasco|Cerveja|Pagode|Futebol} {de|no} {domingo|sábado|fds} {🍖|🍺|🎶|⚽}',
  '{Netflix|Série|Filme} e {pipoca|junk food|preguiça}: {domingo|sábado|fds} {perfeito|ideal|top} {📺|🍿|🎬}',
  '{Viagem|Passeio|Rolê} {marcado|planejado|confirmado}! {✈️|🚗|🏖️}',

  // --- RANDOM / PHILOSOPHICAL ---
  '{A vida|Viver} {é|sempre foi} {sobre|questão de} {escolhas|momentos|experiências} {🌊|🌻|🌄}',
  '{Menos|Mais} {reclamar|gratidão|silêncio}, {mais|menos} {agradecer|drama|barulho} {🙏|🤫|✨}',
  '{Cada dia|Todo dia} {é|traz} uma {nova|outra} {chance|oportunidade|página} {📖|🌅|✨}',
  '{O tempo|A vida} {ensina|mostra|revela} {tudo|muita coisa|o que importa} {⏳|🕰️|📚}',
  '{Simplicidade|Humildade|Paz} {é|sempre foi} {a chave|o caminho|a resposta} {🔑|🕊️|🌿}',
];

/**
 * Maximum status posts per day per account.
 * Capped at 1 to keep warmup conservative and avoid detection.
 */
export function getStatusCountForDay(): number {
  return 1;
}

/**
 * Scan the media/images directory for available status images.
 */
export async function getStatusImagePool(mediaDir: string): Promise<string[]> {
  const imagesDir = join(mediaDir, 'images');
  try {
    const files = await readdir(imagesDir);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    return files
      .filter(f => imageExtensions.includes(extname(f).toLowerCase()))
      .map(f => join(imagesDir, f));
  } catch {
    return [];
  }
}

export function createStatusProcessor(sessionManager: SessionManager) {
  return async (job: Job<StatusJobData>) => {
    const { accountId, type, text, imagePath } = job.data;

    const sock = sessionManager.getSocket(accountId);
    if (!sock) {
      return { status: 'skipped', reason: 'no_socket' };
    }

    const statusJid = 'status@broadcast';

    try {
      if (type === 'text') {
        const statusText = text ?? STATUS_TEXTS[Math.floor(Math.random() * STATUS_TEXTS.length)];
        const resolved = resolveSpintax(statusText);

        await sock.sendMessage(statusJid, {
          text: resolved,
          backgroundColor: randomStatusColor(),
          font: Math.floor(Math.random() * 5),
        } as any);

        logger.info({ accountId }, 'Text status posted');
      } else if (type === 'image' && imagePath) {
        const buffer = await readFile(imagePath);

        // Optional caption with spintax
        const imageCaptions = [
          '{Momento|Registro|Foto} do {dia|momento} {📸|✨|🌟}',
          '{Que|Olha que} {lindo|bonito|incrível|demais} {😍|🤩|✨}',
          '{Vivendo|Curtindo|Aproveitando} {a vida|o momento|cada segundo} {🙌|❤️|✨}',
          '{Saudade|Memória|Lembrança} {boa|especial|marcante} {💕|🥰|📸}',
          '', // sometimes no caption
          '',
          '',
        ];
        const captionTemplate = imageCaptions[Math.floor(Math.random() * imageCaptions.length)];
        const caption = captionTemplate ? resolveSpintax(captionTemplate) : undefined;

        await sock.sendMessage(statusJid, {
          image: buffer,
          caption,
        });

        logger.info({ accountId }, 'Image status posted');
      }

      const db = getDb();
      await db.messageLog.create({
        data: {
          senderId: accountId,
          receiverId: accountId,
          messageType: 'STATUS_POST',
          direction: 'OUTBOUND',
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      await db.account.update({
        where: { id: accountId },
        data: { lastActiveAt: new Date() },
      });

      return { status: 'posted', type };
    } catch (err: any) {
      logger.error({ err: err.message, accountId }, 'Failed to post status');
      throw err;
    }
  };
}

function randomStatusColor(): string {
  const colors = [
    '#075e54', '#128c7e', '#25d366', '#dcf8c6', '#34b7f1',
    '#7c3aed', '#2563eb', '#dc2626', '#ea580c', '#d97706',
    '#059669', '#0891b2', '#4f46e5', '#7c2d12', '#1e3a5f',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export { STATUS_TEXTS };
