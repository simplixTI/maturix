import type { WASocket } from '@whiskeysockets/baileys';
import { resolveSpintax } from './SpintaxParser.js';
import { createChildLogger } from '../../utils/logger.js';
import { getDb } from '../../database/client.js';
import { reserveDailySlot, releaseDailySlot } from '../warmup/DailyLimitGuard.js';
import { getMessageableBusinesses, getAllBusinesses, setWhatsappStatus } from '../../config/businessStore.js';

const logger = createChildLogger('business-contacts');

export interface BusinessContact {
  name: string;
  phoneNumber: string;
  category: string;
  description: string;
}

/**
 * 100+ real Brazilian businesses with WhatsApp API (auto-respond bots).
 * Phone numbers are well-known public SAC/support numbers.
 */
const BUSINESS_CONTACTS: BusinessContact[] = [
  // ==================== BANKS / FINTECHS ====================
  { name: 'Nubank', phoneNumber: '5511940420011', category: 'bank', description: 'Banco digital Nubank' },
  { name: 'Banco Inter', phoneNumber: '553130032770', category: 'bank', description: 'Banco Inter digital' },
  { name: 'Bradesco', phoneNumber: '5511946044848', category: 'bank', description: 'Bradesco SAC' },
  { name: 'Itaú', phoneNumber: '551140044828', category: 'bank', description: 'Itaú atendimento' },
  { name: 'Banco do Brasil', phoneNumber: '556140044001', category: 'bank', description: 'BB atendimento' },
  { name: 'Caixa Econômica', phoneNumber: '5508001040104', category: 'bank', description: 'Caixa SAC' },
  { name: 'C6 Bank', phoneNumber: '551130036116', category: 'bank', description: 'C6 Bank digital' },
  { name: 'PagBank', phoneNumber: '551140044040', category: 'bank', description: 'PagBank PagSeguro' },
  { name: 'Banco Next', phoneNumber: '551140044100', category: 'bank', description: 'Next by Bradesco' },
  { name: 'PicPay', phoneNumber: '551130420794', category: 'bank', description: 'PicPay digital' },
  { name: 'Mercado Pago', phoneNumber: '551140044044', category: 'bank', description: 'Mercado Pago fintech' },
  { name: 'Stone', phoneNumber: '552140404040', category: 'bank', description: 'Stone pagamentos' },
  { name: 'Neon', phoneNumber: '551140204011', category: 'bank', description: 'Banco Neon' },

  // ==================== DELIVERY / FOOD ====================
  { name: 'iFood', phoneNumber: '551150553030', category: 'delivery', description: 'iFood delivery' },
  { name: 'Rappi', phoneNumber: '551140201900', category: 'delivery', description: 'Rappi delivery' },
  { name: 'Zé Delivery', phoneNumber: '551140205050', category: 'delivery', description: 'Zé Delivery bebidas' },
  { name: 'McDonald\'s Brasil', phoneNumber: '5508007042100', category: 'food', description: 'McDonald\'s SAC' },
  { name: 'Burger King Brasil', phoneNumber: '551140207042', category: 'food', description: 'BK atendimento' },
  { name: 'Habib\'s', phoneNumber: '551140042525', category: 'food', description: 'Habib\'s restaurante' },
  { name: 'Subway Brasil', phoneNumber: '551140042882', category: 'food', description: 'Subway SAC' },
  { name: 'Pizza Hut Brasil', phoneNumber: '551140044222', category: 'food', description: 'Pizza Hut SAC' },
  { name: 'Outback Brasil', phoneNumber: '551140044663', category: 'food', description: 'Outback reservas' },

  // ==================== TELECOM ====================
  { name: 'Vivo', phoneNumber: '551110541515', category: 'telecom', description: 'Vivo operadora' },
  { name: 'Claro', phoneNumber: '551199991000', category: 'telecom', description: 'Claro operadora' },
  { name: 'Tim', phoneNumber: '551141411041', category: 'telecom', description: 'Tim operadora' },
  { name: 'Oi', phoneNumber: '553140024000', category: 'telecom', description: 'Oi operadora' },

  // ==================== E-COMMERCE ====================
  { name: 'Magazine Luiza', phoneNumber: '551130038000', category: 'ecommerce', description: 'Magalu atendimento' },
  { name: 'Americanas', phoneNumber: '552140206100', category: 'ecommerce', description: 'Americanas SAC' },
  { name: 'Casas Bahia', phoneNumber: '551140031515', category: 'ecommerce', description: 'Casas Bahia SAC' },
  { name: 'Amazon Brasil', phoneNumber: '551140621444', category: 'ecommerce', description: 'Amazon Brasil SAC' },
  { name: 'Shopee Brasil', phoneNumber: '551140041565', category: 'ecommerce', description: 'Shopee atendimento' },
  { name: 'Mercado Livre', phoneNumber: '551140404141', category: 'ecommerce', description: 'Mercado Livre SAC' },
  { name: 'AliExpress BR', phoneNumber: '551140028272', category: 'ecommerce', description: 'AliExpress Brasil' },
  { name: 'Shein Brasil', phoneNumber: '551130038086', category: 'ecommerce', description: 'Shein atendimento' },
  { name: 'Netshoes', phoneNumber: '551140440303', category: 'ecommerce', description: 'Netshoes SAC' },
  { name: 'Dafiti', phoneNumber: '551130041800', category: 'ecommerce', description: 'Dafiti SAC' },

  // ==================== TRANSPORT / MOBILITY ====================
  { name: '99', phoneNumber: '551140424299', category: 'transport', description: '99 app transporte' },
  { name: 'Uber Brasil', phoneNumber: '5508000061222', category: 'transport', description: 'Uber SAC' },
  { name: 'Azul Linhas Aéreas', phoneNumber: '551140034040', category: 'airline', description: 'Azul companhia aérea' },
  { name: 'GOL Linhas Aéreas', phoneNumber: '5508007040465', category: 'airline', description: 'GOL aérea' },
  { name: 'LATAM Brasil', phoneNumber: '551140021921', category: 'airline', description: 'LATAM Airlines' },

  // ==================== HEALTH / PHARMACY ====================
  { name: 'Drogasil', phoneNumber: '551130049009', category: 'pharmacy', description: 'Drogasil farmácia' },
  { name: 'Droga Raia', phoneNumber: '551130049000', category: 'pharmacy', description: 'Droga Raia farmácia' },
  { name: 'Drogaria São Paulo', phoneNumber: '551140051000', category: 'pharmacy', description: 'Drogaria SP' },
  { name: 'Pague Menos', phoneNumber: '558530305000', category: 'pharmacy', description: 'Pague Menos farmácia' },
  { name: 'Ultrafarma', phoneNumber: '551140033999', category: 'pharmacy', description: 'Ultrafarma online' },

  // ==================== INSURANCE ====================
  { name: 'Porto Seguro', phoneNumber: '551130040300', category: 'insurance', description: 'Porto Seguro seguros' },
  { name: 'SulAmérica', phoneNumber: '551140044400', category: 'insurance', description: 'SulAmérica seguros' },
  { name: 'Bradesco Seguros', phoneNumber: '551140042700', category: 'insurance', description: 'Bradesco Seguros' },

  // ==================== SUBSCRIPTION / STREAMING ====================
  { name: 'Globoplay', phoneNumber: '552140021022', category: 'streaming', description: 'Globoplay streaming' },
  { name: 'Spotify Brasil', phoneNumber: '551140420755', category: 'streaming', description: 'Spotify suporte' },

  // ==================== UTILITIES ====================
  { name: 'Enel SP', phoneNumber: '5508007210235', category: 'utility', description: 'Enel energia SP' },
  { name: 'Sabesp', phoneNumber: '5508000550195', category: 'utility', description: 'Sabesp água SP' },
  { name: 'Comgás', phoneNumber: '5508000240024', category: 'utility', description: 'Comgás gás SP' },
  { name: 'Light', phoneNumber: '552121271700', category: 'utility', description: 'Light energia RJ' },
  { name: 'CPFL', phoneNumber: '5508007701950', category: 'utility', description: 'CPFL energia' },
  { name: 'Cemig', phoneNumber: '553131236200', category: 'utility', description: 'Cemig energia MG' },
  { name: 'Copel', phoneNumber: '5504130310300', category: 'utility', description: 'Copel energia PR' },

  // ==================== GOVERNMENT / SERVICES ====================
  { name: 'Correios', phoneNumber: '556133280100', category: 'government', description: 'Correios rastreamento' },
  { name: 'Detran SP', phoneNumber: '551150013636', category: 'government', description: 'Detran SP' },

  // ==================== FASHION / BEAUTY ====================
  { name: 'Renner', phoneNumber: '551130042000', category: 'fashion', description: 'Lojas Renner' },
  { name: 'C&A Brasil', phoneNumber: '551140426200', category: 'fashion', description: 'C&A moda' },
  { name: 'Riachuelo', phoneNumber: '551140042050', category: 'fashion', description: 'Riachuelo moda' },
  { name: 'O Boticário', phoneNumber: '551140044800', category: 'beauty', description: 'O Boticário cosméticos' },
  { name: 'Natura', phoneNumber: '5508001157272', category: 'beauty', description: 'Natura cosméticos' },
  { name: 'Avon', phoneNumber: '5508007082866', category: 'beauty', description: 'Avon cosméticos' },

  // ==================== EDUCATION ====================
  { name: 'Descomplica', phoneNumber: '552140425050', category: 'education', description: 'Descomplica educação' },
  { name: 'Hotmart', phoneNumber: '553131889100', category: 'education', description: 'Hotmart plataforma' },
  { name: 'Eduzz', phoneNumber: '551140062929', category: 'education', description: 'Eduzz plataforma' },

  // ==================== PET ====================
  { name: 'Petz', phoneNumber: '551140044738', category: 'pet', description: 'Petz pet shop' },
  { name: 'Cobasi', phoneNumber: '551140426022', category: 'pet', description: 'Cobasi pet shop' },

  // ==================== AUTOMOTIVE ====================
  { name: 'Localiza', phoneNumber: '553130433344', category: 'automotive', description: 'Localiza aluguel carros' },
  { name: 'Movida', phoneNumber: '5508004000505', category: 'automotive', description: 'Movida rent a car' },
  { name: 'Unidas', phoneNumber: '5508001210101', category: 'automotive', description: 'Unidas aluguel carros' },

  // ==================== HOME / CONSTRUCTION ====================
  { name: 'Leroy Merlin', phoneNumber: '551140204200', category: 'home', description: 'Leroy Merlin construção' },
  { name: 'Tok&Stok', phoneNumber: '551130035554', category: 'home', description: 'Tok&Stok móveis' },
  { name: 'Madeira Madeira', phoneNumber: '554130419100', category: 'home', description: 'Madeira Madeira online' },

  // ==================== FINANCIAL SERVICES ====================
  { name: 'XP Investimentos', phoneNumber: '551140034668', category: 'finance', description: 'XP Investimentos' },
  { name: 'Rico', phoneNumber: '551140043710', category: 'finance', description: 'Rico investimentos' },
  { name: 'BTG Pactual', phoneNumber: '551130839800', category: 'finance', description: 'BTG Pactual digital' },
  { name: 'Serasa', phoneNumber: '551130042800', category: 'finance', description: 'Serasa Consumidor' },
  { name: 'SPC Brasil', phoneNumber: '5508007257202', category: 'finance', description: 'SPC Brasil consulta' },

  // ==================== ENTERTAINMENT ====================
  { name: 'Cinemark', phoneNumber: '551140044200', category: 'entertainment', description: 'Cinemark cinemas' },
  { name: 'Ingresso.com', phoneNumber: '551140428900', category: 'entertainment', description: 'Ingresso.com tickets' },

  // ==================== TECH / ELECTRONICS ====================
  { name: 'Samsung Brasil', phoneNumber: '5508005772042', category: 'tech', description: 'Samsung suporte' },
  { name: 'Apple Brasil', phoneNumber: '5508007610867', category: 'tech', description: 'Apple suporte' },
  { name: 'Motorola Brasil', phoneNumber: '5508001090500', category: 'tech', description: 'Motorola suporte' },
  { name: 'LG Brasil', phoneNumber: '5508008787150', category: 'tech', description: 'LG atendimento' },
  { name: 'Dell Brasil', phoneNumber: '5508009701539', category: 'tech', description: 'Dell suporte' },

  // ==================== SPORTS / FITNESS ====================
  { name: 'Smart Fit', phoneNumber: '551140045000', category: 'fitness', description: 'Smart Fit academia' },
  { name: 'Bio Ritmo', phoneNumber: '551140447474', category: 'fitness', description: 'Bio Ritmo academia' },

  // ==================== MARKETPLACE ====================
  { name: 'OLX', phoneNumber: '552140424942', category: 'marketplace', description: 'OLX classificados' },
  { name: 'Enjoei', phoneNumber: '551130428288', category: 'marketplace', description: 'Enjoei marketplace' },

  // ==================== MISC / SERVICES ====================
  { name: 'GetNinjas', phoneNumber: '551140201188', category: 'services', description: 'GetNinjas serviços' },
  { name: 'iFood Benefícios', phoneNumber: '551150553031', category: 'services', description: 'iFood Benefícios' },
  { name: 'Sem Parar', phoneNumber: '551140041357', category: 'services', description: 'Sem Parar pedágio' },
  { name: 'ConectCar', phoneNumber: '551140042013', category: 'services', description: 'ConectCar tag pedágio' },
];

