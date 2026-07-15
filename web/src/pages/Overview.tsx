import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { get, post } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Card, Stat, Loading, Badge, Button, Empty } from '../components/ui';
import { Modal } from '../components/Modal';
import {
  IconPhone, IconFlame, IconShield, IconPower, IconPlay, IconStop, IconBell, IconChat,
} from '../components/Icons';
import { useToast } from '../components/Toast';
import {
  ALERT_TYPE_LABELS, SEVERITY_TONE, formatNumber, relativeTime, formatPhone, RISK_LABELS, RISK_TONE,
} from '../lib/format';

interface ActiveConv {
  id: string;
  status: string;
  initiator: { phone: string; name: string | null } | null;
  responder: { phone: string; name: string | null } | null;
  category: string | null;
  currentStep: number;
  totalSteps: number;
}
import type { AccountsOverview, AccountMetrics, Alert, TodayMetrics, WarmupStatus } from '../lib/types';

interface LiveTotals { sent: number; received: number }

export function Overview() {
  const toast = useToast();
  const [live, setLive] = useState<LiveTotals | null>(null);
  const [convOpen, setConvOpen] = useState(false);
  const activeConvsQuery = useQuery({
    queryKey: ['active-convs'],
    queryFn: () => get<ActiveConv[]>('/api/conversations/active'),
    enabled: convOpen,
    refetchInterval: convOpen ? 5_000 : false,
  });

  const overview = useQuery({ queryKey: ['overview'], queryFn: () => get<AccountsOverview>('/api/accounts/stats/overview'), refetchInterval: 15_000 });
  const conversations = useQuery({
    queryKey: ['conv-pairs'],
    queryFn: () => get<{ status: string }[]>('/api/conversations'),
    refetchInterval: 12_000,
  });
  const today = useQuery({ queryKey: ['today'], queryFn: () => get<TodayMetrics>('/api/metrics/today'), refetchInterval: 15_000 });
  const metrics = useQuery({ queryKey: ['metrics', 14], queryFn: () => get<AccountMetrics[]>('/api/metrics?days=14') });
  const alerts = useQuery({ queryKey: ['alerts', 'recent'], queryFn: () => get<Alert[]>('/api/alerts') });
  const warmup = useQuery({ queryKey: ['warmup-status'], queryFn: () => get<WarmupStatus>('/api/warmup/status'), refetchInterval: 10_000 });

  useEffect(() => {
    const socket = getSocket();
    const onMetrics = (m: { totals?: LiveTotals }) => {
      if (m?.totals) setLive(m.totals);
    };
    socket.on('metrics:update', onMetrics);
    return () => { socket.off('metrics:update', onMetrics); };
  }, []);

  const chartData = useMemo(() => {
    const list = metrics.data ?? [];
    const byDate = new Map<string, { date: string; enviadas: number; recebidas: number }>();
    for (const m of list) {
      const key = new Date(m.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const cur = byDate.get(key) ?? { date: key, enviadas: 0, recebidas: 0 };
      cur.enviadas += m.messagesSent;
      cur.recebidas += m.messagesReceived;
      byDate.set(key, cur);
    }
    return Array.from(byDate.values());
  }, [metrics.data]);

  async function toggleWarmup() {
    const running = warmup.data?.warmupRunning;
    try {
      await post(running ? '/api/warmup/stop' : '/api/warmup/start');
      toast.success(running ? 'Aquecimento parado' : 'Aquecimento iniciado');
      warmup.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao alterar aquecimento');
    }
  }

  if (overview.isLoading) return <Loading label="Carregando indicadores…" />;

  const ov = overview.data;
  const todayTotals = live ?? today.data?.totals;
  const running = warmup.data?.warmupRunning;
  const recentAlerts = (alerts.data ?? []).slice(0, 6);
  const convList = conversations.data ?? [];
  const activeConvs = convList.filter((c) => c.status === 'ACTIVE' || c.status === 'PENDING').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Visão geral</h1>
          <p>Estado da operação de aquecimento em tempo real.</p>
        </div>
        <div className="toolbar">
          <Badge tone={running ? 'success' : 'neutral'}>
            {running ? 'Motor ativo' : 'Motor parado'}
          </Badge>
          <Button variant={running ? 'danger' : 'primary'} onClick={toggleWarmup}>
            {running ? <IconStop /> : <IconPlay />}
            {running ? 'Parar aquecimento' : 'Iniciar aquecimento'}
          </Button>
        </div>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <Stat label="Contas totais" value={formatNumber(ov?.total ?? 0)} icon={<IconPhone />} foot={`${ov?.connected ?? 0} conectadas agora`} />
        <Stat label="Conectadas" value={formatNumber(ov?.connected ?? 0)} accent icon={<IconPower />} foot="sessões ativas" />
        <Stat label="Em aquecimento" value={formatNumber(ov?.warming ?? 0)} icon={<IconFlame />} foot="dia 1–14" />
        <Stat label="Conversas ativas" value={formatNumber(activeConvs)} accent={running} icon={<IconChat />} foot={running ? 'clique para ver quais' : 'motor parado'} onClick={() => setConvOpen(true)} />
        <Stat label="Em risco" value={formatNumber(ov?.atRisk ?? 0)} icon={<IconShield />} foot={`${ov?.banned ?? 0} banidas · ${ov?.paused ?? 0} pausadas`} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 'var(--space-5)' }}>
        <Card className="span-2">
          <div className="card-head">
            <div>
              <div className="card-title">Mensagens · últimos 14 dias</div>
              <div className="card-sub">Enviadas vs. recebidas, agregadas por dia</div>
            </div>
            <div className="row gap-4 text-xs muted">
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--accent)' }} /> Enviadas</span>
              <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--info)' }} /> Recebidas</span>
            </div>
          </div>
          {chartData.length === 0 ? (
            <Empty title="Sem métricas ainda" hint="Os dados aparecem após o primeiro dia de aquecimento." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gRecv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--info)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-faint)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-faint)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--line-strong)', borderRadius: 10, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-soft)' }}
                />
                <Area type="monotone" dataKey="enviadas" stroke="var(--accent)" strokeWidth={2} fill="url(#gSent)" />
                <Area type="monotone" dataKey="recebidas" stroke="var(--info)" strokeWidth={2} fill="url(#gRecv)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <div className="card-head">
            <div className="card-title">Atividade de hoje</div>
            <Badge tone="info" dot={false}>{live ? 'ao vivo' : 'atualiza a cada 15s'}</Badge>
          </div>
          <div className="row gap-5" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="col">
              <span className="stat-value stat-accent">{formatNumber(todayTotals?.sent ?? 0)}</span>
              <span className="stat-label">enviadas hoje</span>
            </div>
            <div className="col">
              <span className="stat-value">{formatNumber(todayTotals?.received ?? 0)}</span>
              <span className="stat-label">recebidas hoje</span>
            </div>
          </div>
          <div className="divider" />
          <div className="col gap-2">
            {(today.data?.accounts ?? []).slice(0, 5).map((a) => (
              <div key={a.id} className="row-between text-sm">
                <span className="mono">{a.phoneNumber}</span>
                <span className="row gap-2">
                  <Badge tone={RISK_TONE[a.banRisk]} dot={false}>{RISK_LABELS[a.banRisk]}</Badge>
                  <span className="muted">dia {a.warmupDay}</span>
                  <span className="mono" style={{ minWidth: 40, textAlign: 'right' }}>{a.msgsSentToday}↑</span>
                </span>
              </div>
            ))}
            {(today.data?.accounts ?? []).length === 0 && <span className="muted text-sm">Nenhuma conta ativa hoje.</span>}
          </div>
        </Card>

        <Card>
          <div className="card-head">
            <div className="card-title">Alertas recentes</div>
            <Link to="/alertas" className="text-xs" style={{ color: 'var(--accent)' }}>ver todos →</Link>
          </div>
          {recentAlerts.length === 0 ? (
            <Empty icon={<IconBell />} title="Nenhum alerta" hint="Tudo tranquilo por aqui." />
          ) : (
            <div className="col gap-2">
              {recentAlerts.map((a) => (
                <div key={a.id} className="row gap-4" style={{ alignItems: 'flex-start', padding: '6px 0' }}>
                  <Badge tone={SEVERITY_TONE[a.severity]} dot={false}>{a.severity}</Badge>
                  <div className="col grow">
                    <span className="text-sm">{ALERT_TYPE_LABELS[a.type] || a.type}</span>
                    <span className="text-xs muted">{a.message}</span>
                  </div>
                  <span className="text-xs muted" style={{ whiteSpace: 'nowrap' }}>{relativeTime(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={convOpen} onClose={() => setConvOpen(false)} title="Conversas ativas agora">
        {activeConvsQuery.isLoading ? (
          <Loading label="Carregando…" />
        ) : (activeConvsQuery.data ?? []).length === 0 ? (
          <Empty
            icon={<IconChat />}
            title="Nenhuma conversa ativa agora"
            hint={running ? 'Os chips fizeram a cota do momento — aguardando a próxima rodada.' : 'O motor de aquecimento está parado.'}
          />
        ) : (
          <div className="col gap-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {(activeConvsQuery.data ?? []).map((c) => (
              <div key={c.id} className="row gap-4" style={{ alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'} dot={false}>
                  {c.status === 'ACTIVE' ? 'ativa' : 'agendada'}
                </Badge>
                <div className="col grow">
                  <span className="text-sm mono">
                    {c.initiator ? formatPhone(c.initiator.phone) : '?'} → {c.responder ? formatPhone(c.responder.phone) : '?'}
                  </span>
                  <span className="text-xs muted">
                    {c.category ?? 'conversa'}{c.totalSteps ? ` · passo ${c.currentStep + 1}/${c.totalSteps}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
