import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { Card, Button, Field, Input, Select, Textarea, Empty, Loading, Badge } from '../components/ui';
import { useToast } from '../components/Toast';
import { IconSend, IconCheck, IconX } from '../components/Icons';
import { formatPhone } from '../lib/format';

interface SendableAccount {
  id: string;
  phoneNumber: string;
  warmupDay: number;
  msgsSentToday: number;
}
interface SendResult {
  sent: number;
  failed: number;
  results: { target: string; status: string; error?: string }[];
}

const TYPES = [
  { v: 'text', label: 'Texto' },
  { v: 'image', label: 'Imagem' },
  { v: 'audio', label: 'Áudio' },
  { v: 'video', label: 'Vídeo' },
  { v: 'sticker', label: 'Figurinha' },
];

export function Send() {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [type, setType] = useState('text');
  const [content, setContent] = useState('');
  const [caption, setCaption] = useState('');
  const [targets, setTargets] = useState('');
  const [delay, setDelay] = useState(6);
  const [mediaPath, setMediaPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const accounts = useQuery({ queryKey: ['send-accounts'], queryFn: () => get<SendableAccount[]>('/api/send/accounts') });

  const targetList = targets.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  const isMedia = type !== 'text';

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await post<{ path: string }>('/api/send/upload', {
        data: dataUrl,
        filename: file.name,
        type: file.type,
      });
      setMediaPath(res.path);
      toast.success('Arquivo enviado ao servidor');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload');
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if (!from) return toast.error('Selecione a conta de origem');
    if (targetList.length === 0) return toast.error('Informe ao menos um destino');
    if (type === 'text' && !content.trim()) return toast.error('Escreva a mensagem');
    if (isMedia && !mediaPath) return toast.error('Faça upload do arquivo de mídia');

    setSending(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        fromAccountId: from,
        targets: targetList,
        messageType: type,
        delay,
      };
      if (type === 'text') body.content = content;
      else {
        body.mediaUrl = mediaPath;
        if (caption) body.caption = caption;
      }
      const res = await post<SendResult>('/api/send', body);
      setResult(res);
      toast.success(`Concluído: ${res.sent} enviada(s), ${res.failed} falha(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no envio');
    } finally {
      setSending(false);
    }
  }

  if (accounts.isLoading) return <Loading label="Carregando contas conectadas…" />;

  const connected = accounts.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Enviar mensagem</h1>
          <p>Disparo manual a partir de uma conta conectada, com simulação de digitação.</p>
        </div>
      </div>

      {connected.length === 0 ? (
        <Card><Empty title="Nenhuma conta conectada" hint="Conecte um número na aba Contas para poder enviar." /></Card>
      ) : (
        <div className="grid grid-2">
          <Card>
            <div className="col gap-4">
              <Field label="Enviar de">
                <Select value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="">Selecione uma conta…</option>
                  {connected.map((a) => (
                    <option key={a.id} value={a.id}>{formatPhone(a.phoneNumber)} · dia {a.warmupDay} · {a.msgsSentToday} hoje</option>
                  ))}
                </Select>
              </Field>

              <Field label="Tipo de mensagem">
                <div className="row wrap gap-2">
                  {TYPES.map((t) => (
                    <span key={t.v} className={`chip ${type === t.v ? 'active' : ''}`} onClick={() => { setType(t.v); setResult(null); }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              </Field>

              {type === 'text' ? (
                <Field label="Mensagem" hint="Suporta spintax: {oi|olá|e aí}">
                  <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Escreva sua mensagem…" />
                </Field>
              ) : (
                <>
                  <Field label="Arquivo de mídia">
                    <input type="file" className="input" onChange={onFile}
                      accept={type === 'image' || type === 'sticker' ? 'image/*' : type === 'audio' ? 'audio/*' : 'video/*'} />
                    {uploading && <span className="hint">Enviando…</span>}
                    {mediaPath && <span className="hint" style={{ color: 'var(--accent)' }}>✓ {mediaPath}</span>}
                  </Field>
                  {(type === 'image' || type === 'video') && (
                    <Field label="Legenda (opcional)">
                      <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Legenda da mídia" />
                    </Field>
                  )}
                </>
              )}

              <div className="grid grid-2" style={{ gap: 'var(--space-4)' }}>
                <Field label="Destinos" hint="Um por linha (com DDI). Ex: 5511999998888">
                  <Textarea value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={'5511999998888\n5521988887777'} />
                </Field>
                <Field label="Intervalo entre envios (s)" hint="mínimo 3s">
                  <Input type="number" min={3} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
                </Field>
              </div>

              <div className="row-between">
                <span className="text-sm muted">{targetList.length} destino(s)</span>
                <Button variant="primary" loading={sending} onClick={send}><IconSend /> Enviar agora</Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="card-head">
              <div className="card-title">Resultado</div>
              {result && <Badge tone="info" dot={false}>{result.sent + result.failed} processado(s)</Badge>}
            </div>
            {!result ? (
              <Empty icon={<IconSend />} title="Sem envios ainda" hint="O resultado de cada destino aparece aqui." />
            ) : (
              <div className="col gap-2">
                <div className="row gap-4" style={{ marginBottom: 8 }}>
                  <Badge tone="success" dot={false}>{result.sent} enviadas</Badge>
                  <Badge tone="danger" dot={false}>{result.failed} falhas</Badge>
                </div>
                {result.results.map((r, i) => (
                  <div key={i} className="row-between text-sm" style={{ padding: '4px 0', borderBottom: '1px solid var(--line-faint)' }}>
                    <span className="mono">{formatPhone(r.target)}</span>
                    {r.status === 'sent'
                      ? <span className="row" style={{ color: 'var(--success)', gap: 6 }}><IconCheck width={14} /> enviada</span>
                      : <span className="row" style={{ color: 'var(--danger)', gap: 6 }} title={r.error}><IconX width={14} /> falha</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
