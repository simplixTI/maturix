import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, patch, post } from '../lib/api';
import { Card, Button, Loading, Empty, Field, Input, Textarea, Select } from '../components/ui';
import { useToast } from '../components/Toast';
import { useConnectedAccounts } from '../lib/hooks';
import { IconUserCircle } from '../components/Icons';
import { formatPhone } from '../lib/format';

interface ProfileInfo {
  accountId: string;
  jid: string;
  name: string | null;
  bio: string | null;
  pictureUrl: string | null;
}

export function Profiles() {
  const toast = useToast();
  const accounts = useConnectedAccounts();
  const [account, setAccount] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const [uploading, setUploading] = useState(false);

  const profile = useQuery({
    queryKey: ['profile', account],
    queryFn: () => get<ProfileInfo>(`/api/profile/${account}`),
    enabled: !!account,
  });

  useEffect(() => {
    if (profile.data) {
      setName(profile.data.name ?? '');
      setBio(profile.data.bio ?? '');
    }
  }, [profile.data]);

  const connected = accounts.data ?? [];

  async function saveName() {
    setSavingName(true);
    try { await patch(`/api/profile/${account}/name`, { name }); toast.success('Nome atualizado'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setSavingName(false); }
  }
  async function saveBio() {
    setSavingBio(true);
    try { await patch(`/api/profile/${account}/bio`, { bio }); toast.success('Bio atualizada'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha'); }
    finally { setSavingBio(false); }
  }
  async function onPic(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file);
      });
      await post(`/api/profile/${account}/picture`, { data: dataUrl });
      toast.success('Foto atualizada');
      profile.refetch();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Falha'); }
    finally { setUploading(false); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Perfis</h1>
          <p>Nome, bio e foto de cada número conectado (limites do WhatsApp aplicados).</p>
        </div>
        <Select value={account} onChange={(e) => setAccount(e.target.value)} style={{ width: 240 }}>
          <option value="">Selecione a conta…</option>
          {connected.map((a) => <option key={a.id} value={a.id}>{formatPhone(a.phoneNumber)}</option>)}
        </Select>
      </div>

      {!account ? (
        <Card><Empty icon={<IconUserCircle />} title="Escolha uma conta conectada" hint="Edite a identidade de cada número aqui." /></Card>
      ) : profile.isLoading ? (
        <Loading label="Carregando perfil…" />
      ) : profile.isError ? (
        <Card><Empty title="Não foi possível carregar" hint="A conta precisa estar conectada e inicializada." /></Card>
      ) : (
        <div className="grid grid-2">
          <Card>
            <div className="col" style={{ alignItems: 'center', gap: 'var(--space-4)' }}>
              {profile.data?.pictureUrl ? (
                <img src={profile.data.pictureUrl} alt="Foto de perfil" style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line-strong)' }} />
              ) : (
                <div className="avatar" style={{ width: 120, height: 120, fontSize: 32 }}><IconUserCircle width={48} /></div>
              )}
              <Field label="Trocar foto">
                <input type="file" accept="image/*" className="input" onChange={onPic} disabled={uploading} />
                {uploading && <span className="hint">Enviando…</span>}
              </Field>
            </div>
          </Card>
          <Card>
            <div className="col gap-4">
              <Field label="Nome de exibição" hint={`${name.length}/25 caracteres`}>
                <Input value={name} maxLength={25} onChange={(e) => setName(e.target.value)} />
                <Button size="sm" variant="primary" loading={savingName} onClick={saveName} style={{ alignSelf: 'flex-start', marginTop: 6 }}>Salvar nome</Button>
              </Field>
              <Field label="Bio / recado" hint={`${bio.length}/139 caracteres`}>
                <Textarea value={bio} maxLength={139} onChange={(e) => setBio(e.target.value)} style={{ minHeight: 70 }} />
                <Button size="sm" variant="primary" loading={savingBio} onClick={saveBio} style={{ alignSelf: 'flex-start', marginTop: 6 }}>Salvar bio</Button>
              </Field>
              <p className="text-xs muted">Há um limite de 1 atualização a cada 30s por campo, por conta.</p>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
