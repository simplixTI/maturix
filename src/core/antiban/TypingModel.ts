import type { WASocket } from '@whiskeysockets/baileys';
import { gaussianClamp, sleep } from '../../utils/gaussian.js';

interface TypingPlan {
  totalDurationMs: number;
  segments: TypingSegment[];
}

interface TypingSegment {
  type: 'typing' | 'thinking_pause' | 'distraction_pause';
  durationMs: number;
}

const DEFAULT_WPM = 45;
const DEFAULT_WPM_STDDEV = 15;
const CHARS_PER_WORD = 5;
const THINK_PAUSE_PROBABILITY = 0.08;
const THINK_PAUSE_MIN_MS = 800;
const THINK_PAUSE_MAX_MS = 3500;
const DISTRACTION_PROBABILITY = 0.05;
const DISTRACTION_MIN_MS = 2000;
const DISTRACTION_MAX_MS = 8000;

export class TypingModel {
  private wpm: number;
  private wpmStdDev: number;

  constructor(wpm: number = DEFAULT_WPM, wpmStdDev: number = DEFAULT_WPM_STDDEV) {
    this.wpm = wpm;
    this.wpmStdDev = wpmStdDev;
  }

  computeTypingPlan(messageLength: number): TypingPlan {
    const actualWpm = gaussianClamp(this.wpm, this.wpmStdDev, 20, 90);
    const charsPerMinute = actualWpm * CHARS_PER_WORD;
    const msPerChar = 60000 / charsPerMinute;
    const baseTypingMs = messageLength * msPerChar;

    const segments: TypingSegment[] = [];
    let remaining = baseTypingMs;
    const chunkSize = remaining / Math.max(1, Math.ceil(messageLength / 20));

    while (remaining > 0) {
      const typingDuration = Math.min(remaining, gaussianClamp(chunkSize, chunkSize * 0.3, 500, 10000));
      segments.push({ type: 'typing', durationMs: Math.round(typingDuration) });
      remaining -= typingDuration;

      if (remaining > 500 && Math.random() < THINK_PAUSE_PROBABILITY) {
        const pauseMs = gaussianClamp(
          (THINK_PAUSE_MIN_MS + THINK_PAUSE_MAX_MS) / 2,
          800,
          THINK_PAUSE_MIN_MS,
          THINK_PAUSE_MAX_MS
        );
        segments.push({ type: 'thinking_pause', durationMs: Math.round(pauseMs) });
      }

      if (remaining > 1000 && Math.random() < DISTRACTION_PROBABILITY) {
        const distractionMs = gaussianClamp(
          (DISTRACTION_MIN_MS + DISTRACTION_MAX_MS) / 2,
          2000,
          DISTRACTION_MIN_MS,
          DISTRACTION_MAX_MS
        );
        segments.push({ type: 'distraction_pause', durationMs: Math.round(distractionMs) });
      }
    }

    const totalDurationMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
    const clamped = Math.max(2000, Math.min(60000, totalDurationMs));

    if (totalDurationMs !== clamped) {
      const ratio = clamped / totalDurationMs;
      for (const segment of segments) {
        segment.durationMs = Math.round(segment.durationMs * ratio);
      }
    }

    return {
      totalDurationMs: segments.reduce((sum, s) => sum + s.durationMs, 0),
      segments,
    };
  }

  async executeTypingPlan(sock: WASocket, jid: string, plan: TypingPlan): Promise<void> {
    await sock.presenceSubscribe(jid);

    for (const segment of plan.segments) {
      switch (segment.type) {
        case 'typing':
          await sock.sendPresenceUpdate('composing', jid);
          await sleep(segment.durationMs);
          break;

        case 'thinking_pause':
          await sock.sendPresenceUpdate('paused', jid);
          await sleep(segment.durationMs);
          break;

        case 'distraction_pause':
          await sock.sendPresenceUpdate('paused', jid);
          await sleep(segment.durationMs);
          break;
      }
    }

    await sock.sendPresenceUpdate('paused', jid);
  }
}
