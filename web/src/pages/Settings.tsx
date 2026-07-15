import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { Card, Button, Loading, Field, Input, Badge } from '../components/ui';
import { useToast } from '../components/Toast';
import { IconCheck, IconBell } from '../components/Icons';

interface SettingsResponse {
  safeZones?: Record<string, unknown>;
  timing?: Record<string, unknown>;
  session?: Record<string, unknown>;
  warmup?: Record<string, unknown>;
  warmupProfiles?: unknown;
  webhookUrl?: string | null;
}
interface WebhookInfo { url: string | null; type: string }

function KeyValues({ obj }: { obj?: Record<string, unknown> }) {
  if (!obj) return null;
  const entries = Object.entries(obj).filter(([, v]) => typeof v !== 'object');
  if (entries.length === 0) return <span className="text-sm muted">—</span>;
  return (
    <div className="col gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="row-between text-sm" style={{ borderBottom: '1px solid var(--line-faint)', padding: '4px 0' }}>
          <span className="muted">{k}</span>
          <span className="mono">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

interface Timing {
  sendDelayMinMs: number;
  sendDelayMaxMs: number;
  reactionDelayMinMs: number;
  reactionDelayMaxMs: number;
}

function TimingCard() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['timing'], queryFn: () => get<Timing>('/api/settings/timing') });
  const [sMin, setSMin] = useState('7');
  const [sMax, setSMax] = useState('180');
  const [rMin, setRMin] = useState('7');
  const [rMax, setRMax] = useState('90');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data) {
      setSMin(String(Math.round(q.data.sendDelayMinMs / 1000)));
      setSMax(String(Math.round(q.data.sendDelayMaxMs / 1000)));
      setRMin(String(Math.round(q.data.reactionDelayMinMs / 1000)));
      setRMax(String(Math.round(q.data.reactionDelayMaxMs / 1000)));
    }
  }, [q.data]);

  async function save() {
    const toMs = (v: string) => Math.round(Number(v) * 1000);
    const body = {
      sendDelayMinMs: toMs(sMin),
      sendDelayMaxMs: toMs(sMax),
      reactionDelayMinMs: toMs(rMin),
      reactionDelayMaxMs: toMs(rMax),
    };
    if ([sMin, sMax, rMin, rMax].some((v) => v === '' || Number.isNaN(Number(v)) || Number(v) < 1)) {
      return toast.error('Use valores em segundos (mínimo 1).');
    }
    setSaving(true);
    try {
      await post('/api/settings/timing', body);
      toast.success('Ritmo de mensagens salvo · vale na hora');
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ marginBottom: 'var(--space-5)' }}>
      <div className="card-head">
        <div>
          <div className="card-title">Ritmo de mensagens</div>
          <div className="card-sub">Intervalo aleatório (em segundos) antes de cada envio no aquecimento. Aplica na hora, sem reiniciar.</div>
        </div>
        {q.data && (
          <Badge tone="info" dot={false}>
            atual: {Math.round(q.data.sendDelayMinMs / 1000)}s–{Math.round(q.data.sendDelayMaxMs / 1000)}s
          </Badge>
        )}
      </div>
      <div className="grid grid-2" style={{ gap: 'var(--space-4)' }}>
        <Field label="Mensagem — mínimo (s)" hint="ex: 7">
          <Input type="number" min={1} value={sMin} onChange={(e) => setSMin(e.target.value)} />
        </Field>
        <Field label="Mensagem — máximo (s)" hint="ex: 180 (3 min)">
          <Input type="number" min={1} value={sMax} onChange={(e) => setSMax(e.target.value)} />
        </Field>
        <Field label="Reação — mínimo (s)">
          <Input type="number" min={1} value={rMin} onChange={(e) => setRMin(e.target.value)} />
        </Field>
        <Field label="Reação — máximo (s)">
          <Input type="number" min={1} value={rMax} onChange={(e) => setRMax(e.target.value)} />
        </Field>
      </div>
      <div className="row gap-2" style={{ marginTop: 'var(--space-3)' }}>
        <Button variant="primary" loading={saving} onClick={save}><IconCheck /> Salvar ritmo</Button>
      </div>
      <p className="hint" style={{ marginTop: 'var(--space-2)' }}>
        O tempo de cada envio é sorteado nesse intervalo (distribuição humana, concentrando no meio). Valores maiores = mais seguro contra ban, porém mais lento.
      </p>
    </Card>
  );
}

