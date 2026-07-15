// One-off script: top up conversation templates to a target (default 2000).
// Generates natural PT-BR casual conversations built from heavily-spintaxed
// fragments, so the runtime message variety is enormous.
//
// Run:  node scripts/topup-templates.mjs   (uses DATABASE_URL from .env)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const TARGET = Number(process.argv[2] || 2000);

// ── Fragment pools (spintax). Each expands to many variants at send time. ──
const OPENERS = [
  '{oi|olá|e aí|opa} {tudo bem|beleza|suave|de boa}?',
  '{fala|salve|e aí} {mano|cara|véi|parça}!',
  '{bom dia|boa tarde|boa noite}! {como vai|como tá|tudo certo}?',
  '{oi|opa}, {deixa eu te contar|olha só|posso te falar uma coisa}?',
  '{e aí|opa}, {sumido|sumida|cadê você} hein {kkk|rsrs}',
  '{oi|olá}, {tudo bem por aí|como estão as coisas}?',
  '{e aí|opa|fala}, {beleza|de boa|tranquilo}?',
  '{oi|opa}! {tá ocupado|tá livre|pode falar} {agora|aí}?',
  '{salve|fala} {família|chefe|brother|parça}',
  '{oi|e aí}, {bão|tudo certo|suave} {contigo|por aí}?',
  '{opa|oi}, {quanto tempo|faz tempo|há quanto tempo} {né|hein}!',
  '{e aí|oi}, {como foi|como tá sendo} {o dia|a semana}?',
  '{oi|olá}, {tô passando pra|só pra} {dar um oi|falar contigo}',
  '{fala aí|e aí}, {tudo certo|tudo em cima|tudo joia}?',
  '{opa|oi}! {bom te ver|que bom falar contigo} {por aqui|de novo}',
];

const REPLIES = [
  '{tudo|tudo sim|por aqui de boa|tranquilo}, {e você|e aí|e contigo}?',
  '{beleza|suave|de boa}! {pode falar|manda|fala aí}',
  '{oi|opa}! {tudo ótimo|tudo certo|tudo tranquilo}, {e você|e por aí}?',
  '{claro|pode crer|com certeza}, {manda|fala|diz aí}',
  '{kkk|haha} {tô por aqui|sumido nada|de boa}, {e você|e tu}?',
  '{oi|opa}, {tudo joia|tudo em cima|na paz}! {e você|e aí}?',
  '{tô bem|tô de boa|tranquilão}, {graças a Deus|valeu por perguntar}',
  '{eaí|opa}! {bão demais|suave na nave|tudo certo} contigo?',
  '{oi|olá}! {também tava sumido|também né} kkk {e você|e aí}?',
  '{tudo|tudo certo}! {que bom te ver|que bom falar} {por aqui|aqui}',
  '{de boa|tranquilo}, {só na correria|só no corre}, {e você|e tu}?',
  '{opa|oi}, {tudo certo|tudo tranquilo}! {bora|conta} {o que manda|as novidades}',
];

