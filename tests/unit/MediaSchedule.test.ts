import { describe, it, expect } from 'vitest';
import {
  isMediaTypeAllowedOnDay, mediaTypesForDay, poolCategoryFor,
} from '../../src/config/media-schedule.js';

describe('MediaSchedule — per-day media unlocking', () => {
  it('photos unlock on day 4 (Expansion), not before', () => {
    expect(isMediaTypeAllowedOnDay('image', 3)).toBe(false);
    expect(isMediaTypeAllowedOnDay('image', 4)).toBe(true);
  });

  it('stickers unlock on day 4', () => {
    expect(isMediaTypeAllowedOnDay('sticker', 3)).toBe(false);
    expect(isMediaTypeAllowedOnDay('sticker', 4)).toBe(true);
  });

  it('voice (audio) unlocks on day 6 (Scaling)', () => {
    expect(isMediaTypeAllowedOnDay('audio', 5)).toBe(false);
    expect(isMediaTypeAllowedOnDay('audio', 6)).toBe(true);
  });

  it('video unlocks on day 8 and only every other day', () => {
    expect(isMediaTypeAllowedOnDay('video', 7)).toBe(false);
    expect(isMediaTypeAllowedOnDay('video', 8)).toBe(true);
    expect(isMediaTypeAllowedOnDay('video', 9)).toBe(false); // everyNDays: 2
    expect(isMediaTypeAllowedOnDay('video', 10)).toBe(true);
  });

  it('Foundation days (1-3) unlock no media at all', () => {
    expect(mediaTypesForDay(1)).toEqual([]);
    expect(mediaTypesForDay(3)).toEqual([]);
  });

  it('a mature day unlocks the full mix', () => {
    const types = mediaTypesForDay(8);
    expect(types).toContain('image');
    expect(types).toContain('sticker');
    expect(types).toContain('audio');
    expect(types).toContain('video');
  });

  it('maps media types to the correct pool category', () => {
    expect(poolCategoryFor('image')).toBe('images');
    expect(poolCategoryFor('audio')).toBe('audio');
    expect(poolCategoryFor('video')).toBe('video');
    expect(poolCategoryFor('sticker')).toBe('sticker');
  });
});
