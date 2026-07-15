import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('message-mixer');

interface WordPool {
  greetings: string[];
  questions: string[];
  responses: string[];
  closings: string[];
  fillers: string[];
  reactions: string[];
  slang: string[];
  all: string[];
}

export class MessageMixer {
  private pool: WordPool = {
    greetings: [],
    questions: [],
    responses: [],
    closings: [],
    fillers: [],
    reactions: [],
    slang: [],
    all: [],
  };

  private phrases: string[] = [];
  private loaded = false;

  async loadFromTemplates(templatesDir: string): Promise<void> {
    const files = await readdir(templatesDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const allTexts: string[] = [];

    for (const file of jsonFiles) {
      const content = await readFile(join(templatesDir, file), 'utf-8');
      try {
        const templates = JSON.parse(content);
        for (const tpl of templates) {
          if (!tpl.messages) continue;
          for (const msg of tpl.messages) {
            if (msg.text) {
              // Resolve spintax to get all possible words
              const expanded = this.expandSpintax(msg.text);
              allTexts.push(...expanded);
            }
          }
        }
      } catch {}
    }

    // Extract and categorize words/phrases
    for (const text of allTexts) {
      const words = text.split(/\s+/).filter(w => w.length > 0);
      this.pool.all.push(...words);
      this.phrases.push(text);

      // Categorize
      const lower = text.toLowerCase();
      if (/^(oi|ola|eai|fala|bom dia|boa tarde|boa noite|hey|opa)/.test(lower)) {
        this.pool.greetings.push(text);
      } else if (/\?$/.test(text.trim())) {
        this.pool.questions.push(text);
      } else if (/^(sim|nao|claro|pode|beleza|blz|ok|tmj|vlw|valeu)/.test(lower)) {
        this.pool.responses.push(text);
      } else if (/(tchau|ate|falou|flw|bye|fui|bjs|abraco)/.test(lower)) {
        this.pool.closings.push(text);
      } else if (/^(kkk|haha|rsrs|mds|slk|vei|mano|cara)/.test(lower)) {
        this.pool.slang.push(text);
      } else {
        this.pool.fillers.push(text);
      }
    }

    // Deduplicate
    for (const key of Object.keys(this.pool) as (keyof WordPool)[]) {
      this.pool[key] = [...new Set(this.pool[key])];
    }
    this.phrases = [...new Set(this.phrases)];

    this.loaded = true;
    logger.info({
      totalWords: this.pool.all.length,
      totalPhrases: this.phrases.length,
      greetings: this.pool.greetings.length,
      questions: this.pool.questions.length,
      responses: this.pool.responses.length,
      slang: this.pool.slang.length,
    }, 'Message mixer loaded');
  }

  // Generate a mixed message by grabbing random fragments
  generateMixed(): string {
    const strategies = [
      () => this.mixWords(3, 8),
      () => this.mixPhraseFragments(2, 3),
      () => this.grabAndMutate(),
      () => this.frankenMessage(),
      () => this.shortBurst(),
    ];

    const strategy = strategies[Math.floor(Math.random() * strategies.length)];
    return strategy();
  }

  // Generate a conversation pair (initiator + responder messages)
  generateConversation(steps: number = 4): { role: 'initiator' | 'responder'; text: string }[] {
    const msgs: { role: 'initiator' | 'responder'; text: string }[] = [];

    // First message: greeting or random
    msgs.push({
      role: 'initiator',
      text: Math.random() > 0.3 ? this.pickRandom(this.pool.greetings) || this.generateMixed() : this.generateMixed(),
    });

    for (let i = 1; i < steps; i++) {
      const role = i % 2 === 0 ? 'initiator' : 'responder';
      const r = Math.random();

      let text: string;
      if (r < 0.15) {
        // Short response
        text = this.shortBurst();
      } else if (r < 0.3) {
        // Question
        text = this.pickRandom(this.pool.questions) || this.generateMixed();
      } else if (r < 0.5) {
        // Slang/reaction
        text = this.pickRandom(this.pool.slang) || this.shortBurst();
      } else {
        // Mixed
        text = this.generateMixed();
      }

      msgs.push({ role, text });
    }

    // Maybe add closing
    if (Math.random() > 0.5) {
      msgs.push({
        role: steps % 2 === 0 ? 'initiator' : 'responder',
        text: this.pickRandom(this.pool.closings) || this.shortBurst(),
      });
    }

    return msgs;
  }

  // Strategy 1: grab random words and join
  private mixWords(min: number, max: number): string {
    const count = min + Math.floor(Math.random() * (max - min));
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      words.push(this.pickRandom(this.pool.all) || 'kkk');
    }
    let result = words.join(' ');
    result = this.addTypos(result);
    return result;
  }

