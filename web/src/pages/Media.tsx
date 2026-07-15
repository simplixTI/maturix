import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, del, post, upload, getToken, API_BASE } from '../lib/api';
import { Card, Button, Stat, Loading, Empty, Badge } from '../components/ui';
import { useToast } from '../components/Toast';
import { IconInbox, IconTrash, IconPlus, IconRefresh } from '../components/Icons';

type MediaPools = Record<string, { count: number; files: string[] }>;

interface ScheduleRow {
  type: string;
  fromDay: number;
  perDay: string;
  chancePct: number;
  everyNDays: number | null;
}

const TYPE_LABEL: Record<string, string> = {
  image: 'Foto', sticker: 'Sticker', audio: 'Áudio (voz)', video: 'Vídeo',
};

interface UploadResult {
  saved: Array<{ filename: string; category: string }>;
  skipped: Array<{ filename: string; reason: string }>;
}

const CATEGORIES: { key: string; label: string; hint: string; accept: string }[] = [
  { key: 'images', label: 'Fotos', hint: 'Dia 4+ · 1–2/dia', accept: 'image/*' },
  { key: 'audio', label: 'Áudios (voz)', hint: 'Dia 6+ · 1–2/dia', accept: 'audio/*' },
  { key: 'video', label: 'Vídeos', hint: 'Dia 8+ · ~1 a cada 2 dias', accept: 'video/*' },
  { key: 'stickers', label: 'Stickers', hint: 'Dia 4+ · ocasional', accept: 'image/webp,image/png' },
  { key: 'avatars', label: 'Avatares (perfil)', hint: 'Foto de perfil · maturação', accept: 'image/*' },
];

