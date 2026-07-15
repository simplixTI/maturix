import { describe, it, expect } from 'vitest';
import { shouldActNow } from '../../src/utils/circadian.js';
import { activeWindow } from '../../src/utils/accountIdentity.js';

describe('Circadian desync — per-account waking window', () => {
  const ACC = 'chip-desync-1';

  it('never acts outside its own waking window (deterministic gate)', () => {
    const { start } = activeWindow(ACC);
    const asleepHour = (start - 2 + 24) % 24; // a couple hours before waking
    for (let i = 0; i < 200; i++) {
      expect(shouldActNow(asleepHour, ACC)).toBe(false);
    }
  });

  it('is silent at 4 AM for every account', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      // 4 AM is before the earliest possible wake hour (6), so always asleep.
      expect(shouldActNow(4, `chip-${id}`)).toBe(false);
    }
  });

  it('can act during its peak window (not always false)', () => {
    const { start, end } = activeWindow(ACC);
    const midday = Math.floor((start + end) / 2);
    let acted = false;
    for (let i = 0; i < 500 && !acted; i++) {
      if (shouldActNow(midday, ACC)) acted = true;
    }
    expect(acted).toBe(true);
  });
});
