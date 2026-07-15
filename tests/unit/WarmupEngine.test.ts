import { describe, it, expect } from 'vitest';
import { getWarmupProfile, getAllProfiles } from '../../src/config/warmup-profiles.js';
import { getPhaseForDay, getStageForDay, isMessageTypeAllowed, WarmupStage } from '../../src/core/warmup/WarmupPhase.js';

describe('WarmupProfiles', () => {
  it('day 1 limit is 15', () => {
    const profile = getWarmupProfile(1);
    expect(profile.dailyLimit).toBe(15);
  });

  it('limits increase each day', () => {
    const profiles = getAllProfiles();
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i].dailyLimit).toBeGreaterThanOrEqual(profiles[i - 1].dailyLimit);
    }
  });

  it('daily limit is capped at 500', () => {
    const profile = getWarmupProfile(10);
    expect(profile.dailyLimit).toBeLessThanOrEqual(500);
  });

  it('msgs per hour max never exceeds 30', () => {
    for (let day = 1; day <= 14; day++) {
      const profile = getWarmupProfile(day);
      expect(profile.msgsPerHourMax).toBeLessThanOrEqual(30);
    }
  });

  it('new contacts max never exceeds 20', () => {
    for (let day = 1; day <= 14; day++) {
      const profile = getWarmupProfile(day);
      expect(profile.newContactsMax).toBeLessThanOrEqual(20);
    }
  });
});

describe('WarmupPhase', () => {
  it('day 0 is NOT_STARTED', () => {
    expect(getStageForDay(0)).toBe(WarmupStage.NOT_STARTED);
  });

  it('days 1-3 are FOUNDATION', () => {
    expect(getStageForDay(1)).toBe(WarmupStage.FOUNDATION);
    expect(getStageForDay(3)).toBe(WarmupStage.FOUNDATION);
  });

  it('days 4-5 are EXPANSION', () => {
    expect(getStageForDay(4)).toBe(WarmupStage.EXPANSION);
    expect(getStageForDay(5)).toBe(WarmupStage.EXPANSION);
  });

  it('days 6-7 are SCALING', () => {
    expect(getStageForDay(6)).toBe(WarmupStage.SCALING);
    expect(getStageForDay(7)).toBe(WarmupStage.SCALING);
  });

  it('day 8+ is MATURE', () => {
    expect(getStageForDay(8)).toBe(WarmupStage.MATURE);
    expect(getStageForDay(100)).toBe(WarmupStage.MATURE);
  });

  it('foundation only allows text and reaction', () => {
    expect(isMessageTypeAllowed(1, 'text')).toBe(true);
    expect(isMessageTypeAllowed(1, 'reaction')).toBe(true);
    expect(isMessageTypeAllowed(1, 'image')).toBe(false);
    expect(isMessageTypeAllowed(1, 'audio')).toBe(false);
  });

  it('expansion adds image and sticker', () => {
    expect(isMessageTypeAllowed(4, 'text')).toBe(true);
    expect(isMessageTypeAllowed(4, 'image')).toBe(true);
    expect(isMessageTypeAllowed(4, 'sticker')).toBe(true);
    expect(isMessageTypeAllowed(4, 'audio')).toBe(false);
  });

  it('scaling adds audio', () => {
    expect(isMessageTypeAllowed(6, 'audio')).toBe(true);
  });

  it('mature allows everything', () => {
    expect(isMessageTypeAllowed(8, 'text')).toBe(true);
    expect(isMessageTypeAllowed(8, 'image')).toBe(true);
    expect(isMessageTypeAllowed(8, 'audio')).toBe(true);
    expect(isMessageTypeAllowed(8, 'sticker')).toBe(true);
  });
});
