import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { get, post, patch } from '../lib/api';
import { Card, Badge, Button, Loading, Empty, Stat, KpiBar } from '../components/ui';
import { useToast } from '../components/Toast';
import { FleetIdentityCard } from '../components/FleetIdentityCard';
import { IconPlay, IconStop, IconPause, IconFlame } from '../components/Icons';
import {
  formatPhone, formatPercent, RISK_LABELS, RISK_TONE, STATUS_LABELS, STATUS_TONE,
} from '../lib/format';
import type { Account, WarmupStatus } from '../lib/types';

// Warmup ramp targets day 1..15+ (mirrors backend defaults for display only).
function dayTarget(day: number): number {
  if (day <= 0) return 0;
  const base = 15;
  const t = Math.round(base * Math.pow(1.35, Math.max(0, day - 1)));
  return Math.min(t, 400);
}

export function Warmup() {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const status = useQuery({ queryKey: ['warmup-status'], queryFn: () => get<WarmupStatus>('/api/warmup/status'), refetchInterval: 8_000 });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => get<Account[]>('/api/accounts'), refetchInterval: 15_000 });

  const running = status.data?.warmupRunning;
  const convRunning = status.data?.conversationRunning;

  async function toggle(start: boolean) {
    setBusy(true);
    try {
      await post(start ? '/api/warmup/start' : '/api/warmup/stop');
      toast.success(start ? 'Motor de aquecimento iniciado' : 'Motor de aquecimento parado');
      status.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(a: Account) {
    try {
      await patch(`/api/accounts/${a.id}`, { isPaused: !a.isPaused });
      toast.success(a.isPaused ? 'Conta retomada' : 'Conta pausada');
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha');
    }
  }

  if (status.isLoading || accounts.isLoading) return <Loading label="Carregando aquecimento…" />;

  const list = (accounts.data ?? []).filter((a) => a.status !== 'BANNED');
  const warming = list.filter((a) => a.warmupDay > 0 && a.warmupDay < 15);
  const graduated = list.filter((a) => a.warmupDay >= 15);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Aquecimento</h1>
          <p>Motor de mensagens automáticas entre as contas do pool.</p>
        </div>
        <div className="toolbar">
          <Badge tone={running ? 'success' : 'neutral'}>{running ? 'Motor ativo' : 'Motor parado'}</Badge>
          <Button variant={running ? 'danger' : 'primary'} loading={busy} onClick={() => toggle(!running)}>
            {running ? <IconStop /> : <IconPlay />} {running ? 'Parar' : 'Iniciar'}
          </Button>
        </div>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <Stat label="Em aquecimento" value={warming.length} icon={<IconFlame />} foot="dia 1 a 14" />
        <Stat label="Maduras (15+)" value={graduated.length} accent foot="prontas para produção" />
        <Stat label="Motor de conversas" value={convRunning ? 'ON' : 'OFF'} foot="diálogos simulados" />
        <Stat label="Contas no pool" value={list.length} foot="excluindo banidas" />
      </div>

      <FleetIdentityCard />

      <Card className="pad-0">
        <div className="card-head" style={{ padding: 'var(--space-5)', marginBottom: 0 }}>
          <div>
            <div className="card-title">Progresso por conta</div>
            <div className="card-sub">Curva de rampa diária e taxas de saúde</div>
          </div>
        </div>
        {list.length === 0 ? (
          <Empty title="Sem contas para aquecer" hint="Conecte números na aba Contas." />
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Status</th>
                  <th style={{ minWidth: 180 }}>Progresso (dia {0}/15)</th>
                  <th className="num">Limite hoje</th>
                  <th className="num" title="Mensagens enviadas na janela móvel de 24h (base do cálculo de risco)">Msgs 24h</th>
                  <th className="num" title="Respostas recebidas ÷ enviadas (24h). Baixo = sinal de risco">Resp.</th>
                  <th className="num" title="Falhas de envio ÷ enviadas (24h). Alto = sinal de risco">Bloq.</th>
                  <th>Risco</th>
                  <th style={{ textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const pct = Math.min(100, (a.warmupDay / 15) * 100);
                  const target = dayTarget(a.warmupDay);
                  const usedPct = target > 0 ? (a.msgsSentToday / target) * 100 : 0;
                  return (
                    <tr key={a.id}>
                      <td className="mono">{formatPhone(a.phoneNumber)}</td>
                      <td><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABELS[a.status]}</Badge></td>
                      <td>
                        <div className="col gap-2">
                          <KpiBar value={pct} />
                          <span className="text-xs muted">dia {a.warmupDay} de 15{a.isPaused ? ' · pausada' : ''}</span>
                        </div>
                      </td>
                      <td className="num">
                        <div className="col" style={{ alignItems: 'flex-end' }}>
                          <span>{a.msgsSentToday}/{target}</span>
                          <div style={{ width: 64 }}><KpiBar value={usedPct} /></div>
                        </div>
                      </td>
                      <td className="num mono">{a.warmupState?.totalMessagesSent ?? 0}</td>
                      <td className="num">{formatPercent(a.warmupState?.replyRate)}</td>
                      <td className="num">{formatPercent(a.warmupState?.blockRate)}</td>
                      <td><Badge tone={RISK_TONE[a.banRisk]} dot={false}>{RISK_LABELS[a.banRisk]}</Badge></td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="ghost" onClick={() => togglePause(a)} title={a.isPaused ? 'Retomar' : 'Pausar'}>
                            {a.isPaused ? <IconPlay /> : <IconPause />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
