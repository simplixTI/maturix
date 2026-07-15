import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, patch, del } from '../lib/api';
import { Card, Badge, Button, Loading, Empty, Field, Input, Textarea } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { IconPlus, IconTrash, IconTemplate, IconRefresh } from '../components/Icons';
import type { ConversationTemplate } from '../lib/types';

// Conversation steps are objects { role, type, text }. For editing we show one
// line per step (the text); on save we re-derive alternating roles.
function messagesToText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  return messages
    .map((m) => {
      if (typeof m === 'string') return m;
      if (m && typeof m === 'object') return String((m as { text?: string }).text ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function textToSteps(body: string): Array<{ role: 'initiator' | 'responder'; type: 'text'; text: string }> {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text, i) => ({ role: i % 2 === 0 ? 'initiator' : 'responder', type: 'text', text }));
}

export function Templates() {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ConversationTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [spintaxOpen, setSpintaxOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({ queryKey: ['templates'], queryFn: () => get<ConversationTemplate[]>('/api/templates') });

  function refresh() { qc.invalidateQueries({ queryKey: ['templates'] }); }

  async function remove(id: string) {
    try { await del(`/api/templates/${id}`); toast.success('Template removido'); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }
  async function toggleActive(t: ConversationTemplate) {
    try { await patch(`/api/templates/${t.id}`, { isActive: !t.isActive }); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
  }

  if (isLoading) return <Loading label="Carregando templates…" />;
  const templates = data ?? [];

  const PAGE_SIZE = 60;
  const q = search.trim().toLowerCase();
  const filtered = q
    ? templates.filter((t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    : templates;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p>{templates.length} roteiro(s) de conversa com spintax para variação automática das mensagens.</p>
        </div>
        <div className="toolbar">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Buscar por nome ou categoria…"
            style={{ width: 240 }}
          />
          <Button variant="ghost" onClick={() => setSpintaxOpen(true)}>Testar spintax</Button>
          <Button variant="ghost" onClick={refresh}><IconRefresh /> Atualizar</Button>
          <Button variant="primary" onClick={() => setCreating(true)}><IconPlus /> Novo template</Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card><Empty icon={<IconTemplate />} title="Nenhum template" hint="Crie roteiros para o motor de conversas usar."
          action={<Button variant="primary" onClick={() => setCreating(true)}><IconPlus /> Criar template</Button>} /></Card>
      ) : filtered.length === 0 ? (
        <Card><Empty icon={<IconTemplate />} title="Nada encontrado" hint={`Nenhum template combina com "${search}".`} /></Card>
      ) : (
        <>
        <div className="row-between" style={{ marginBottom: 'var(--space-4)' }}>
          <span className="text-sm muted">
            Mostrando {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} de {filtered.length}
          </span>
          {totalPages > 1 && (
            <div className="row gap-2">
              <Button size="sm" variant="ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Anterior</Button>
              <span className="text-sm muted" style={{ minWidth: 80, textAlign: 'center' }}>{safePage + 1} / {totalPages}</span>
              <Button size="sm" variant="ghost" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>Próxima →</Button>
            </div>
          )}
        </div>
        <div className="grid grid-3">
          {pageItems.map((t) => {
            const count = Array.isArray(t.messages) ? t.messages.length : 0;
            return (
              <Card key={t.id}>
                <div className="card-head">
                  <div className="col">
                    <span className="card-title">{t.name}</span>
                    <span className="card-sub">{t.category}</span>
                  </div>
                  <Badge tone={t.isActive ? 'success' : 'neutral'} dot={false}>{t.isActive ? 'ativo' : 'inativo'}</Badge>
                </div>
                <p className="text-sm muted" style={{ minHeight: 40 }}>{count} mensagem(ns) no roteiro</p>
                <div className="row gap-2" style={{ marginTop: 'var(--space-3)' }}>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(t)}>{t.isActive ? 'Desativar' : 'Ativar'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t.id)} title="Remover"><IconTrash /></Button>
                </div>
              </Card>
            );
          })}
        </div>
        </>
      )}

      <TemplateEditor
        open={creating || !!editing}
        template={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { refresh(); setCreating(false); setEditing(null); }}
      />
      <SpintaxModal open={spintaxOpen} onClose={() => setSpintaxOpen(false)} />
    </>
  );
}

function TemplateEditor({ open, template, onClose, onSaved }: { open: boolean; template: ConversationTemplate | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  // Initialize fields whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setCategory(template?.category ?? 'casual');
    setBody(template ? messagesToText(template.messages) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    const messages = textToSteps(body);
    if (!name.trim()) return toast.error('Informe um nome');
    if (messages.length === 0) return toast.error('Adicione ao menos uma mensagem');
    setBusy(true);
    try {
      if (template) await patch(`/api/templates/${template.id}`, { name, category, messages });
      else await post('/api/templates', { name, category, messages });
      toast.success('Template salvo');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={template ? 'Editar template' : 'Novo template'} wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="grid grid-2" style={{ gap: 'var(--space-4)' }}>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Saudação manhã" /></Field>
        <Field label="Categoria"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="casual" /></Field>
      </div>
      <Field label="Mensagens (uma por linha — alternam entre as duas contas)" hint="Linha 1 = conta A, linha 2 = conta B, e assim por diante. Spintax suportado: {oi|olá|e aí} {tudo bem|beleza}?">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 200 }}
          placeholder={'{oi|olá|e aí}, {tudo bem|beleza}?\n{viu|reparou} {aquilo|isso}?'} />
      </Field>
    </Modal>
  );
}

function SpintaxModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('{oi|olá|e aí}, {tudo bem|beleza|suave}?');
  const [variations, setVariations] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await post<{ variations: string[] }>('/api/templates/preview-spintax', { text, count: 8 });
      setVariations(res.variations);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Testar spintax"
      footer={<Button variant="primary" loading={busy} onClick={run}>Gerar variações</Button>}>
      <Field label="Texto com spintax">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {variations.length > 0 && (
        <div className="col gap-2">
          <span className="label">Variações geradas</span>
          {variations.map((v, i) => (
            <div key={i} className="text-sm" style={{ padding: '6px 10px', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)' }}>{v}</div>
          ))}
        </div>
      )}
    </Modal>
  );
}
