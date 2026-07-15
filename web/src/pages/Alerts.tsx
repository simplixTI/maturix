import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Card, Badge, Button, Loading, Empty, Stat } from '../components/ui';
import { useToast } from '../components/Toast';
import { IconBell, IconCheck, IconRefresh } from '../components/Icons';
import { ALERT_TYPE_LABELS, SEVERITY_TONE, relativeTime } from '../lib/format';
import type { Alert, AlertStats } from '../lib/types';

export function Alerts() {
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unack'>('all');

  const stats = useQuery({ queryKey: ['alert-stats'], queryFn: () => get<AlertStats>('/api/alerts/stats') });
  const list = useQuery({
    queryKey: ['alerts', filter],
    queryFn: () => get<Alert[]>(filter === 'unack' ? '/api/alerts/unacknowledged' : '/api/alerts'),
  });

  useEffect(() => {
    const socket = getSocket();
    const onNew = () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alert-stats'] });
    };
    socket.on('alert:new', onNew);
    return () => { socket.off('alert:new', onNew); };
  }, [qc]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ['alerts'] });
    qc.invalidateQueries({ queryKey: ['alert-stats'] });
  }

  async function ack(id: string) {
    try { await patch(`/api/alerts/${id}/acknowledge`, {}); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }
  async function ackAll() {
    try { await post('/api/alerts/acknowledge-all'); toast.success('Todos marcados como lidos'); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }

  if (list.isLoading) return <Loading label="Carregando alertas…" />;
  const alerts = list.data ?? [];
  const s = stats.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alertas</h1>
          <p>Eventos de risco do sistema anti-ban nas últimas 24h.</p>
        </div>
        <div className="toolbar">
          <Button variant="ghost" onClick={refresh}><IconRefresh /> Atualizar</Button>
          <Button variant="primary" onClick={ackAll}><IconCheck /> Marcar todos como lidos</Button>
        </div>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <Stat label="Total (24h)" value={s?.total ?? 0} icon={<IconBell />} />
        <Stat label="Não lidos" value={s?.unacknowledged ?? 0} accent />
        <Stat label="Críticos" value={s?.critical ?? 0} foot="prioridade máxima" />
        <Stat label="Avisos" value={s?.warning ?? 0} />
      </div>

      <div className="row gap-2" style={{ marginBottom: 'var(--space-4)' }}>
        <span className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Todos</span>
        <span className={`chip ${filter === 'unack' ? 'active' : ''}`} onClick={() => setFilter('unack')}>Não lidos</span>
      </div>

      {alerts.length === 0 ? (
        <Card><Empty icon={<IconBell />} title="Nenhum alerta" hint="Sem eventos de risco no momento." /></Card>
      ) : (
        <div className="col gap-2">
          {alerts.map((a) => (
            <Card key={a.id} style={{ padding: 'var(--space-4) var(--space-5)', opacity: a.acknowledged ? 0.6 : 1 }}>
              <div className="row gap-4" style={{ alignItems: 'flex-start' }}>
                <Badge tone={SEVERITY_TONE[a.severity]} dot={false}>{a.severity}</Badge>
                <div className="col grow">
                  <span style={{ fontWeight: 600 }}>{ALERT_TYPE_LABELS[a.type] || a.type}</span>
                  <span className="text-sm muted">{a.message}</span>
                </div>
                <div className="row gap-4">
                  <span className="text-xs muted" style={{ whiteSpace: 'nowrap' }}>{relativeTime(a.createdAt)}</span>
                  {!a.acknowledged && (
                    <Button size="sm" variant="ghost" onClick={() => ack(a.id)} title="Marcar como lido"><IconCheck /></Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