interface Protection { banOnLogout: boolean; autoPauseOnCritical: boolean; autoSaveInboundContacts: boolean; rejectCalls: boolean }

function ToggleRow({ label, hint, checked, busy, onChange }: {
  label: string; hint: string; checked: boolean; busy: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-2) 0' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="text-xs muted" style={{ maxWidth: 560 }}>{hint}</div>
      </div>
      <Button variant={checked ? 'primary' : 'ghost'} loading={busy} onClick={() => onChange(!checked)} style={{ minWidth: 110 }}>
        {checked ? 'Ligado' : 'Desligado'}
      </Button>
    </div>
  );
}

function ProtectionCard() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['protection'], queryFn: () => get<Protection>('/api/settings/protection') });
  const [saving, setSaving] = useState<string | null>(null);

  async function toggle(key: keyof Protection, value: boolean) {
    setSaving(key);
    try {
      await post('/api/settings/protection', { [key]: value });
      toast.success('Proteção atualizada');
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha');
    } finally {
      setSaving(null);
    }
  }

  const p = q.data;
  return (
    <Card style={{ marginBottom: 'var(--space-5)' }}>
      <div className="card-head">
        <div>
          <div className="card-title">Proteção anti-ban</div>
          <div className="card-sub">Como o sistema reage a logout inesperado e a risco crítico. Aplica na hora.</div>
        </div>
      </div>
      <ToggleRow
        label="Detectar banimento no logout (401)"
        hint="Quando o WhatsApp desconecta com logout inesperado, tratar como banimento: marca o número como BANIDO, pausa e dispara alerta. (Um 401 também pode ser desvínculo manual.)"
        checked={!!p?.banOnLogout}
        busy={saving === 'banOnLogout'}
        onChange={(v) => toggle('banOnLogout', v)}
      />
      <ToggleRow
        label="Auto-pausar quando risco CRÍTICO"
        hint="Além de bloquear os envios, pausa o número automaticamente quando o risco de ban fica crítico (bloqueio alto / poucas respostas). Desligado: só bloqueia e alerta, você decide pausar."
        checked={!!p?.autoPauseOnCritical}
        busy={saving === 'autoPauseOnCritical'}
        onChange={(v) => toggle('autoPauseOnCritical', v)}
      />
      <ToggleRow
        label="Salvar contato de quem manda mensagem"
        hint="Quando alguém de fora (pessoa/empresa real, não os seus chips) manda mensagem pro número, salva esse contato no WhatsApp automaticamente. Gente real salva quem conversa com ela — é sinal de confiança. Salva uma vez por número, com ritmo humano."
        checked={!!p?.autoSaveInboundContacts}
        busy={saving === 'autoSaveInboundContacts'}
        onChange={(v) => toggle('autoSaveInboundContacts', v)}
      />
      <ToggleRow
        label="Rejeitar chamadas automaticamente"
        hint="Recusa toda chamada recebida na hora. Em número novo, deixar chamada tocar e acumular como perdida parece estranho. Desligue se o número também é usado por uma pessoa real que quer atender."
        checked={!!p?.rejectCalls}
        busy={saving === 'rejectCalls'}
        onChange={(v) => toggle('rejectCalls', v)}
      />
    </Card>
  );
}

interface WarmupFeatures {
  status: boolean;
  photos: boolean;
  videos: boolean;
  audios: boolean;
  stickers: boolean;
  business: boolean;
}