const TOPICS = [
  ['futebol', '{viu o jogo|assistiu a partida|viu o futebol} {ontem|de ontem|do fim de semana}?'],
  ['novela', '{tá vendo|acompanha|viu} a {novela|série} {nova|das nove}?'],
  ['clima', '{nossa|caramba}, {que calor|que frio|que chuva} {hoje|hein|né}'],
  ['comida', '{já almoçou|já comeu|comeu o que} {hoje|aí}?'],
  ['trabalho', '{como tá|e o} {trabalho|trampo|serviço}? {corrido|tranquilo|puxado}?'],
  ['findi', '{o que vai fazer|tem plano pro|bora fazer algo no} {fim de semana|findi|sábado}?'],
  ['transito', '{nossa|cara}, {o trânsito|o transito} {hoje tá|tava} {impossível|caótico|parado}'],
  ['promo', '{vi uma promoção|achei uma oferta|tava no mercado} {massa|boa|interessante} {hoje|ontem}'],
  ['filme', '{viu|assistiu} {algum filme|aquele filme} {bom|legal} {recente|esses dias}?'],
  ['musica', '{tá ouvindo|curtindo|escutando} {o que de bom|alguma música nova}?'],
  ['pet', '{como tá|e} {seu cachorro|seu gato|seu pet|o bichinho}?'],
  ['saude', '{tá se cuidando|como tá a saúde|fez exercício} {essa semana|ultimamente}?'],
  ['viagem', '{pensa em viajar|tem viagem marcada|bora viajar} {esse ano|nas férias}?'],
  ['tech', '{viu|soube} {do celular novo|daquela novidade|do lançamento}?'],
  ['academia', '{foi treinar|foi na academia|fez treino} {hoje|essa semana}?'],
  ['cafe', '{bora|vamo} {tomar um café|marcar um café} {qualquer dia|esses dias}?'],
  ['series', '{terminou|tá vendo} {alguma série|aquela série} {boa|nova}?'],
  ['jogo', '{tá jogando|jogou} {alguma coisa|algum game} {bom|novo} ultimamente?'],
  ['familia', '{como tá|e} {a família|o pessoal lá de casa|a galera}?'],
  ['estudo', '{como tão|e} {os estudos|a faculdade|o curso}?'],
  ['receita', '{testou|fez} {alguma receita|algo diferente} {essa semana|hoje}?'],
  ['noticia', '{viu a notícia|soube da última|ficou sabendo} {de hoje|de ontem}?'],
  ['humor', '{conta uma|manda uma} {piada|história engraçada} aí kkk'],
  ['planos', '{tem algum plano|tá pensando em algo} {pra esse mês|pro futuro}?'],
  ['mercado', '{precisa de algo|vai no mercado} {hoje|essa semana}?'],
  ['cinema', '{bora no cinema|vamo ver um filme} {qualquer dia|no findi}?'],
  ['praia', '{bora pra praia|vamo na praia} {esse fim de semana|um dia desses}?'],
  ['churras', '{bora um churrasco|vamo fazer um churras} {qualquer hora|no sábado}?'],
  ['trabalho2', '{fechou negócio|teve novidade no trampo} {hoje|essa semana}?'],
  ['carro', '{como tá|e} {o carro|a moto|o rolê}?'],
  ['tempo', '{olha|viu} {a previsão|como vai ficar o tempo} {amanhã|no fim de semana}?'],
  ['descanso', '{conseguiu descansar|dormiu bem} {hoje|essa semana}?'],
  ['rotina', '{e a rotina|como tão os dias}? {corrida|tranquila|na correria}?'],
  ['hobby', '{tá fazendo|voltou pro} {seu hobby|aquele lance que curte}?'],
  ['lazer', '{o que curtiu fazer|fez algo legal} {ultimamente|esses dias}?'],
  ['bar', '{bora um bar|vamo tomar uma} {hoje|qualquer dia}?'],
  ['dia', '{como foi seu dia|teve um bom dia} {hoje|hein}?'],
  ['encontro', '{a gente precisa marcar|temos que nos ver} {logo|um dia desses}'],
  ['saudade', '{tava com saudade|bateu uma saudade} {de você|de conversar contigo}'],
  ['novidade', '{e aí|conta}, {alguma novidade|tem news} {por aí|pra contar}?'],
];

const TOPIC_REPLIES = [
  '{nossa|caramba|eita}, {sério|verdade|que isso}?',
  '{pois é|exato|com certeza|vdd}',
  '{kkk|haha} {boa|massa|top|legal}',
  '{que|tá} {interessante|massa|bacana} isso',
  '{conta mais|fala mais|como assim}?',
  '{eu também|aqui também|por aqui igual}',
  '{nem me fala|nem te conto|pois é}',
  '{verdade|fato|real|confere}',
  '{adorei|gostei|curti} {saber|isso}',
  '{então|aí sim}, {bora|partiu}!',
  '{eita|opa}, {boa essa|essa foi boa}',
  '{sei como é|imagino|entendo}',
  '{também acho|concordo|é isso aí}',
  '{que bom|fico feliz|massa demais}',
  '{tô dentro|topo|pode contar comigo}',
];

