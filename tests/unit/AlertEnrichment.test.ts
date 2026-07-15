import { describe, it, expect } from 'vitest';
import { formatPhoneBR } from '../../src/services/alertLog.js';

describe('Alert enrichment — phone formatting', () => {
  it('formats a full BR mobile number', () => {
    expect(formatPhoneBR('5524992228389')).toBe('+55 (24) 99222-8389');
  });

  it('formats an 8-digit (landline-style) number', () => {
    expect(formatPhoneBR('551133224455')).toBe('+55 (11) 3322-4455');
  });

  it('strips non-digits before formatting', () => {
    expect(formatPhoneBR('+55 (24) 99222-8389')).toBe('+55 (24) 99222-8389');
  });

  it('returns empty string for empty/nullish input', () => {
    expect(formatPhoneBR('')).toBe('');
    expect(formatPhoneBR(null)).toBe('');
    expect(formatPhoneBR(undefined)).toBe('');
  });

  it('falls back to +digits for unexpected formats', () => {
    expect(formatPhoneBR('12345')).toBe('+12345');
  });
});