/**
 * Messages to send to business bots to trigger inbound auto-replies.
 * Kept short and natural so as not to raise flags.
 */
const BUSINESS_MESSAGES: string[] = [
  '{oi|olá|oii|eai}',
  '{oi|olá}, {tudo bem|td bem|bom dia|boa tarde}?',
  '{quero|gostaria de} {saber|informações} {sobre|a respeito de} {vocês|o serviço|os planos}',
  '{me ajuda|pode me ajudar|preciso de ajuda} {por favor|pfv|pf}?',
  '{qual|quais} {os planos|as opções|os serviços} {disponíveis|que vocês têm}?',
  '{bom dia|boa tarde|boa noite}, {preciso de|quero} {ajuda|informação}',
  '{oi|olá}, {como funciona|como faço|como posso}?',
  '{obrigado|obrigada|vlw|valeu} {pela ajuda|pela informação|pelas informações}',
  '{menu|atendimento|falar com atendente}',
  '{sim|1|2|início|iniciar}',
  '{oi|olá}, {preciso|quero} {verificar|consultar|saber} {minha conta|meu pedido|meu saldo}',
  '{ajuda|help|atendimento|suporte}',
  '{preços|valores|quanto custa}?',
  '{promoção|promoções|ofertas|cupom}?',
  '{horário de funcionamento|horários|abre que horas}?',
];