function WarmupFeaturesCard() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['warmup-features'], queryFn: () => get<WarmupFeatures>('/api/settings/warmup-features') });
  const [saving, setSaving] = useState<string | null>(null);

  async function toggle(key: keyof WarmupFeatures, value: boolean) {
    setSaving(key);
    try {
      await post('/api/settings/warmup-features', { [key]: value });
      toast.success('Aquecimento atualizado');
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha');
    } finally {
      setSaving(null);
    }
  }

  const f = q.data;
  return (
    <Card style={{ marginBottom: 'var(--space-5)' }}>
      <div className="card-head">
        <div>
          <div className="card-title">Atividades do aquecimento</div>
          <div className="card-sub">Escolha o que os chips fazem durante o aquecimento. Vale para todo o projeto e aplica na hora.</div>
        </div>
      </div>
      <ToggleRow label="Postar status" hint="Publicar status (stories) nos números — texto e imagens do acervo."
        checked={!!f?.status} busy={saving === 'status'} onChange={(v) => toggle('status', v)} />
      <ToggleRow label="Enviar fotos" hint="Enviar imagens nas conversas e avulsas."
        checked={!!f?.photos} busy={saving === 'photos'} onChange={(v) => toggle('photos', v)} />
      <ToggleRow label="Enviar vídeos" hint="Enviar vídeos durante o aquecimento."
        checked={!!f?.videos} busy={saving === 'videos'} onChange={(v) => toggle('videos', v)} />
      <ToggleRow label="Enviar áudios" hint="Enviar mensagens de voz (com indicador 'gravando…')."
        checked={!!f?.audios} busy={saving === 'audios'} onChange={(v) => toggle('audios', v)} />
      <ToggleRow label="Enviar figurinhas" hint="Enviar stickers nas conversas."
        checked={!!f?.stickers} busy={saving === 'stickers'} onChange={(v) => toggle('stickers', v)} />
      <ToggleRow label="Enviar para empresas" hint="Mandar mensagem para números de WhatsApp Business reais — gera tráfego externo (a empresa responde), quebrando o loop fechado só entre os chips."
        checked={!!f?.business} busy={saving === 'business'} onChange={(v) => toggle('business', v)} />
    </Card>
  );
}

export function Settings() {
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<SettingsResponse>('/api/settings') });
  const webhook = useQuery({ queryKey: ['webhook'], queryFn: () => get<WebhookInfo>('/api/settings/webhook') });

  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { if (webhook.data) setUrl(webhook.data.url ?? ''); }, [webhook.data]);

  async function save() {
    setSaving(true);
    try { await post('/api/settings/webhook', { url: url || undefined }); toast.success('Webhook salvo'); webhook.refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setSaving(false); }
  }
  async function test() {
    setTesting(true);
    try {
      const res = await post<{ success: boolean; error?: string }>('/api/settings/webhook/test');
      if (res.success) toast.success('Webhook testado com sucesso');
      else toast.error(res.error || 'Falha no teste');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setTesting(false); }
  }

  if (settings.isLoading) return <Loading label="Carregando configurações…" />;
  const s = settings.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Configurações</h1>
          <p>Parâmetros do motor anti-ban e notificações.</p>
        </div>
      </div>

      <WarmupFeaturesCard />

      <ProtectionCard />

      <TimingCard />

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card-head">
          <div>
            <div className="card-title">Webhook de alertas</div>
            <div className="card-sub">Receba alertas no Telegram, Discord ou endpoint próprio.</div>
          </div>
          {webhook.data?.type && webhook.data.type !== 'none' && <Badge tone="info" dot={false}>{webhook.data.type}</Badge>}
        </div>
        <Field label="URL do webhook" hint="Deixe em branco para desativar.">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
        </Field>
        <div className="row gap-2" style={{ marginTop: 'var(--space-3)' }}>
          <Button variant="primary" loading={saving} onClick={save}><IconCheck /> Salvar</Button>
          <Button variant="ghost" loading={testing} onClick={test}><IconBell /> Testar</Button>
        </div>
      </Card>

      <div className="grid grid-3">
        <Card>
          <div className="card-head"><div className="card-title">Zonas seguras</div></div>
          <KeyValues obj={s?.safeZones} />
        </Card>
        <Card>
          <div className="card-head"><div className="card-title">Timing</div></div>
          <KeyValues obj={s?.timing} />
        </Card>
        <Card>
          <div className="card-head"><div className="card-title">Sessão</div></div>
          <KeyValues obj={s?.session} />
        </Card>
        <Card className="span-2">
          <div className="card-head"><div className="card-title">Cronograma de aquecimento</div></div>
          <KeyValues obj={s?.warmup} />
        </Card>
      </div>
    </>
  );
}