  // Strategy 2: grab fragments of different phrases and merge
  private mixPhraseFragments(min: number, max: number): string {
    const count = min + Math.floor(Math.random() * (max - min));
    const fragments: string[] = [];

    for (let i = 0; i < count; i++) {
      const phrase = this.pickRandom(this.phrases) || '';
      const words = phrase.split(/\s+/);
      const start = Math.floor(Math.random() * Math.max(1, words.length - 2));
      const len = 1 + Math.floor(Math.random() * 3);
      fragments.push(words.slice(start, start + len).join(' '));
    }

    return this.addTypos(fragments.join(' '));
  }

  // Strategy 3: take a phrase and mutate words randomly
  private grabAndMutate(): string {
    const phrase = this.pickRandom(this.phrases) || 'oi tudo bem';
    const words = phrase.split(/\s+/);

    // Replace 30-50% of words with random words from pool
    const mutated = words.map(w => {
      if (Math.random() < 0.4) {
        return this.pickRandom(this.pool.all) || w;
      }
      return w;
    });

    return this.addTypos(mutated.join(' '));
  }

  // Strategy 4: frankenstein - first half of one phrase + second half of another
  private frankenMessage(): string {
    const a = this.pickRandom(this.phrases) || 'oi tudo';
    const b = this.pickRandom(this.phrases) || 'bem demais';
    const aWords = a.split(/\s+/);
    const bWords = b.split(/\s+/);
    const aMid = Math.floor(aWords.length / 2);
    const bMid = Math.floor(bWords.length / 2);
    const result = [...aWords.slice(0, aMid), ...bWords.slice(bMid)].join(' ');
    return this.addTypos(result);
  }

  // Strategy 5: very short burst (1-3 words, slang)
  private shortBurst(): string {
    const bursts = [
      'kkkkk', 'kkkk', 'kkk', 'hahaha', 'rsrsrs', 'mds', 'slk', 'vdd',
      'serio??', 'ne', 'sim', 'nao', 'nossa', 'eita', 'oxe', 'ata',
      'hmm', 'entendi', 'ah sim', 'blz', 'ok', 'tmj', 'vlw', 'show',
      'pode ser', 'bora', 'partiu', 'dms', 'mano', 'cara', 'vei',
      'pois e', 'tbm acho', 'concordo', 'demais', 'top', 'massa',
      'ai ai', 'pqp', 'meu deus', 'socorro', 'q isso',
    ];

    if (Math.random() < 0.5) {
      return bursts[Math.floor(Math.random() * bursts.length)];
    }

    // Combine 2 short ones
    const a = bursts[Math.floor(Math.random() * bursts.length)];
    const b = bursts[Math.floor(Math.random() * bursts.length)];
    return `${a} ${b}`;
  }

  // Add random typos/mutations
  private addTypos(text: string): string {
    if (Math.random() > 0.3) return text; // 70% no change

    const mutations = [
      (t: string) => t.toLowerCase(),
      (t: string) => t.replace(/\./g, ''),
      (t: string) => t.replace(/,/g, ''),
      (t: string) => t + (Math.random() > 0.5 ? ' kkk' : ' rsrs'),
      (t: string) => t.replace(/você/gi, 'vc'),
      (t: string) => t.replace(/também/gi, 'tbm'),
      (t: string) => t.replace(/porque/gi, 'pq'),
      (t: string) => t.replace(/não/gi, 'nao'),
      (t: string) => t.replace(/está/gi, 'ta'),
    ];

    const mutation = mutations[Math.floor(Math.random() * mutations.length)];
    return mutation(text);
  }

  private expandSpintax(text: string): string[] {
    // Extract all options from spintax and return flat list
    const results: string[] = [];
    const resolved = text.replace(/\{([^{}]+)\}/g, (_match, group: string) => {
      const options = group.split('|');
      results.push(...options);
      return options[Math.floor(Math.random() * options.length)];
    });
    results.push(resolved);
    return results;
  }

  private pickRandom(arr: string[]): string | null {
    if (arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  isLoaded(): boolean { return this.loaded; }
  getStats() {
    return {
      totalWords: this.pool.all.length,
      totalPhrases: this.phrases.length,
      greetings: this.pool.greetings.length,
      questions: this.pool.questions.length,
      responses: this.pool.responses.length,
      slang: this.pool.slang.length,
      fillers: this.pool.fillers.length,
    };
  }
}
