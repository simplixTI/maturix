import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Card, Badge, Button, Loading, Empty, Select, Input, Field } from '../components/ui';
import { Modal } from '../components/Modal';
import { ConnectModal } from '../components/ConnectModal';
import { useToast } from '../components/Toast';
import {
  IconPlus, IconTrash, IconPlay, IconPause, IconPower, IconRefresh, IconPhone, IconPencil, IconCheck, IconCopy,
} from '../components/Icons';
import {
  formatPhone, relativeTime, STATUS_LABELS, STATUS_TONE, RISK_LABELS, RISK_TONE,
} from '../lib/format';
import { FleetIdentityCard } from '../components/FleetIdentityCard';
import type { Account, Proxy } from '../lib/types';

// Friendly label for a proxy: sticky-session proxies share one gateway, so show
// the session number (the residential IP identity), not the shared host:port.
function proxyLabel(p: { host: string; port: number; username?: string | null; isHealthy: boolean }): string {
  const s = p.username?.match(/session-(\d+)/)?.[1];
  const name = s ? `SOCKS5 · sessão ${s}` : `${p.host}:${p.port}`;
  return p.isHealthy ? name : `${name} (offline)`;
}

export function Accounts() {
  const toast = useToast();
  const qc = useQueryClient();
  const [connectOpen, setConnectOpen] = useState(false);
  const [reconnectTarget, setReconnectTarget] = useState<{ accountId: string; phoneNumber: string } | null>(null);
  const [toDelete, setToDelete] = useState<Account | null>(null);
  const [toEdit, setToEdit] = useState<Account | null>(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => get<Account[]>('/api/accounts'),
    refetchInterval: 12_000,
  });

  const proxiesQuery = useQuery({ queryKey: ['proxies'], queryFn: () => get<Proxy[]>('/api/proxies') });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => get<{ warmup: { TOTAL_DAYS: number } }>('/api/settings'),
  });
  const defaultDays = settingsQuery.data?.warmup?.TOTAL_DAYS ?? 15;

  // Live status updates
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => qc.invalidateQueries({ queryKey: ['accounts'] });
    socket.on('session:status', refresh);
    return () => { socket.off('session:status', refresh); };
  }, [qc]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  }

  async function action(id: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusyId(id);
    try {
      await fn();
      toast.success(okMsg);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na operação');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    await action(toDelete.id, () => del(`/api/accounts/${toDelete.id}`), 'Conta removida');
    setToDelete(null);
  }

  async function changeWarmupDays(id: string, raw: string) {
    const trimmed = raw.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 2 || value > 365)) {
      toast.error('Dias de aquecimento: use um inteiro entre 2 e 365 (vazio = padrão)');
      invalidate();
      return;
    }
    try {
      await patch(`/api/accounts/${id}`, { warmupTotalDays: value });
      toast.success(value === null ? `Aquecimento: padrão (${defaultDays} dias)` : `Aquecimento: ${value} dias`);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao definir dias de aquecimento');
    }
  }

  async function changeProxy(id: string, proxyId: string) {
    try {
      await patch(`/api/accounts/${id}`, { proxyId: proxyId || null });
      toast.success(proxyId ? 'Proxy definido · vale na próxima conexão' : 'Proxy automático · vale na próxima conexão');
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao definir proxy');
    }
  }

  function openEdit(a: Account) {
    setToEdit(a);
    setEditName(a.displayName ?? '');
  }

  async function saveEdit() {
    if (!toEdit) return;
    const name = editName.trim();
    try {
      await patch(`/api/accounts/${toEdit.id}`, { displayName: name || null });
      toast.success('Dados atualizados');
      setToEdit(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar');
    }
  }

  if (isLoading) return <Loading label="Carregando contas…" />;

  const accounts = data ?? [];

  async function copyNumbers() {
    const nums = accounts.map((a) => a.phoneNumber).join('\n');
    try {
      await navigator.clipboard.writeText(nums);
      toast.success(`${accounts.length} número(s) copiado(s)`);
    } catch {
      toast.error('Falha ao copiar (permita o acesso à área de transferência)');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contas</h1>
          <p>{accounts.length} número(s) cadastrado(s).</p>
        </div>
        <div className="toolbar">
          <Button variant="ghost" onClick={invalidate}><IconRefresh /> Atualizar</Button>
          <Button variant="ghost" disabled={accounts.length === 0} onClick={copyNumbers}><IconCopy /> Copiar números</Button>
          <Button variant="primary" onClick={() => { setReconnectTarget(null); setConnectOpen(true); }}>
            <IconPlus /> Conectar conta
          </Button>
        </div>
      </div>

      <FleetIdentityCard />

      {accounts.length === 0 ? (
        <Card>
          <Empty
            icon={<IconPhone />}
            title="Nenhuma conta ainda"
            hint="Conecte seu primeiro número para começar o aquecimento."
            action={<Button variant="primary" onClick={() => setConnectOpen(true)}><IconPlus /> Conectar conta</Button>}
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Número</th>
                <th>Status</th>
                <th>Dia</th>
                <th title="Duração total do aquecimento. Vazio = padrão global.">Aquec. (dias)</th>
                <th>Risco</th>
                <th className="num">Hoje ↑/↓</th>
                <th>Proxy</th>
                <th>Última atividade</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const connected = a.status === 'CONNECTED';
                const busy = busyId === a.id;
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="col">
                        <span className="mono">{formatPhone(a.phoneNumber)}</span>
                        {a.displayName && <span className="text-xs muted">{a.displayName}</span>}
                      </div>
                    </td>
                    <td><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABELS[a.status]}</Badge></td>
                    <td className="mono">{a.warmupDay}</td>
                    <td>
                      <Input
                        type="number"
                        min={2}
                        max={365}
                        key={a.warmupTotalDays ?? 'default'}
                        defaultValue={a.warmupTotalDays ?? ''}
                        placeholder={`${defaultDays}`}
                        title={`Dias totais de aquecimento. Vazio = padrão global (${defaultDays}).`}
                        style={{ width: 70, fontSize: 'var(--text-xs)', padding: '4px 8px' }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        onBlur={(e) => {
                          const v = e.target.value;
                          const current = a.warmupTotalDays ?? null;
                          const parsed = v.trim() === '' ? null : Number(v);
                          if (parsed !== current) changeWarmupDays(a.id, v);
                        }}
                      />
                    </td>
                    <td><Badge tone={RISK_TONE[a.banRisk]} dot={false}>{RISK_LABELS[a.banRisk]}</Badge></td>
                    <td className="num">{a.msgsSentToday} / {a.msgsReceivedToday}</td>
                    <td>
                      <div className="col gap-2">
                        {a.proxy
                          ? <Badge tone={a.proxy.isHealthy ? 'success' : 'warning'} dot={false}>🛡️ {proxyLabel(a.proxy)}</Badge>
                          : <Badge tone="warning" dot={false}>⚠️ Direto (sem proxy)</Badge>}
                        <Select
                          value={a.proxyId ?? ''}
                          onChange={(e) => changeProxy(a.id, e.target.value)}
                          style={{ minWidth: 160, fontSize: 'var(--text-xs)', padding: '4px 8px' }}
                          title={a.proxy && !a.proxy.isHealthy ? 'Proxy atual está offline' : undefined}
                        >
                          <option value="">Automático / direto</option>
                          {(proxiesQuery.data ?? []).map((p) => (
                            <option key={p.id} value={p.id}>{proxyLabel(p)}</option>
                          ))}
                        </Select>
                      </div>
                    </td>
                    <td className="text-xs muted">{relativeTime(a.lastActiveAt)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        {connected ? (
                          <Button size="sm" variant="ghost" disabled={busy}
                            onClick={() => action(a.id, () => post('/api/sessions/disconnect', { accountId: a.id }), 'Desconectado')}
                            title="Desconectar">
                            <IconPower />
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={busy}
                            onClick={() => { setReconnectTarget({ accountId: a.id, phoneNumber: a.phoneNumber }); setConnectOpen(true); }}
                            title="Conectar">
                            <IconRefresh />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => action(a.id, () => patch(`/api/accounts/${a.id}`, { isPaused: !a.isPaused }), a.isPaused ? 'Aquecimento retomado' : 'Aquecimento pausado')}
                          title={a.isPaused ? 'Retomar' : 'Pausar'}>
                          {a.isPaused ? <IconPlay /> : <IconPause />}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => openEdit(a)} title="Editar dados">
                          <IconPencil />
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => setToDelete(a)} title="Remover">
                          <IconTrash />
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

      <ConnectModal
        open={connectOpen}
        existing={reconnectTarget}
        onClose={() => { setConnectOpen(false); setReconnectTarget(null); invalidate(); }}
        onConnected={invalidate}
      />

      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Remover conta"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmDelete}><IconTrash /> Remover definitivamente</Button>
          </>
        }
      >
        <p className="text-sm soft">
          Remover <strong className="mono">{toDelete && formatPhone(toDelete.phoneNumber)}</strong>?
          Isso apaga sessão, métricas, mensagens e histórico de aquecimento. Esta ação é irreversível.
        </p>
      </Modal>

      <Modal
        open={!!toEdit}
        onClose={() => setToEdit(null)}
        title="Editar conta"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToEdit(null)}>Cancelar</Button>
            <Button variant="primary" onClick={saveEdit}><IconCheck /> Salvar</Button>
          </>
        }
      >
        <div className="col" style={{ gap: 14 }}>
          <Field label="Número">
            <Input value={toEdit ? formatPhone(toEdit.phoneNumber) : ''} disabled readOnly />
          </Field>
          <Field label="Nome (apelido do chip)">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="ex: chip8"
              maxLength={40}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
              autoFocus
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
