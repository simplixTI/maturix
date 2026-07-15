import pino from 'pino';
import { EventEmitter } from 'eventemitter3';

const logBus = new EventEmitter();

export function onLogEntry(handler: (entry: { level: string; module: string; message: string }) => void) {
  logBus.on('log', handler);
  return () => { logBus.off('log', handler); };
}

const levelNames: Record<number, string> = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' };

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

export function createChildLogger(module: string) {
  const child = logger.child({ module });

  const origInfo = child.info.bind(child);
  const origWarn = child.warn.bind(child);
  const origError = child.error.bind(child);

  (child as any).info = (...args: any[]) => {
    (origInfo as (...a: any[]) => void)(...args);
    const msg = typeof args[0] === 'string' ? args[0] : typeof args[1] === 'string' ? args[1] : '';
    logBus.emit('log', { level: 'INFO', module, message: msg });
  };
  (child as any).warn = (...args: any[]) => {
    (origWarn as (...a: any[]) => void)(...args);
    const msg = typeof args[0] === 'string' ? args[0] : typeof args[1] === 'string' ? args[1] : '';
    logBus.emit('log', { level: 'WARN', module, message: msg });
  };
  (child as any).error = (...args: any[]) => {
    (origError as (...a: any[]) => void)(...args);
    const msg = typeof args[0] === 'string' ? args[0] : typeof args[1] === 'string' ? args[1] : '';
    logBus.emit('log', { level: 'ERROR', module, message: msg });
  };

  return child;
}