/** Loads an auth-protected media file as a blob URL for previewing. */
function AuthThumb({ category, filename }: { category: string; filename: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    const token = getToken();
    fetch(`${API_BASE}/api/media/file/${category}/${encodeURIComponent(filename)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => {
        const u = URL.createObjectURL(b);
        revoked = u;
        setUrl(u);
      })
      .catch(() => {});
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [category, filename]);

  if (!url) return <div className="media-thumb media-thumb--ph" />;
  return <img className="media-thumb" src={url} alt={filename} loading="lazy" />;
}

export function Media() {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const filesRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<HTMLInputElement | null>(null);
  const sectionCat = useRef<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['media'],
    queryFn: () => get<MediaPools>('/api/media'),
    refetchInterval: 30_000,
  });

  const scheduleQuery = useQuery({
    queryKey: ['media-schedule'],
    queryFn: () => get<ScheduleRow[]>('/api/media/schedule'),
  });

  // Enable directory selection on the folder input (not a standard React prop).
  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute('webkitdirectory', '');
      folderRef.current.setAttribute('directory', '');
    }
  }, []);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['media'] });
  }

  function pickForCategory(cat: string) {
    sectionCat.current = cat;
    sectionRef.current?.click();
  }

  async function uploadFiles(fileList: FileList | null, forcedCategory?: string) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => /^(image|audio|video)\//.test(f.type));
    if (files.length === 0) {
      toast.error('Nenhum arquivo de imagem, áudio ou vídeo encontrado');
      return;
    }
    setBusy(true);
    try {
      const res = await upload<UploadResult>('/api/media/upload', files, forcedCategory ? { category: forcedCategory } : undefined);
      const savedN = res.saved.length;
      const skipN = res.skipped.length;
      if (savedN > 0) toast.success(`${savedN} arquivo(s) enviado(s)${skipN ? ` · ${skipN} ignorado(s)` : ''}`);
      else toast.error(skipN ? `Nada enviado · ${skipN} ignorado(s) (duplicado/sem suporte)` : 'Nada enviado');
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no upload');
    } finally {
      setBusy(false);
      if (filesRef.current) filesRef.current.value = '';
      if (folderRef.current) folderRef.current.value = '';
      if (sectionRef.current) sectionRef.current.value = '';
      sectionCat.current = null;
    }
  }

  async function removeFile(category: string, filename: string) {
    try {
      await del(`/api/media/${category}/${encodeURIComponent(filename)}`);
      toast.success('Arquivo removido');
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover');
    }
  }

  async function reloadFolders() {
    setBusy(true);
    try {
      await post('/api/media/reload');
      toast.success('Pastas recarregadas');
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao recarregar');
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    uploadFiles(e.dataTransfer.files);
  }

  if (isLoading) return <Loading label="Carregando mídia…" />;

  const pools = data ?? {};
  const totalFiles = Object.values(pools).reduce((s, p) => s + (p?.count ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mídia</h1>
          <p>{totalFiles} arquivo(s) no acervo · mesclados nas conversas conforme o dia de aquecimento.</p>
        </div>
        <div className="toolbar">
          <Button variant="ghost" onClick={reloadFolders} disabled={busy}><IconRefresh /> Recarregar pastas</Button>
          <Button variant="ghost" onClick={() => folderRef.current?.click()} disabled={busy}>Selecionar pasta</Button>
          <Button variant="primary" onClick={() => filesRef.current?.click()} disabled={busy}>
            <IconPlus /> Enviar arquivos
          </Button>
        </div>
      </div>

      <input ref={filesRef} type="file" multiple accept="image/*,audio/*,video/*" hidden
        onChange={(e) => uploadFiles(e.target.files)} />
      <input ref={folderRef} type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)} />
      <input ref={sectionRef} type="file" multiple hidden accept="image/*,audio/*,video/*"
        onChange={(e) => uploadFiles(e.target.files, sectionCat.current ?? undefined)} />

      <div className="grid grid-stats" style={{ marginBottom: 'var(--space-5, 20px)' }}>
        {CATEGORIES.map((c) => (
          <Stat key={c.key} label={c.label} value={pools[c.key]?.count ?? 0} foot={c.hint} icon={<IconInbox />} />
        ))}
      </div>

      {scheduleQuery.data && scheduleQuery.data.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-4)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Cronograma de mídia</h3>
            <span className="text-xs muted">quando cada tipo entra no aquecimento e com que frequência</span>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>A partir do dia</th>
                  <th>Cota/dia</th>
                  <th>Chance por oportunidade</th>
                  <th>Acervo</th>
                </tr>
              </thead>
              <tbody>
                {scheduleQuery.data.map((r) => (
                  <tr key={r.type}>
                    <td>{TYPE_LABEL[r.type] ?? r.type}</td>
                    <td className="mono">dia {r.fromDay}{r.everyNDays ? ` · a cada ${r.everyNDays}d` : ''}</td>
                    <td className="mono">{r.perDay}</td>
                    <td className="mono">{r.chancePct}%</td>
                    <td>
                      <Badge tone={(pools[r.type === 'image' ? 'images' : r.type]?.count ?? 0) > 0 ? 'success' : 'warning'} dot={false}>
                        {pools[r.type === 'image' ? 'images' : r.type]?.count ?? 0} arquivo(s)
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs muted" style={{ marginTop: 8 }}>
            Tudo respeita o teto diário, o limite por hora e a fase do dia. Cada envio é re-encodado para gerar um hash único.
          </p>
        </Card>
      )}

      <Card>
        <div
          className="media-drop"
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <IconInbox />
          <p><strong>Arraste fotos, áudios e vídeos aqui</strong></p>
          <p className="text-xs muted">
            Roteado automaticamente por tipo. Cada envio é re-encodado (hash único) para não repetir arquivo idêntico entre os chips.
          </p>
        </div>
      </Card>

      {CATEGORIES.map((c) => {
        const pool = pools[c.key];
        const files = pool?.files ?? [];
        return (
          <Card key={c.key} className="media-section">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{c.label} <Badge tone="neutral" dot={false}>{files.length}</Badge></h3>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="text-xs muted">{c.hint}</span>
                <Button size="sm" variant="ghost" onClick={() => pickForCategory(c.key)} disabled={busy}>
                  <IconPlus /> Enviar
                </Button>
              </div>
            </div>
            {files.length === 0 ? (
              <Empty icon={<IconInbox />} title={`Sem ${c.label.toLowerCase()}`} hint="Envie arquivos para liberar este tipo no aquecimento." />
            ) : (
              <div className="media-grid">
                {files.map((f) => (
                  <div key={f} className="media-item">
                    {c.key === 'images' || c.key === 'stickers' || c.key === 'avatars'
                      ? <AuthThumb category={c.key} filename={f} />
                      : <div className="media-thumb media-thumb--file">{c.key === 'audio' ? '🎙️' : '🎬'}</div>}
                    <button className="media-del" title="Remover" onClick={() => removeFile(c.key, f)}>
                      <IconTrash />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
