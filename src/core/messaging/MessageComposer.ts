import { readFile } from 'node:fs/promises';
import { resolveSpintax } from './SpintaxParser.js';
import { isMessageTypeAllowed } from '../warmup/WarmupPhase.js';

interface TemplateStep {
  role: 'initiator' | 'responder';
  type: 'text' | 'image' | 'audio' | 'sticker' | 'reaction';
  text?: string;
  emoji?: string;
  mediaCategory?: string;
}

export interface ComposedMessage {
  type: 'text' | 'image' | 'audio' | 'sticker' | 'reaction';
  content: any;
  resolvedText: string;
}

export class MessageComposer {
  composeText(spintaxText: string): ComposedMessage {
    const resolved = resolveSpintax(spintaxText);
    return {
      type: 'text',
      content: { text: resolved },
      resolvedText: resolved,
    };
  }

  composeReaction(spintaxEmoji: string, msgKey: any): ComposedMessage {
    const emoji = resolveSpintax(spintaxEmoji);
    return {
      type: 'reaction',
      content: { react: { text: emoji, key: msgKey } },
      resolvedText: emoji,
    };
  }

  async composeImage(mediaPath: string, captionSpintax?: string): Promise<ComposedMessage> {
    const buffer = await readFile(mediaPath);
    const caption = captionSpintax ? resolveSpintax(captionSpintax) : undefined;
    return {
      type: 'image',
      content: { image: buffer, caption },
      resolvedText: caption ?? '[image]',
    };
  }

  async composeAudio(mediaPath: string): Promise<ComposedMessage> {
    const buffer = await readFile(mediaPath);
    return {
      type: 'audio',
      content: { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true },
      resolvedText: '[audio]',
    };
  }

  async composeSticker(mediaPath: string): Promise<ComposedMessage> {
    const buffer = await readFile(mediaPath);
    return {
      type: 'sticker',
      content: { sticker: buffer },
      resolvedText: '[sticker]',
    };
  }

  async composeFromStep(
    step: TemplateStep,
    warmupDay: number,
    mediaManager?: { pickRandom: (category: string) => string | null }
  ): Promise<ComposedMessage | null> {
    if (!isMessageTypeAllowed(warmupDay, step.type)) {
      if (step.type === 'reaction') return null;
      // Fallback to text for disallowed media types in early warmup
      if (step.text) return this.composeText(step.text);
      return null;
    }

    switch (step.type) {
      case 'text':
        return this.composeText(step.text ?? '');

      case 'reaction':
        return {
          type: 'reaction',
          content: null, // Key will be set by the worker
          resolvedText: resolveSpintax(step.emoji ?? '{👍|😊}'),
        };

      case 'image': {
        const path = mediaManager?.pickRandom('images');
        if (!path) return step.text ? this.composeText(step.text) : null;
        return this.composeImage(path, step.text);
      }

      case 'audio': {
        const path = mediaManager?.pickRandom('audio');
        if (!path) return step.text ? this.composeText(step.text) : null;
        return this.composeAudio(path);
      }

      case 'sticker': {
        const path = mediaManager?.pickRandom('stickers');
        if (!path) return null;
        return this.composeSticker(path);
      }

      default:
        return null;
    }
  }
}
