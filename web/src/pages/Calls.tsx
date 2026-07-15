import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, del } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Card, Badge, Button, Loading, Empty, Stat } from '../components/ui';
import { useToast } from '../components/Toast';
import { IconPhone, IconRefresh, IconTrash } from '../components/Icons';
import { formatPhone, formatDateTime } from '../lib/format';

interface CallEntry {
  id: string;
  accountId: string;
  accountPhone?: string | null;
  fromJid: string;
  fromPhone?: string | null;
  isVideo: boolean;
  action: string;
  createdAt: string;
}
interface CallsResponse {
  calls: CallEntry[];
  stats: { total: number; today: number };
}

export function Calls() {
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['calls'],
    queryFn: () => get<CallsResponse>('/api/calls'),
    refetchInterval: 20_000,
  });

  // Live: refresh when a call is rejected in real time.
  useEffect(() => {
    const socket = getSocket();
    const onCall = () => qc.invalidateQueries({ queryKey: ['calls'] });
    socket.on('call:rejected', onCall);
    return () => { socket.off('call:rejected', onCall); };
  }, [qc]);

  async function clearHistory() {
    try {
      await del('/api/calls');
      toast.success('Histórico de chamadas limpo');
      qc.invalidateQueries({ queryKey: ['calls'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha');
    }
  }

  if (isLoading) return <Loading label="Carregando chamadas…" />;

  const calls = data?.calls ?? [];
  const stats = data?.stats;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chamadas</h1>
          <p>Ligações recebidas são rejeitadas automaticamente (anti-ban). Histórico abaixo.</p>
        </div>
        <div className="toolbar">
          <Button variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ['calls'] })}><IconRefresh /> Atualizar</Button>
          {calls.length > 0 && <Button variant="ghost" onClick={clearHistory}><IconTrash /> Limpar histórico</Button>}
        </div>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <Stat label="Rejeitadas hoje" value={stats?.today ?? 0} accent icon={<IconPhone />} foot="auto-rejeitadas" />
        <Stat label="Total" value={stats?.total ?? 0} icon={<IconPhone />} foot="desde o início" />
      </div>

      {calls.length === 0 ? (
        <Card>
          <Empty
            icon={<IconPhone />}
            title="Nenhuma chamada recebida"
            hint="Quando alguém ligar para uma conta, a chamada será rejeitada na hora e aparecerá aqui."
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Conta (recebeu)</th>
                <th>De (chamador)</th>
                <th>Tipo</th>
                <th>Ação</th>
                <th>Quando</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.accountPhone ? formatPhone(c.accountPhone) : '—'}</td>
                  <td className="mono">{c.fromPhone ? formatPhone(c.fromPhone) : c.fromJid}</td>
                  <td><Badge tone={c.isVideo ? 'info' : 'neutral'} dot={false}>{c.isVideo ? 'vídeo' : 'voz'}</Badge></td>
                  <td><Badge tone="warning" dot={false}>rejeitada</Badge></td>
                  <td className="text-xs muted">{formatDateTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
