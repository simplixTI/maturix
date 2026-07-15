import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';
import { Card, Button, Badge } from '../components/ui';
import { IconTerminal, IconTrash, IconPause, IconPlay } from '../components/Icons';
import { logLevelName, formatTime } from '../lib/format';
import type { LogEntry } from '../lib/types';

const MAX_LINES = 500;
const LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'];

export function Logs() {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = getSocket();
    const onLog = (entry: LogEntry) => {
      if (pausedRef.current) return;
      setLines((cur) => {
        const next = [...cur, entry];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    };
    socket.on('log:entry', onLog);
    return () => { socket.off('log:entry', onLog); };
  }, []);

  useEffect(() => {
    const el = consoleRef.current;
    if (el && !paused) el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  const filtered = filter === 'ALL' ? lines : lines.filter((l) => logLevelName(l.level) === filter);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Logs do sistema</h1>
          <p>Saída do backend em tempo real via WebSocket.</p>
        </div>
        <div className="toolbar">
          <Badge tone={paused ? 'warning' : 'success'}>{paused ? 'pausado' : 'ao vivo'}</Badge>
          <Button variant="ghost" onClick={() => setPaused((p) => !p)}>{paused ? <IconPlay /> : <IconPause />} {paused ? 'Retomar' : 'Pausar'}</Button>
          <Button variant="ghost" onClick={() => setLines([])}><IconTrash /> Limpar</Button>
        </div>
      </div>

      <div className="row gap-2" style={{ marginBottom: 'var(--space-4)' }}>
        {LEVELS.map((l) => (
          <span key={l} className={`chip ${filter === l ? 'active' : ''}`} onClick={() => setFilter(l)}>{l}</span>
        ))}
        <span className="text-xs muted" style={{ marginLeft: 'auto' }}>{filtered.length} linha(s)</span>
      </div>

      <Card className="pad-0">
        <div className="console" ref={consoleRef}>
          {filtered.length === 0 ? (
            <div className="empty" style={{ height: '100%' }}>
              <IconTerminal />
              <div className="empty-title">Aguardando logs…</div>
              <div className="text-sm">As mensagens do servidor aparecem aqui em tempo real.</div>
            </div>
          ) : (
            filtered.map((l, i) => {
              const lvl = logLevelName(l.level);
              return (
                <div key={i} className="log-line">
                  <span className="log-time">{formatTime(l.time)}</span>
                  <span className={`log-lvl lvl-${lvl}`}>{lvl}</span>
                  {l.module && <span className="log-mod">[{l.module}]</span>}
                  <span>{l.msg}</span>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </>
  );
}
