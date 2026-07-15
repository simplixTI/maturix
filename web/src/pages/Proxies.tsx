import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, del } from '../lib/api';
import { Card, Badge, Button, Loading, Empty, Stat, Field, Input, Select, Textarea } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { IconPlus, IconTrash, IconRefresh, IconServer } from '../components/Icons';
import { relativeTime } from '../lib/format';
import type { Proxy } from '../lib/types';

export function Proxies() {
  const toast = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['proxies'], queryFn: () => get<Proxy[]>('/api/proxies'), refetchInterval: 20_000 });

  const proxies = data ?? [];
  const healthy = proxies.filter((p) => p.isHealthy).length;
  const assigned = proxies.reduce((s, p) => s + (p._count?.assignedAccounts ?? 0), 0);

  function refresh() { qc.invalidateQueries({ queryKey: ['proxies'] }); }

  async function checkAll() {
    setChecking(true);
    try {
      await post('/api/proxies/check-all');
      toast.info('Verificação de saúde iniciada');
      setTimeout(refresh, 3000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha');
    } finally {
      setChecking(false);
    }
  }

  async function remove(id: string) {
    try { await del(`/api/proxies/${id}`); toast.success('Proxy removido'); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }

  if (isLoading) return <Loading label="Carregando proxies…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Proxies</h1>
          <p>Saída de rede das sessões. Residenciais e móveis reduzem o risco de ban.</p>
        </div>
        <div className="toolbar">
          <Button variant="ghost" loading={checking} onClick={checkAll}><IconRefresh /> Verificar todos</Button>
          <Button variant="ghost" onClick={() => setBulkOpen(true)}>Importar em massa</Button>
          <Button variant="primary" onClick={() => setAddOpen(true)}><IconPlus /> Adicionar</Button>
        </div>
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <Stat label="Proxies" value={proxies.length} icon={<IconServer />} />
        <Stat label="Saudáveis" value={healthy} accent foot={`${proxies.length - healthy} com falha`} />
        <Stat label="Contas atribuídas" value={assigned} />
      </div>

      {proxies.length === 0 ? (
        <Card><Empty icon={<IconServer />} title="Nenhum proxy cadastrado" hint="Adicione proxies residenciais ou móveis para as sessões."
          action={<Button variant="primary" onClick={() => setAddOpen(true)}><IconPlus /> Adicionar proxy</Button>} /></Card>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Endereço</th><th>Protocolo</th><th>Tipo</th><th>Saúde</th><th className="num">Latência</th><th className="num">Contas</th><th>Verificado</th><th /></tr>
            </thead>
            <tbody>
              {proxies.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.host}:{p.port}{p.username ? ' 🔒' : ''}</td>
                  <td><Badge tone="neutral" dot={false}>{p.protocol}</Badge></td>
                  <td className="text-sm soft">{p.type}</td>
                  <td><Badge tone={p.isHealthy ? 'success' : 'danger'}>{p.isHealthy ? 'OK' : `falhas: ${p.failCount}`}</Badge></td>
                  <td className="num">{p.responseTimeMs ? `${p.responseTimeMs}ms` : '—'}</td>
                  <td className="num">{p._count?.assignedAccounts ?? 0}</td>
                  <td className="text-xs muted">{relativeTime(p.lastCheckedAt)}</td>
                  <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)} title="Remover"><IconTrash /></Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddProxyModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={refresh} />
      <BulkProxyModal open={bulkOpen} onClose={() => setBulkOpen(false)} onSaved={refresh} />
    </>
  );
}

function AddProxyModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [protocol, setProtocol] = useState('HTTP');
  const [type, setType] = useState('RESIDENTIAL');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!host || !port) return toast.error('Host e porta são obrigatórios');
    setBusy(true);
    try {
      await post('/api/proxies', { host, port: Number(port), username: username || undefined, password: password || undefined, protocol, type });
      toast.success('Proxy adicionado');
      onSaved(); onClose();
      setHost(''); setPort(''); setUsername(''); setPassword('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Adicionar proxy"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="grid grid-2" style={{ gap: 'var(--space-4)' }}>
        <Field label="Host"><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="123.45.67.89" /></Field>
        <Field label="Porta"><Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="8080" inputMode="numeric" /></Field>
        <Field label="Protocolo"><Select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          {['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5'].map((x) => <option key={x}>{x}</option>)}
        </Select></Field>
        <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value)}>
          {['RESIDENTIAL', 'MOBILE', 'DATACENTER'].map((x) => <option key={x}>{x}</option>)}
        </Select></Field>
        <Field label="Usuário (opcional)"><Input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Senha (opcional)"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function BulkProxyModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function importAll() {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return toast.error('Cole ao menos uma linha');
    setBusy(true);
    try {
      const res = await post<{ imported: number; skipped?: number; invalid?: number }>('/api/proxies/bulk-import', { lines });
      const parts = [`${res.imported} importado(s)`];
      if (res.skipped) parts.push(`${res.skipped} já existente(s)`);
      if (res.invalid) parts.push(`${res.invalid} inválido(s)`);
      const msg = parts.join(' · ');
      if (res.imported > 0) toast.success(msg); else toast.info(msg);
      onSaved(); onClose(); setText('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Importar proxies em massa"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={importAll}>Importar</Button></>}>
      <Field label="Uma linha por proxy" hint="Aceita: host:porta · host:porta:user:senha · user:senha@host:porta · socks5://user:senha@host:porta (o protocolo é detectado automaticamente)">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 180 }}
          placeholder={'123.45.67.89:8080\n123.45.67.90:8080:user:senha\nsocks5://user:pass@1.2.3.4:1080'} />
      </Field>
    </Modal>
  );
}
