import { describe, it, expect } from 'vitest';
import { resolveSpintax, previewSpintax, countVariations } from '../../src/core/messaging/SpintaxParser.js';

describe('SpintaxParser', () => {
  it('resolves simple spintax', () => {
    const result = resolveSpintax('{Oi|Ola|E ai}');
    expect(['Oi', 'Ola', 'E ai']).toContain(result);
  });

  it('resolves nested spintax', () => {
    const result = resolveSpintax('{Tudo {bem|certo}|Oi}');
    expect(['Tudo bem', 'Tudo certo', 'Oi']).toContain(result);
  });

  it('preserves text outside braces', () => {
    const result = resolveSpintax('Bom dia, {tudo|como} vai?');
    expect(['Bom dia, tudo vai?', 'Bom dia, como vai?']).toContain(result);
  });

  it('handles multiple spintax groups', () => {
    const result = resolveSpintax('{Oi|Ola}, {tudo bem|como vai}?');
    const options = ['Oi, tudo bem?', 'Oi, como vai?', 'Ola, tudo bem?', 'Ola, como vai?'];
    expect(options).toContain(result);
  });

  it('returns plain text unchanged', () => {
    expect(resolveSpintax('Apenas texto normal')).toBe('Apenas texto normal');
  });

  it('handles deeply nested spintax', () => {
    const result = resolveSpintax('{A {B {C|D}|E}|F}');
    expect(['A B C', 'A B D', 'A E', 'F']).toContain(result);
  });

  it('previewSpintax generates multiple variations', () => {
    const results = previewSpintax('{Oi|Ola}', 10);
    expect(results).toHaveLength(10);
    results.forEach(r => expect(['Oi', 'Ola']).toContain(r));
  });

  it('countVariations counts correctly', () => {
    expect(countVariations('{A|B} {C|D}')).toBe(4);
    expect(countVariations('{A|B|C}')).toBe(3);
    expect(countVariations('plain text')).toBe(1);
  });
});
