import type { WASocket } from '@whiskeysockets/baileys';
import { resolveSpintax } from './SpintaxParser.js';
import { createChildLogger } from '../../utils/logger.js';
import { getDb } from '../../database/client.js';
import { reserveDailySlot, releaseDailySlot } from '../warmup/DailyLimitGuard.js';

const logger = createChildLogger('location-sender');

export interface BrazilianLocation {
  name: string;
  degreesLatitude: number;
  degreesLongitude: number;
  city: string;
  category: string;
}

/**
 * 50+ real Brazilian locations: tourist spots, malls, restaurants, parks, etc.
 */
const BRAZILIAN_LOCATIONS: BrazilianLocation[] = [
  // --- SAO PAULO ---
  { name: 'Parque Ibirapuera', degreesLatitude: -23.5874, degreesLongitude: -46.6576, city: 'São Paulo', category: 'park' },
  { name: 'Avenida Paulista', degreesLatitude: -23.5613, degreesLongitude: -46.6560, city: 'São Paulo', category: 'landmark' },
  { name: 'Shopping Iguatemi SP', degreesLatitude: -23.5700, degreesLongitude: -46.6837, city: 'São Paulo', category: 'mall' },
  { name: 'Mercado Municipal SP', degreesLatitude: -23.5415, degreesLongitude: -46.6293, city: 'São Paulo', category: 'restaurant' },
  { name: 'MASP', degreesLatitude: -23.5614, degreesLongitude: -46.6558, city: 'São Paulo', category: 'museum' },
  { name: 'Pinacoteca do Estado', degreesLatitude: -23.5342, degreesLongitude: -46.6334, city: 'São Paulo', category: 'museum' },
  { name: 'Shopping Eldorado', degreesLatitude: -23.5724, degreesLongitude: -46.6952, city: 'São Paulo', category: 'mall' },
  { name: 'Parque Villa-Lobos', degreesLatitude: -23.5468, degreesLongitude: -46.7183, city: 'São Paulo', category: 'park' },
  { name: 'Liberdade', degreesLatitude: -23.5577, degreesLongitude: -46.6347, city: 'São Paulo', category: 'neighborhood' },
  { name: 'Shopping Morumbi', degreesLatitude: -23.6221, degreesLongitude: -46.6991, city: 'São Paulo', category: 'mall' },

  // --- RIO DE JANEIRO ---
  { name: 'Cristo Redentor', degreesLatitude: -22.9519, degreesLongitude: -43.2105, city: 'Rio de Janeiro', category: 'landmark' },
  { name: 'Praia de Copacabana', degreesLatitude: -22.9711, degreesLongitude: -43.1823, city: 'Rio de Janeiro', category: 'beach' },
  { name: 'Pão de Açúcar', degreesLatitude: -22.9486, degreesLongitude: -43.1568, city: 'Rio de Janeiro', category: 'landmark' },
  { name: 'Praia de Ipanema', degreesLatitude: -22.9838, degreesLongitude: -43.2045, city: 'Rio de Janeiro', category: 'beach' },
  { name: 'Maracanã', degreesLatitude: -22.9121, degreesLongitude: -43.2302, city: 'Rio de Janeiro', category: 'stadium' },
  { name: 'Shopping Barra', degreesLatitude: -23.0004, degreesLongitude: -43.3625, city: 'Rio de Janeiro', category: 'mall' },
  { name: 'Lapa', degreesLatitude: -22.9133, degreesLongitude: -43.1806, city: 'Rio de Janeiro', category: 'neighborhood' },
  { name: 'Jardim Botânico RJ', degreesLatitude: -22.9675, degreesLongitude: -43.2264, city: 'Rio de Janeiro', category: 'park' },

  // --- BELO HORIZONTE ---
  { name: 'Praça da Liberdade BH', degreesLatitude: -19.9318, degreesLongitude: -43.9386, city: 'Belo Horizonte', category: 'landmark' },
  { name: 'Shopping Diamond Mall', degreesLatitude: -19.9345, degreesLongitude: -43.9309, city: 'Belo Horizonte', category: 'mall' },
  { name: 'Mercado Central BH', degreesLatitude: -19.9187, degreesLongitude: -43.9396, city: 'Belo Horizonte', category: 'restaurant' },
  { name: 'Parque das Mangabeiras', degreesLatitude: -19.9538, degreesLongitude: -43.9202, city: 'Belo Horizonte', category: 'park' },

  // --- CURITIBA ---
  { name: 'Jardim Botânico de Curitiba', degreesLatitude: -25.4422, degreesLongitude: -49.2365, city: 'Curitiba', category: 'park' },
  { name: 'Shopping Estação Curitiba', degreesLatitude: -25.4350, degreesLongitude: -49.2696, city: 'Curitiba', category: 'mall' },
  { name: 'Ópera de Arame', degreesLatitude: -25.3844, degreesLongitude: -49.2764, city: 'Curitiba', category: 'landmark' },

  // --- SALVADOR ---
  { name: 'Pelourinho', degreesLatitude: -12.9736, degreesLongitude: -38.5108, city: 'Salvador', category: 'landmark' },
  { name: 'Farol da Barra', degreesLatitude: -13.0095, degreesLongitude: -38.5324, city: 'Salvador', category: 'beach' },
  { name: 'Shopping Barra Salvador', degreesLatitude: -13.0036, degreesLongitude: -38.5259, city: 'Salvador', category: 'mall' },
  { name: 'Elevador Lacerda', degreesLatitude: -12.9738, degreesLongitude: -38.5131, city: 'Salvador', category: 'landmark' },

  // --- BRASILIA ---
  { name: 'Catedral de Brasília', degreesLatitude: -15.7984, degreesLongitude: -47.8756, city: 'Brasília', category: 'landmark' },
  { name: 'Congresso Nacional', degreesLatitude: -15.7997, degreesLongitude: -47.8643, city: 'Brasília', category: 'landmark' },
  { name: 'Ponte JK', degreesLatitude: -15.8218, degreesLongitude: -47.8300, city: 'Brasília', category: 'landmark' },
  { name: 'Shopping Conjunto Nacional', degreesLatitude: -15.7901, degreesLongitude: -47.8826, city: 'Brasília', category: 'mall' },

  // --- RECIFE ---
  { name: 'Marco Zero Recife', degreesLatitude: -8.0631, degreesLongitude: -34.8711, city: 'Recife', category: 'landmark' },
  { name: 'Praia de Boa Viagem', degreesLatitude: -8.1195, degreesLongitude: -34.8951, city: 'Recife', category: 'beach' },
  { name: 'Shopping RioMar Recife', degreesLatitude: -8.0854, degreesLongitude: -34.8949, city: 'Recife', category: 'mall' },

  // --- FORTALEZA ---
  { name: 'Praia do Futuro', degreesLatitude: -3.7517, degreesLongitude: -38.4506, city: 'Fortaleza', category: 'beach' },
  { name: 'Beach Park', degreesLatitude: -3.8477, degreesLongitude: -38.4140, city: 'Fortaleza', category: 'park' },
  { name: 'Shopping Iguatemi Fortaleza', degreesLatitude: -3.7413, degreesLongitude: -38.4896, city: 'Fortaleza', category: 'mall' },

  // --- FLORIANOPOLIS ---
  { name: 'Praia da Joaquina', degreesLatitude: -27.6310, degreesLongitude: -48.4468, city: 'Florianópolis', category: 'beach' },
  { name: 'Lagoa da Conceição', degreesLatitude: -27.5946, degreesLongitude: -48.4584, city: 'Florianópolis', category: 'beach' },
  { name: 'Shopping Iguatemi Floripa', degreesLatitude: -27.5867, degreesLongitude: -48.5504, city: 'Florianópolis', category: 'mall' },

  // --- PORTO ALEGRE ---
  { name: 'Parque Farroupilha', degreesLatitude: -30.0371, degreesLongitude: -51.2172, city: 'Porto Alegre', category: 'park' },
  { name: 'Shopping Iguatemi POA', degreesLatitude: -30.0256, degreesLongitude: -51.1611, city: 'Porto Alegre', category: 'mall' },
  { name: 'Usina do Gasômetro', degreesLatitude: -30.0354, degreesLongitude: -51.2413, city: 'Porto Alegre', category: 'landmark' },

  // --- MANAUS ---
  { name: 'Teatro Amazonas', degreesLatitude: -3.1301, degreesLongitude: -60.0233, city: 'Manaus', category: 'landmark' },
  { name: 'Encontro das Águas', degreesLatitude: -3.1392, degreesLongitude: -59.8962, city: 'Manaus', category: 'landmark' },

  // --- GRAMADO / SERRA GAÚCHA ---
  { name: 'Rua Coberta Gramado', degreesLatitude: -29.3783, degreesLongitude: -50.8755, city: 'Gramado', category: 'landmark' },
  { name: 'Mini Mundo Gramado', degreesLatitude: -29.3777, degreesLongitude: -50.8761, city: 'Gramado', category: 'park' },

  // --- FOZ DO IGUAÇU ---
  { name: 'Cataratas do Iguaçu', degreesLatitude: -25.6953, degreesLongitude: -54.4367, city: 'Foz do Iguaçu', category: 'landmark' },
  { name: 'Itaipu Binacional', degreesLatitude: -25.4082, degreesLongitude: -54.5889, city: 'Foz do Iguaçu', category: 'landmark' },

  // --- GOIANIA ---
  { name: 'Parque Flamboyant', degreesLatitude: -16.7098, degreesLongitude: -49.2483, city: 'Goiânia', category: 'park' },
  { name: 'Shopping Flamboyant', degreesLatitude: -16.7112, degreesLongitude: -49.2473, city: 'Goiânia', category: 'mall' },

  // --- NATAL ---
  { name: 'Praia de Ponta Negra', degreesLatitude: -5.8800, degreesLongitude: -35.1742, city: 'Natal', category: 'beach' },
  { name: 'Morro do Careca', degreesLatitude: -5.8862, degreesLongitude: -35.1708, city: 'Natal', category: 'landmark' },
];

