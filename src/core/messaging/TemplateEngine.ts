import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '../../database/client.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('template-engine');

interface TemplateStep {
  role: 'initiator' | 'responder';
  type: 'text' | 'image' | 'audio' | 'sticker' | 'reaction';
  text?: string;
  emoji?: string;
  mediaCategory?: string;
}

interface ConversationTemplate {
  name: string;
  category: string;
  messages: TemplateStep[];
}

export class TemplateEngine {
  async loadFromFiles(templatesDir: string): Promise<number> {
    const db = getDb();
    let loaded = 0;

    const files = await readdir(templatesDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      const content = await readFile(join(templatesDir, file), 'utf-8');
      const templates: ConversationTemplate[] = JSON.parse(content);

      for (const template of templates) {
        await db.conversationTemplate.upsert({
          where: { id: template.name },
          create: {
            id: template.name,
            name: template.name,
            category: template.category,
            messages: template.messages as any,
          },
          update: {
            name: template.name,
            category: template.category,
            messages: template.messages as any,
          },
        });
        loaded++;
      }
    }

    logger.info({ loaded, files: jsonFiles.length }, 'Templates loaded from files');
    return loaded;
  }

  async pickRandomTemplate(category?: string): Promise<{ id: string; messages: TemplateStep[] } | null> {
    const db = getDb();

    const where: any = { isActive: true };
    if (category) where.category = category;

    const count = await db.conversationTemplate.count({ where });
    if (count === 0) return null;

    const skip = Math.floor(Math.random() * count);
    const template = await db.conversationTemplate.findFirst({
      where,
      skip,
    });

    if (!template) return null;

    return {
      id: template.id,
      messages: template.messages as unknown as TemplateStep[],
    };
  }

  async getTemplatesByCategory(): Promise<Record<string, number>> {
    const db = getDb();
    const templates = await db.conversationTemplate.findMany({
      where: { isActive: true },
      select: { category: true },
    });

    const counts: Record<string, number> = {};
    for (const t of templates) {
      counts[t.category] = (counts[t.category] ?? 0) + 1;
    }
    return counts;
  }
}