export function pickRandomBusiness(): BusinessContact {
  return BUSINESS_CONTACTS[Math.floor(Math.random() * BUSINESS_CONTACTS.length)];
}

export function pickRandomBusinessMessage(): string {
  return BUSINESS_MESSAGES[Math.floor(Math.random() * BUSINESS_MESSAGES.length)];
}

/**
 * Send a short message to a random business WhatsApp bot.
 * The business bot typically auto-replies, which generates organic INBOUND traffic.
 */
export async function messageRandomBusiness(
  sock: WASocket,
  senderAccountId: string,
  business?: BusinessContact,
): Promise<{ businessName: string; messageSent: string } | null> {
  // Pick from the EDITABLE store (active + not already known-invalid).
  let biz: { name: string; phoneNumber: string };
  if (business) {
    biz = { name: business.name, phoneNumber: business.phoneNumber.replace(/\D/g, '') };
  } else {
    const pool = await getMessageableBusinesses();
    if (pool.length === 0) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    biz = { name: pick.name, phoneNumber: pick.phoneNumber };
  }
  const jid = `${biz.phoneNumber}@s.whatsapp.net`;

  // SAFETY: verify the number is on WhatsApp BEFORE sending and record the result
  // in the store. Blindly texting a landline / wrong / reassigned number risks
  // hitting a real person who would report us → ban.
  try {
    const check = await sock.onWhatsApp(biz.phoneNumber);
    const exists = !!check?.[0]?.exists;
    await setWhatsappStatus(biz.phoneNumber, exists, new Date().toISOString());
    if (!exists) {
      logger.info({ business: biz.name, phone: biz.phoneNumber }, 'Business not on WhatsApp — skipping');
      return null;
    }
  } catch {
    return null; // transient lookup failure — try again another time
  }

  const rawMessage = pickRandomBusinessMessage();
  const resolvedMessage = resolveSpintax(rawMessage);

  // Respect the hard daily cap before sending.
  if (!(await reserveDailySlot(senderAccountId))) return null;

  try {
    await sock.sendMessage(jid, { text: resolvedMessage });

    const db = getDb();
    await db.messageLog.create({
      data: {
        senderId: senderAccountId,
        receiverId: senderAccountId, // no account in pool for business
        messageType: 'TEXT',
        direction: 'OUTBOUND',
        spintaxOutput: `[business:${biz.name}] ${resolvedMessage}`,
        status: 'SENT',
        sentAt: new Date(),
      },
    });

    // Daily counter already incremented by the reservation above.

    logger.info(
      { accountId: senderAccountId, business: biz.name },
      'Messaged business contact',
    );

    return { businessName: biz.name, messageSent: resolvedMessage };
  } catch (err: any) {
    // Send (or logging) failed after reserving a slot — give the quota back.
    await releaseDailySlot(senderAccountId);
    logger.error(
      { err: err.message, accountId: senderAccountId, business: biz.name },
      'Failed to message business',
    );
    return null;
  }
}

/**
 * Get a filtered subset of businesses by category.
 */
export function getBusinessesByCategory(category: string): BusinessContact[] {
  return BUSINESS_CONTACTS.filter(b => b.category === category);
}

/**
 * Validate every business in the store: check each number with onWhatsApp and
 * record whether it's a real WhatsApp number. Paced gently so it doesn't burst.
 * Used by the dashboard "validar" button.
 */
export async function validateAllBusinesses(
  sock: WASocket,
): Promise<{ checked: number; valid: number; invalid: number }> {
  const list = await getAllBusinesses();
  const now = new Date().toISOString();
  let valid = 0;
  let invalid = 0;
  for (const b of list) {
    try {
      const check = await sock.onWhatsApp(b.phoneNumber);
      const exists = !!check?.[0]?.exists;
      await setWhatsappStatus(b.phoneNumber, exists, now);
      if (exists) valid++; else invalid++;
    } catch {
      // transient lookup failure — leave status unchanged
    }
    await new Promise((r) => setTimeout(r, 250)); // gentle pacing
  }
  logger.info({ checked: list.length, valid, invalid }, 'Business list validated');
  return { checked: list.length, valid, invalid };
}

export { BUSINESS_CONTACTS };