/**
 * Add slight coordinate jitter so repeated sends look natural
 */
function jitterCoords(lat: number, lng: number): { degreesLatitude: number; degreesLongitude: number } {
  const jitter = () => (Math.random() - 0.5) * 0.002; // ~100-200m variation
  return {
    degreesLatitude: lat + jitter(),
    degreesLongitude: lng + jitter(),
  };
}

export function pickRandomLocation(): BrazilianLocation {
  return BRAZILIAN_LOCATIONS[Math.floor(Math.random() * BRAZILIAN_LOCATIONS.length)];
}

/**
 * Send a location message to a target JID.
 */
export async function sendLocation(
  sock: WASocket,
  senderAccountId: string,
  recipientJid: string,
  location?: BrazilianLocation,
): Promise<void> {
  const loc = location ?? pickRandomLocation();
  const coords = jitterCoords(loc.degreesLatitude, loc.degreesLongitude);

  const captionTemplates = [
    '{Olha|Vê|Mano olha} {onde eu to|onde estou|esse lugar} {😍|🏖️|📍}',
    '{To aqui|Cheguei|Estou aqui} {nesse lugar|nesse canto|nesse point} {📍|✌️}',
    '{Conhece|Já veio|Já foi} {aqui|nesse lugar}? {😁|🤩|👀}',
    '{Bora|Vamos|Partiu} {aqui|pra cá|nesse lugar} {qualquer dia|um dia desses}? {🙌|😎}',
    '{Que lugar|Que point|Que canto} {top|massa|incrível|show} {🔥|💯|✨}',
  ];

  const caption = resolveSpintax(
    captionTemplates[Math.floor(Math.random() * captionTemplates.length)]
  );

  // Respect the hard daily cap before sending.
  if (!(await reserveDailySlot(senderAccountId))) return;

  try {
    await sock.sendMessage(recipientJid, {
      location: {
        degreesLatitude: coords.degreesLatitude,
        degreesLongitude: coords.degreesLongitude,
        name: loc.name,
        address: `${loc.name}, ${loc.city}`,
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
      spintaxOutput: `[location] ${loc.name} - ${caption}`,
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  // Daily counter already incremented by the reservation above.

  logger.info({ accountId: senderAccountId, location: loc.name, city: loc.city }, 'Location sent');
}

export { BRAZILIAN_LOCATIONS };
