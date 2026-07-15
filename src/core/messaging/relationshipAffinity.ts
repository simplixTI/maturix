import { createHash } from 'node:crypto';

/**
 * Gives each pair of chips a STABLE "relationship", so their conversations stay
 * thematically coherent over time instead of jumping between unrelated topics
 * (business today, intimate tomorrow, scheduling next). A real relationship has
 * a consistent nature — two friends chat casually; a customer always talks to
 * the SAME kind of business. Derived deterministically from the pair's ids, so
 * it's stable across restarts with no storage.
 */

// Personal / social categories — friends & family chatting. Includes the
// categories produced by the template generator (amizade, dia-a-dia, conversa)
// so those casual templates count as personal, not as a "business vertical".
const PERSONAL = new Set([
  'greeting', 'casual', 'daily', 'social', 'entertainment', 'natural',
  'amizade', 'dia-a-dia', 'conversa',
]);

export interface PairAffinity {
  kind: 'personal' | 'business';
  /** For business pairs: the single vertical this pair sticks to (e.g. imobiliario). */
  vertical?: string;
  /** Template categories this pair is allowed to draw from. */
  categories: string[];
}

function unit(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000;
}

/** Order-independent key so (A,B) and (B,A) resolve to the same relationship. */
function pairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join(':');
}

/**
 * Resolve a pair's relationship from the categories actually available in the
 * template library. ~40% of pairs are "personal" (when personal templates exist),
 * the rest are "customer ↔ one specific business vertical".
 */
export function affinityForPair(idA: string, idB: string, availableCategories: string[]): PairAffinity {
  const key = pairKey(idA, idB);
  const personalCats = availableCategories.filter((c) => PERSONAL.has(c));
  const businessCats = availableCategories.filter((c) => !PERSONAL.has(c));

  const canPersonal = personalCats.length > 0;
  const canBusiness = businessCats.length > 0;

  let kind: 'personal' | 'business';
  if (canPersonal && canBusiness) kind = unit(`${key}:kind`) < 0.4 ? 'personal' : 'business';
  else kind = canPersonal ? 'personal' : 'business';

  if (kind === 'personal') {
    return { kind, categories: personalCats };
  }

  // Stick to ONE business vertical for the whole relationship.
  const vertical = businessCats[Math.floor(unit(`${key}:vertical`) * businessCats.length)] ?? businessCats[0];
  // Allow a "greeting" opener alongside the vertical when greetings exist.
  const categories = availableCategories.includes('greeting') ? ['greeting', vertical] : [vertical];
  return { kind, vertical, categories };
}