const FOLLOWS = [
  '{enfim|então|mas é isso}, {depois a gente conversa|qualquer coisa chama}',
  '{e aí|então}, {bora marcar algo|vamo combinar}?',
  '{depois te mando|te aviso depois|a gente se fala} {certo|ok}',
  '{tô precisando|preciso} {resolver umas coisas|sair um pouco}',
  '{mas conta|e você}, {novidade|alguma news}?',
  '{vamo|bora} {se falando|se ver mais}, {tava com saudade|sumido né}',
  '{então fica|combinado então}, {qualquer coisa me chama|tmj}',
  '{boa|massa}, {depois continuamos|seguimos depois}',
  '{ó|olha}, {preciso ir|vou nessa} {mas foi bom falar|mas tmj}',
  '{vamo manter contato|não some mais} hein {kkk|rsrs}',
];

const CLOSERS = [
  '{valeu|tmj|show|beleza}!',
  '{combinado|fechou|perfeito}, {abraço|falou}',
  '{boa|tranquilo|suave}, {qualquer coisa chama|tmj}',
  '{kkk|haha} {falou|até mais|abraço}',
  '{então tá|beleza}, {bom descanso|boa noite|até}',
  '{show|massa}, {a gente se fala|até logo}',
  '{tmj|valeu mesmo}, {abraço forte|um abraço}',
  '{fechado|combinado}, {falou|até}',
  '{beleza|de boa}, {se cuida|fica bem}',
  '{isso aí|perfeito}, {até mais|tmj}',
];

const CATEGORIES = ['casual', 'social', 'amizade', 'dia-a-dia', 'conversa'];

function pickIdx(arr, i) { return arr[i % arr.length]; }

function buildTemplate(i) {
  const [topicKey, topicLine] = pickIdx(TOPICS, i);
  const opener = pickIdx(OPENERS, i);
  const reply = pickIdx(REPLIES, i * 3 + 1);
  const treply = pickIdx(TOPIC_REPLIES, i * 5 + 2);
  const follow = pickIdx(FOLLOWS, i * 7 + 3);
  const closer = pickIdx(CLOSERS, i * 11 + 4);
  const extraTopic = pickIdx(TOPICS, i * 13 + 5)[1];
  const extraReply = pickIdx(TOPIC_REPLIES, i * 17 + 6);

  // Vary the conversation length so templates aren't all the same shape.
  const shape = i % 4;
  let steps;
  if (shape === 0) {
    steps = [['initiator', opener], ['responder', reply], ['initiator', topicLine], ['responder', treply]];
  } else if (shape === 1) {
    steps = [['initiator', opener], ['responder', reply], ['initiator', topicLine], ['responder', treply], ['initiator', closer]];
  } else if (shape === 2) {
    steps = [['initiator', opener], ['responder', reply], ['initiator', topicLine], ['responder', treply], ['initiator', follow], ['responder', closer]];
  } else {
    steps = [['initiator', opener], ['responder', reply], ['initiator', topicLine], ['responder', treply], ['initiator', extraTopic], ['responder', extraReply], ['initiator', follow], ['responder', closer]];
  }

  return {
    name: `gen-${topicKey}-${i}`,
    category: pickIdx(CATEGORIES, i),
    isActive: true,
    messages: steps.map(([role, text]) => ({ role, type: 'text', text })),
  };
}

async function main() {
  const existing = await db.conversationTemplate.count();
  const toCreate = Math.max(0, TARGET - existing);
  console.log(`Templates atuais: ${existing} | meta: ${TARGET} | gerar: ${toCreate}`);

  if (toCreate === 0) {
    console.log('Nada a gerar — já atingiu a meta.');
    await db.$disconnect();
    return;
  }

  const batch = [];
  for (let i = 0; i < toCreate; i++) batch.push(buildTemplate(existing + i));

  // Insert in chunks
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    await db.conversationTemplate.createMany({ data: slice });
    inserted += slice.length;
    console.log(`  inseridos ${inserted}/${toCreate}`);
  }

  const final = await db.conversationTemplate.count();
  console.log(`Concluído. Total de templates agora: ${final}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error('Erro:', err.message);
  await db.$disconnect();
  process.exit(1);
});
