import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from '../lib/api';
import { Card, Badge, Button, Loading, Empty, Input, Stat } from '../components/ui';
import { useToast } from '../components/Toast';
import { IconPlus, IconTrash, IconCheck } from '../components/Icons';

interface Business {
  id: string;
  name: string;
  phoneNumber: string;
  category: string;
  description: string;
  active: boolean;
  onWhatsapp: boolean | null;
  checkedAt: string | null;
}

export function Businesses() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['businesses'],
    queryFn: () => get<Business[]>('/api/businesses'),
    refetchInterval: 15_000,
  });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [bulk, setBulk] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [validating, setValidating] = useState(false);

  const list = data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['businesses'] });

  const valid = list.filter((b) => b.onWhatsapp === true).length;
  const invalid = list.filter((b) => b.onWhatsapp === false).length;
  const unchecked = list.filter((b) => b.onWhatsapp === null).length;
  const active = list.filter((b) => b.active).length;

  async function add() {
    const n = name.trim();
    const p = phone.replace(/\D/g, '');
    if (!n || !p) { toast.error('Preencha nome e número (com DDI)'); return; }
    try {
      await post('/api/businesses', { name: n, phoneNumber: p });
      toast.success('Empresa adicionada');
      setName(''); setPhone('');
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao adicionar');
    }
  }

  async function bulkAdd() {
    const text = bulk.trim();
    if (!text) { toast.error('Cole os números (um por linha)'); return; }
    setBulkBusy(true);
    try {
      const r = await post<{ added: number; skipped: number }>('/api/businesses/bulk', { text });
      toast.success(`${r.added} adicionada(s) · ${r.skipped} ignorada(s)`);
      setBulk('');
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no envio em massa');
    } finally {
      setBulkBusy(false);
    }
  }

  async function toggle(b: Business) {
    try { await patch(`/api/businesses/${b.id}`, { active: !b.active }); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }

  async function remove(b: Business) {
    try { await del(`/api/businesses/${b.id}`); toast.success('Removida'); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }

  async function validate() {
    setValidating(true);
    try {
      await post('/api/businesses/validate', {});
      toast.success('Validação iniciada — atualiza em ~30s');
      setTimeout(() => { invalidate(); setValidating(false); }, 30_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha — precisa de um número conectado');
      setValidating(false);
    }
  }

  if (isLoading) return <Loading label="Carregando empresas…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Empresas</h1>
          <p>Bots de empresas que os chips conversam pra gerar tráfego externo real. Valide e adicione os seus.</p>
        </div>
        <Button variant="primary" loading={validating} onClick={validate}>
          <IconCheck /> Validar todas no WhatsApp
        </Button>
      </div>

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <div className="row" style={{ gap: 'var(--space-5)', flexWrap: 'wrap' }}>
          <Stat label="Total" value={list.length} />
          <Stat label="No WhatsApp ✓" value={valid} accent />
          <Stat label="Fora ✗" value={invalid} />
          <Stat label="Não checadas" value={unchecked} />
          <Stat label="Ativas" value={active} />
        </div>
      </Card>

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Input placeholder="Nome (ex: Minha Loja)" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Input
              placeholder="Número com DDI (ex: 5511999998888)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            />
          </div>
          <Button variant="primary" onClick={add}><IconPlus /> Adicionar</Button>
        </div>
      </Card>

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-head">
          <div>
            <div className="card-title">Adicionar em massa</div>
            <div className="card-sub">Cole vários números, um por linha. Aceita "Nome 5511999998888", "5511999998888, Nome" ou só o número (com DDI 55). Valide depois.</div>
          </div>
        </div>
        <textarea
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={'Nubank 5511940420011\niFood 551150553030\n5511999998888'}
          rows={6}
          style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', padding: 'var(--space-3)', borderRadius: 'var(--radius)', resize: 'vertical' }}
        />
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span className="text-xs muted">{bulk.split(/[\r\n]+/).filter((l) => /\d{10,}/.test(l)).length} linha(s) com número</span>
          <Button variant="primary" loading={bulkBusy} onClick={bulkAdd}><IconPlus /> Adicionar em massa</Button>
        </div>
      </Card>

      {list.length === 0 ? (
        <Empty title="Nenhuma empresa cadastrada" hint="Adicione bots de empresa que respondem automático." />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>NOME</th><th>NÚMERO</th><th>CATEGORIA</th><th>WHATSAPP</th><th>ATIVA</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td className="mono">{b.phoneNumber}</td>
                    <td className="text-xs muted">{b.category}</td>
                    <td>
                      {b.onWhatsapp === true
                        ? <Badge tone="success" dot={false}>✓ Sim</Badge>
                        : b.onWhatsapp === false
                          ? <Badge tone="danger" dot={false}>✗ Não</Badge>
                          : <Badge tone="neutral" dot={false}>— não checada</Badge>}
                    </td>
                    <td>
                      <Button size="sm" variant={b.active ? 'primary' : 'ghost'} onClick={() => toggle(b)}>
                        {b.active ? 'Ativa' : 'Inativa'}
                      </Button>
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => remove(b)} title="Remover"><IconTrash /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
