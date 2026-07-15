const ZERO_WIDTH_CHARS = [
  '​', // zero-width space
  '‌', // zero-width non-joiner
  '‍', // zero-width joiner
  '﻿', // zero-width no-break space
];

const PUNCTUATION_VARIANTS: Record<string, string[]> = {
  '!': ['!', '!!', '!.', ' !'],
  '?': ['?', '??', '?!', ' ?'],
  '.': ['.', '..', '...'],
  ',': [',', ' ,', ', '],
};

const SYNONYM_MAP: Record<string, string[]> = {
  'sim': ['sim', 'ss', 'sii', 'siim', 'claro'],
  'nao': ['nao', 'nn', 'naoo', 'nãoo'],
  'ok': ['ok', 'okk', 'okay', 'blz', 'beleza'],
  'obrigado': ['obrigado', 'obrigadoo', 'vlw', 'valeu', 'tmj'],
  'oi': ['oi', 'oii', 'oie', 'eai', 'opa'],
  'ola': ['ola', 'olaa', 'oie', 'oi'],
  'tudo': ['tudo', 'td', 'tuudo'],
  'voce': ['voce', 'vc', 'você', 'tu'],
  'tambem': ['tambem', 'tb', 'tbm', 'também'],
  'porque': ['porque', 'pq', 'por que'],
};

export class ContentVariator {
  insertZeroWidthChars(text: string, probability: number = 0.02): string {
    if (text.length < 10) return text;

    let result = '';
    for (const char of text) {
      result += char;
      if (Math.random() < probability && char !== ' ') {
        const zwc = ZERO_WIDTH_CHARS[Math.floor(Math.random() * ZERO_WIDTH_CHARS.length)];
        result += zwc;
      }
    }
    return result;
  }

  variatePunctuation(text: string): string {
    let result = text;
    for (const [punct, variants] of Object.entries(PUNCTUATION_VARIANTS)) {
      if (result.endsWith(punct) && Math.random() < 0.3) {
        const variant = variants[Math.floor(Math.random() * variants.length)];
        result = result.slice(0, -punct.length) + variant;
      }
    }
    return result;
  }

  applySynonyms(text: string, probability: number = 0.15): string {
    const words = text.split(' ');
    return words.map(word => {
      const lower = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (SYNONYM_MAP[lower] && Math.random() < probability) {
        const synonyms = SYNONYM_MAP[lower];
        const chosen = synonyms[Math.floor(Math.random() * synonyms.length)];
        // Preserve original capitalization
        if (word[0] === word[0].toUpperCase()) {
          return chosen.charAt(0).toUpperCase() + chosen.slice(1);
        }
        return chosen;
      }
      return word;
    }).join(' ');
  }

  addTypos(text: string, _probability: number = 0.03): string {
    if (text.length < 15 || Math.random() > 0.2) return text;

    const words = text.split(' ');
    const targetIdx = Math.floor(Math.random() * words.length);
    const word = words[targetIdx];

    if (word.length < 4) return text;

    // Swap two adjacent characters
    const charIdx = 1 + Math.floor(Math.random() * (word.length - 2));
    const chars = word.split('');
    [chars[charIdx], chars[charIdx + 1]] = [chars[charIdx + 1], chars[charIdx]];
    words[targetIdx] = chars.join('');

    return words.join(' ');
  }

  variate(text: string): string {
    let result = text;
    result = this.applySynonyms(result, 0.10);
    result = this.variatePunctuation(result);
    // Zero-width chars removed - modern WhatsApp detects and flags them
    return result;
  }
}
