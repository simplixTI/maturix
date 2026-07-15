import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, del } from '../lib/api';
import { Card, Badge, Button, Loading, Empty, Stat, Field, Select, Textarea } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useConnectedAccounts } from '../lib/hooks';
import { IconPlus, IconTrash, IconUsers, IconRefresh, IconLink } from '../components/Icons';
import { formatPhone, relativeTime } from '../lib/format';
import type { WarmingGroupsResponse } from '../lib/types';

const STATUS_TONE: Record<string, string> = {
  pending: 'neutral', joined: 'success', active: 'success', left: 'warning', failed: 'danger',
};

export function WarmingGroups() {
  const toast = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);

  const accounts = useConnectedAccounts();
  const { data, isLoading } = useQuery({ queryKey: ['warming-groups'], queryFn: () => get<WarmingGroupsResponse>('/api/warming-groups'), refetchInterval: 15_000 });

  function refresh() { qc.invalidateQueries({ queryKey: ['warming-groups'] }); }

  async function run(label: string, fn: () => Promise<unknown>) {
    if (!account) return toast.error('Selecione uma conta conectada primeiro');
    setBusy(true);
    try { await fn(); toast.success(label); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setBusy(false); }
  }

  if (isLoading) return <Loading label="Carregando grupos…" />;
  const groups = data?.groups ?? [];
  const stats = data?.stats;
  const connected = accounts.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Grupos de aquecimento</h1>
          <p>Entre em grupos e interaja para aumentar a reputação dos números.</p>
        </div>
        <div className="toolbar">
          <Select value={account} onChange={(e) => setAccount(e.target.value)} style={{ width: 220 }}>
            <option value="">Conta para ações…</option>
            {connected.map((a) => <option key={a.id} value={a.id}>{formatPhone(a.phoneNumber)}</option>)}
          </Select>
          <Button variant="primary" onClick={() => setAddOpen(true)}><IconPlus /> Adicionar links</Button>
        </div>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <Stat label="Total" value={stats?.total ?? 0} icon={<IconUsers />} />
        <Stat label="Pendentes" value={stats?.pending ?? 0} />
        <Stat label="Conectados" value={stats?.joined ?? 0} accent />
        <Stat label="Msgs enviadas" value={stats?.totalMessages ?? 0} />
      </div>

      <div className="toolbar" style={{ marginBottom: 'var(--space-5)' }}>
        <Button variant="ghost" loading={busy} onClick={() => run('Entrando nos grupos pendentes…', () => post('/api/warming-groups/bulk-join', { accountId: account }))}>Entrar em todos</Button>
        <Button variant="ghost" loading={busy} onClick={() => run('Saindo de todos os grupos…', () => post('/api/warming-groups/bulk-leave', { accountId: account }))}>Sair de todos</Button>
        <Button variant="ghost" loading={busy} onClick={() => run('Mensagem enviada a um grupo', () => post('/api/warming-groups/interact', { accountId: account }))}>Interagir agora</Button>
        <Button variant="ghost" onClick={refresh}><IconRefresh /> Atualizar</Button>
      </div>

      {groups.length === 0 ? (
        <Card><Empty icon={<IconUsers />} title="Nenhum grupo na fila" hint="Adicione links de convite de grupos do WhatsApp."
          action={<Button variant="primary" onClick={() => setAddOpen(true)}><IconPlus /> Adicionar links</Button>} /></Card>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Grupo</th><th>Status</th><th className="num">Msgs</th><th>Entrou</th><th>Atividade</th><th /></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <div className="col">
                      <span className="text-sm">{g.groupName || 'Grupo sem nome'}</span>
                      <a href={g.inviteLink} target="_blank" rel="noreferrer" className="text-xs" style={{ color: 'var(--info)' }}>
                        <IconLink width={11} /> {g.inviteCode.slice(0, 16)}…
                      </a>
                    </div>
                  </td>
                  <td><Badge tone={STATUS_TONE[g.status] || 'neutral'}>{g.status}</Badge></td>
                  <td className="num">{g.messagesSent}</td>
                  <td className="text-xs muted">{relativeTime(g.joinedAt)}</td>
                  <td className="text-xs muted">{relativeTime(g.lastActivity)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {g.status === 'pending' && (
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => run('Entrou no grupo', () => post(`/api/warming-groups/${g.id}/join`, { accountId: account }))}>Entrar</Button>
                      )}
                      {(g.status === 'joined' || g.status === 'active') && (
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => run('Saiu do grupo', () => post(`/api/warming-groups/${g.id}/leave`, { accountId: account }))}>Sair</Button>
                      )}
                      <Button size="sm" variant="ghost"
                        onClick={async () => { try { await del(`/api/warming-groups/${g.id}`); toast.success('Removido'); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); } }}
                        title="Remover"><IconTrash /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddLinksModal open={addOpen} onClose={() => setAddOpen(false)} account={account} onSaved={refresh} />
    </>
  );
}

function AddLinksModal({ open, onClose, account, onSaved }: { open: boolean; onClose: () => void; account: string; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const links = text.split(/\s+/).map((l) => l.trim()).filter(Boolean);
    if (links.length === 0) return toast.error('Cole ao menos um link');
    setBusy(true);
    try {
      const res = await post<{ created: number; skipped: number }>('/api/warming-groups', { links, accountId: account || undefined });
      toast.success(`${res.created} adicionado(s), ${res.skipped} ignorado(s)`);
      onSaved(); onClose(); setText('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Adicionar links de grupos"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Adicionar</Button></>}>
      <Field label="Links de convite" hint="Um por linha. Aceita https://chat.whatsapp.com/CODE">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 160 }}
          placeholder={'https://chat.whatsapp.com/AbCdEf...\nhttps://chat.whatsapp.com/GhIjKl...'} />
      </Field>
    </Modal>
  );
}
