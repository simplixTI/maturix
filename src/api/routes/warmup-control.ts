import type { FastifyPluginAsync } from 'fastify';
import { setWarmupRunning, isWarmupRunning } from '../../config/warmupRunState.js';

export const warmupControlRoutes: FastifyPluginAsync = async (app) => {
  app.get('/status', async () => {
    const deps = (app as any).deps;
    const engine = deps.warmupEngine;
    const convService = deps.conversationService;
    return {
      warmupRunning: !!engine?.tickInterval,
      conversationRunning: !!convService?.tickInterval,
      persistedRunning: isWarmupRunning(),
    };
  });

  app.post('/start', async () => {
    const deps = (app as any).deps;
    deps.warmupEngine?.start(60000);
    deps.conversationService?.start(30000);
    // Persist so a restart/deploy resumes warming instead of silently stopping it.
    await setWarmupRunning(true);
    return { status: 'started' };
  });

  app.post('/stop', async () => {
    const deps = (app as any).deps;
    deps.warmupEngine?.stop();
    deps.conversationService?.stop();
    await setWarmupRunning(false);
    return { status: 'stopped' };
  });
};
