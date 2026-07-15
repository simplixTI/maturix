import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('reconnect-throttle');

interface ThrottleState {
  reconnectedAt: number;
  rampComplete: boolean;
  currentMultiplier: number;
}

export class ReconnectThrottle {
  private states = new Map<string, ThrottleState>();
  private rampDurationMs: number;
  private initialMultiplier: number;
  private rampSteps: number;

  constructor(options?: {
    rampDurationMs?: number;
    initialMultiplier?: number;
    rampSteps?: number;
  }) {
    this.rampDurationMs = options?.rampDurationMs ?? 60000;
    this.initialMultiplier = options?.initialMultiplier ?? 0.1;
    this.rampSteps = options?.rampSteps ?? 6;
  }

  onReconnect(accountId: string): void {
    this.states.set(accountId, {
      reconnectedAt: Date.now(),
      rampComplete: false,
      currentMultiplier: this.initialMultiplier,
    });
    logger.debug({ accountId, initialMultiplier: this.initialMultiplier }, 'Throttle started');
  }

  getMultiplier(accountId: string): number {
    const state = this.states.get(accountId);
    if (!state || state.rampComplete) return 1.0;

    const elapsed = Date.now() - state.reconnectedAt;
    if (elapsed >= this.rampDurationMs) {
      state.rampComplete = true;
      state.currentMultiplier = 1.0;
      return 1.0;
    }

    const progress = elapsed / this.rampDurationMs;
    const step = Math.floor(progress * this.rampSteps);
    const multiplier = this.initialMultiplier + (1.0 - this.initialMultiplier) * (step / this.rampSteps);

    state.currentMultiplier = multiplier;
    return multiplier;
  }

  isThrottled(accountId: string): boolean {
    const state = this.states.get(accountId);
    return !!state && !state.rampComplete;
  }

  removeAccount(accountId: string): void {
    this.states.delete(accountId);
  }

  getState(accountId: string): ThrottleState | undefined {
    return this.states.get(accountId);
  }
}
