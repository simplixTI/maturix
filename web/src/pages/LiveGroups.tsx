import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { Card, Badge, Button, Loading, Empty, Field, Input, Select } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useConnectedAccounts } from '../lib/hooks';
import { IconSearch, IconUsers, IconPlus, IconLink, IconRefresh, IconFlame } from '../components/Icons';
import { formatPhone } from '../lib/format';
import type { LiveGroup } from '../lib/types';

function GroupGenerator({ connectedCount }: { connectedCount: number }) {
  const toast = useToast();
  const [count, setCount] = useState(3);
  const [minMembers, setMinMembers] = useState(1);
  const [maxMembers, setMaxMembers] = useState(4);
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (connectedCount < 2) return toast.error('Conecte ao menos 2 contas para gerar grupos.');
    setBusy(true);
    try {
      const res = await post<{ planned: number; connected: number; message: string }>('/api/groups/generate', {
        count, minMembers, maxMembers, namePrefix: prefix || undefined,
      });
      toast.success(res.message || `Gerando ${res.planned} grupo(s)…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar grupos');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 'var(--space-5)' }}>
      <div className="card-head">
        <div>
          <div className="card-title"><IconFlame width={16} /> Gerador de grupos</div>
          <div className="card-sub">Cria grupos automaticamente entre suas contas conectadas, sorteando nome, membros e tamanho.</div>
        </div>
        <Badge tone={connectedCount >= 2 ? 'success' : 'neutral'} dot={false}>{connectedCount} conectada(s)</Badge>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr)) auto', gap: 'var(--space-3)', alignItems: 'end' }}>
        <Field label="Quantos grupos"><Input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
        <Field label="Mín. membros"><Input type="number" min={1} value={minMembers} onChange={(e) => setMinMembers(Number(e.target.value))} /></Field>
        <Field label="Máx. membros"><Input type="number" min={1} value={maxMembers} onChange={(e) => setMaxMembers(Number(e.target.value))} /></Field>
        <Field label="Prefixo do nome (opcional)"><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="ex: Equipe" /></Field>
        <Button variant="primary" loading={busy} onClick={generate} disabled={connectedCount < 2}>
          <IconPlus /> Gerar grupos
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 'var(--space-3)' }}>
        Os membros são contas suas (números cadastrados). A criação roda em segundo plano com intervalos anti-ban (20–45s entre grupos). Selecione a conta criadora abaixo e atualize para ver os grupos novos.
      </p>
    </Card>
  );
}

interface GroupsResponse { groups: LiveGroup[]; total: number }

export function LiveGroups() {
  const toast = useToast();
  const accounts = useConnectedAccounts();
  const [account, setAccount] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);
  const [membersGroup, setMembersGroup] = useState<LiveGroup | null>(null);

  const groups = useQuery({
    queryKey: ['live-groups', account],
    queryFn: () => get<GroupsResponse>(`/api/groups/${account}`),
    enabled: !!account,
  });

  const connected = accounts.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Grupos ao vivo</h1>
          <p>Grupos em que a conta participa no WhatsApp, em tempo real.</p>
        </div>
        <div className="toolbar">
          <Select value={account} onChange={(e) => setAccount(e.target.value)} style={{ width: 220 }}>
            <option value="">Selecione a conta…</option>
            {connected.map((a) => <option key={a.id} value={a.id}>{formatPhone(a.phoneNumber)}</option>)}
          </Select>
          <Button variant="ghost" disabled={!account} onClick={() => groups.refetch()}><IconRefresh /> Atualizar</Button>
          <Button variant="primary" disabled={!account} onClick={() => setJoinOpen(true)}><IconPlus /> Entrar por convite</Button>
        </div>
      </div>

      <GroupGenerator connectedCount={connected.length} />

      {!account ? (
        <Card><Empty icon={<IconUsers />} title="Escolha uma conta conectada" hint="Os grupos são buscados ao vivo da sessão do WhatsApp." /></Card>
      ) : groups.isLoading ? (
        <Loading label="Buscando grupos na sessão…" />
      ) : groups.isError ? (
        <Card><Empty icon={<IconSearch />} title="Não foi possível carregar" hint="A conta precisa estar conectada e pronta." /></Card>
      ) : (groups.data?.groups.length ?? 0) === 0 ? (
        <Card><Empty icon={<IconUsers />} title="Nenhum grupo" hint="Esta conta ainda não participa de grupos." /></Card>
      ) : (
        <div className="grid grid-3">
          {groups.data!.groups.map((g) => (
            <Card key={g.jid}>
              <div className="card-head">
                <span className="card-title text-sm">{g.subject}</span>
                {g.myRole && g.myRole !== 'member' && <Badge tone="accent" dot={false}>{g.myRole}</Badge>}
              </div>
              <p className="text-xs muted" style={{ minHeight: 34 }}>{g.desc || 'Sem descrição'}</p>
              <div className="row-between" style={{ marginTop: 'var(--space-3)' }}>
                <button className="chip" onClick={() => setMembersGroup(g)} title="Ver membros">
                  <IconUsers width={12} /> {g.participantCount} membros
                </button>
                <Button size="sm" variant="ghost" title="Copiar link de convite"
                  onClick={async () => {
                    try {
                      const r = await get<{ link: string }>(`/api/groups/${account}/${encodeURIComponent(g.jid)}/invite`);
                      await navigator.clipboard.writeText(r.link).catch(() => {});
                      toast.success('Link copiado');
                    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
                  }}><IconLink /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <MembersModal account={account} group={membersGroup} onClose={() => setMembersGroup(null)} />
      <JoinModal open={joinOpen} onClose={() => setJoinOpen(false)} account={account} onJoined={() => groups.refetch()} />
    </>
  );
}

function JoinModal({ open, onClose, account, onJoined }: { open: boolean; onClose: () => void; account: string; onJoined: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function join() {
    if (!code.trim()) return toast.error('Cole o link ou código do convite');
    setBusy(true);
    try {
      await post(`/api/groups/${account}/join`, { code });
      toast.success('Entrou no grupo');
      onJoined(); onClose(); setCode('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao entrar'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Entrar em grupo por convite"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={join}>Entrar</Button></>}>
      <Field label="Link ou código de convite">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://chat.whatsapp.com/AbCd…" />
      </Field>
    </Modal>
  );
}

interface GroupMeta {
  subject: string;
  desc?: string;
  participants: { jid: string; admin: string | null }[];
}

function MembersModal({ account, group, onClose }: { account: string; group: LiveGroup | null; onClose: () => void }) {
  const meta = useQuery({
    queryKey: ['group-meta', account, group?.jid],
    queryFn: () => get<GroupMeta>(`/api/groups/${account}/${encodeURIComponent(group!.jid)}`),
    enabled: !!group && !!account,
  });

  const phoneOf = (jid: string) => jid.split('@')[0].split(':')[0];

  return (
    <Modal open={!!group} onClose={onClose} title={group?.subject || 'Membros do grupo'} wide>
      {meta.isLoading ? (
        <Loading label="Buscando membros…" />
      ) : meta.isError ? (
        <Empty icon={<IconUsers />} title="Não foi possível carregar os membros" hint="A conta precisa estar conectada." />
      ) : (
        <div className="col gap-2">
          <span className="text-sm muted">{meta.data?.participants.length ?? 0} membro(s)</span>
          <div className="col" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {meta.data?.participants.map((p) => (
              <div key={p.jid} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-faint)' }}>
                <span className="mono text-sm">{formatPhone(phoneOf(p.jid))}</span>
                {p.admin
                  ? <Badge tone="accent" dot={false}>{p.admin === 'superadmin' ? 'dono' : 'admin'}</Badge>
                  : <span className="text-xs muted">membro</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
