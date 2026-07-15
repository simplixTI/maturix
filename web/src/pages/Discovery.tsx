import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, del } from '../lib/api';
import { Card, Badge, Button, Loading, Empty, Field, Input, Select, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConnectedAccounts } from '../lib/hooks';
import { IconSearch, IconCompass, IconTrash, IconPlus, IconLink } from '../components/Icons';
import { formatPhone, relativeTime } from '../lib/format';
import type { DiscoveredGroup } from '../lib/types';

interface SearchResult {
  inviteLink?: string;
  inviteCode?: string;
  title?: string;
  groupName?: string;
  snippet?: string;
  niche?: string;
  source?: string;
}
interface SearchResponse { results: SearchResult[]; totalResults?: number }
interface DiscoveredResponse { groups: DiscoveredGroup[]; total: number; totalPages: number }

// Only sources that actually return data. Search-engine scraping
// (Google/Bing/DuckDuckGo) is blocked and returns nothing, so it's not offered.
const SOURCES = [
  { v: 'free', label: 'Busca livre (recomendado)' },
  { v: 'appgrouplink', label: 'AppGroupLink (diretório)' },
];

export function Discovery() {
  const [tab, setTab] = useState<'search' | 'saved'>('search');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Descoberta de grupos</h1>
          <p>Encontre, valide e salve grupos públicos do WhatsApp por nicho.</p>
        </div>
      </div>
      <div className="tabs">
        <div className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>Buscar</div>
        <div className={`tab ${tab === 'saved' ? 'active' : ''}`} onClick={() => setTab('saved')}>Salvos</div>
      </div>
      {tab === 'search' ? <SearchPane /> : <SavedPane />}
    </>
  );
}

function SearchPane() {
  const toast = useToast();
  const accounts = useConnectedAccounts();
  const [q, setQ] = useState('');
  const [source, setSource] = useState('free');
  const [account, setAccount] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);

  async function search() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ source });
      if (q) params.set('q', q);
      const res = await get<SearchResponse>(`/api/discovery/search?${params.toString()}`);
      setResults(res.results || []);
      toast.info(`${res.results?.length ?? 0} resultado(s)`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha na busca'); }
    finally { setBusy(false); }
  }

  async function saveValidated() {
    const links = results.map((r) => r.inviteLink || r.inviteCode).filter(Boolean) as string[];
    if (links.length === 0) return toast.error('Nenhum link para validar');
    setValidating(true);
    try {
      const res = await post<{ active: number; saved: number; dead: number }>('/api/discovery/save-validated', { links: links.slice(0, 50), accountId: account || undefined });
      toast.success(`${res.saved} salvo(s) · ${res.dead} mortos`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setValidating(false); }
  }

  const connected = accounts.data ?? [];

  return (
    <>
      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 180px 200px auto', gap: 'var(--space-3)', alignItems: 'end' }}>
          <Field label="Termo de busca"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex: marketing digital" onKeyDown={(e) => e.key === 'Enter' && search()} /></Field>
          <Field label="Fonte"><Select value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</Select></Field>
          <Field label="Conta p/ validar"><Select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Qualquer conectada</option>
            {connected.map((a) => <option key={a.id} value={a.id}>{formatPhone(a.phoneNumber)}</option>)}
          </Select></Field>
          <Button variant="primary" loading={busy} onClick={search}><IconSearch /> Buscar</Button>
        </div>
      </Card>

      {results.length === 0 ? (
        <Card><Empty icon={<IconCompass />} title="Faça uma busca" hint="Digite um termo (ou deixe vazio e clique em Buscar para navegar nos diretórios). Os links encontrados aparecem aqui." /></Card>
      ) : (
        <>
          <Card style={{ marginBottom: 'var(--space-4)', borderColor: 'var(--accent-line)' }}>
            <div className="row-between wrap gap-4">
              <div className="col" style={{ gap: 2 }}>
                <span className="text-sm" style={{ fontWeight: 600 }}>{results.length} link(s) encontrado(s) — sem nome ainda</span>
                <span className="text-xs muted">Estes são links crus. Clique em <strong>Validar e salvar</strong> para descobrir os nomes, ver quantos membros e remover os mortos (usa uma conta conectada).</span>
              </div>
              <Button variant="primary" loading={validating} onClick={saveValidated}>Validar e salvar ativos</Button>
            </div>
          </Card>
          <div className="grid grid-3">
            {results.map((r, i) => (
              <Card key={i}>
                <div className="card-head">
                  <span className="card-title text-sm">{r.groupName || r.title || 'Grupo'}</span>
                  {r.niche && <Badge tone="neutral" dot={false}>{r.niche}</Badge>}
                </div>
                <p className="text-xs muted" style={{ minHeight: 32 }}>{r.snippet || r.inviteCode}</p>
                {r.inviteLink && <a href={r.inviteLink} target="_blank" rel="noreferrer" className="text-xs" style={{ color: 'var(--info)' }}><IconLink width={11} /> abrir convite</a>}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function SavedPane() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['discovered'], queryFn: () => get<DiscoveredResponse>('/api/discovery/groups?limit=100') });

  function refresh() { qc.invalidateQueries({ queryKey: ['discovered'] }); }

  async function addToWarming(id: string) {
    try { await post(`/api/discovery/groups/${id}/add-to-warming`, {}); toast.success('Adicionado à fila de aquecimento'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }
  async function remove(id: string) {
    try { await del(`/api/discovery/groups/${id}`); toast.success('Removido'); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }

  if (isLoading) return <Loading />;
  const groups = data?.groups ?? [];
  if (groups.length === 0) return <Card><Empty icon={<IconCompass />} title="Nenhum grupo salvo" hint="Valide grupos na aba Buscar para salvá-los aqui." /></Card>;

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead><tr><th>Grupo</th><th>Nicho</th><th>Membros</th><th>Origem</th><th>Verificado</th><th /></tr></thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td><div className="col"><span className="text-sm">{g.groupName || 'Sem nome'}</span>
                <a href={g.inviteLink} target="_blank" rel="noreferrer" className="text-xs" style={{ color: 'var(--info)' }}>{g.inviteCode.slice(0, 18)}…</a></div></td>
              <td><Badge tone="neutral" dot={false}>{g.niche}</Badge></td>
              <td className="num">{g.memberCount ?? '—'}</td>
              <td className="text-xs muted">{g.source}</td>
              <td className="text-xs muted">{relativeTime(g.lastChecked)}</td>
              <td><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                <Button size="sm" variant="ghost" onClick={() => addToWarming(g.id)} title="Adicionar ao aquecimento"><IconPlus /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(g.id)} title="Remover"><IconTrash /></Button>
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
