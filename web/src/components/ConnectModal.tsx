import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Modal } from './Modal';
import { Button, Field, Input, Spinner } from './ui';
import { post } from '../lib/api';
import { getSocket, subscribeAccount, unsubscribeAccount } from '../lib/socket';
import { useToast } from './Toast';
import { IconCheck, IconRefresh, IconX } from './Icons';

interface ConnectModalProps {
  open: boolean;
  onClose: () => void;
  onConnected?: () => void;
  /** When provided, connects an existing account (reconnect). Otherwise asks for a phone. */
  existing?: { accountId: string; phoneNumber: string } | null;
}

type Phase = 'form' | 'waiting' | 'qr' | 'pairing' | 'connected' | 'error';

// If no QR/pairing arrives in this window, something is wrong (commonly a dead
// proxy assigned to the account). Show an actionable error instead of spinning.
const QR_TIMEOUT_MS = 30_000;

export function ConnectModal({ open, onClose, onConnected, existing }: ConnectModalProps) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('form');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const accountIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWaitTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Reset when (re)opened
  useEffect(() => {
    if (open) {
      setPhase('form');
      setQrDataUrl('');
      setPairingCode('');
      setErrorMsg('');
      clearWaitTimeout();
      setPhone(existing?.phoneNumber ?? '');
      setName('');
      accountIdRef.current = existing?.accountId ?? null;
      if (existing) {
        // Auto-start reconnect for an existing account
        void startConnection(existing.accountId, existing.phoneNumber, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Socket listeners scoped to this modal's lifetime
  useEffect(() => {
    if (!open) return;
    const socket = getSocket();

    const onQr = async ({ accountId, qr }: { accountId: string; qr: string }) => {
      if (accountIdRef.current && accountId !== accountIdRef.current) return;
      clearWaitTimeout(); // QR arrived — no longer "stuck"
      try {
        const url = await QRCode.toDataURL(qr, { margin: 1, width: 320, color: { dark: '#04130a', light: '#ffffff' } });
        setQrDataUrl(url);
        setPhase((p) => (p === 'pairing' ? p : 'qr'));
      } catch {
        /* ignore render errors */
      }
    };
    const onPairing = ({ accountId, code }: { accountId: string; code: string }) => {
      if (accountIdRef.current && accountId !== accountIdRef.current) return;
      clearWaitTimeout();
      setPairingCode(code);
      setPhase('pairing');
    };
    const onStatus = ({ accountId, status, reason }: { accountId: string; status: string; reason?: string }) => {
      if (accountIdRef.current && accountId !== accountIdRef.current) return;
      if (status === 'CONNECTED') {
        clearWaitTimeout();
        setPhase('connected');
        toast.success('Conta conectada com sucesso!');
        onConnected?.();
        return;
      }
      // Session dropped before pairing completed (e.g. dead proxy → QR expired).
      setPhase((p) => {
        if (p === 'waiting' || p === 'qr' || p === 'pairing') {
          clearWaitTimeout();
          setErrorMsg(
            reason === 'qr_expired'
              ? 'O QR expirou antes do pareamento. Causa mais comum: a conta está com um proxy offline. Tente de novo — se persistir, deixe o proxy em "Automático" na lista de Contas.'
              : `A sessão caiu antes de parear (${reason || status}). Verifique o proxy da conta e tente novamente.`
          );
          return 'error';
        }
        return p;
      });
    };

    socket.on('session:qr', onQr);
    socket.on('session:pairing-code', onPairing);
    socket.on('session:status', onStatus);
    return () => {
      socket.off('session:qr', onQr);
      socket.off('session:pairing-code', onPairing);
      socket.off('session:status', onStatus);
      clearWaitTimeout();
      if (accountIdRef.current) unsubscribeAccount(accountIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function startConnection(accountId: string | null, phoneNumber: string, reconnect: boolean) {
    setBusy(true);
    setPhase('waiting');
    try {
      if (reconnect && accountId) {
        subscribeAccount(accountId);
        await post('/api/sessions/reconnect', { accountId });
      } else {
        const res = await post<{ accountId: string }>('/api/sessions/connect', {
          phoneNumber,
          displayName: name || undefined,
        });
        accountIdRef.current = res.accountId;
        subscribeAccount(res.accountId);
      }
      // Safety net: if no QR/pairing/connection within the window, surface an error.
      clearWaitTimeout();
      timeoutRef.current = setTimeout(() => {
        setPhase((p) => {
          if (p === 'waiting') {
            setErrorMsg('Não recebemos o QR a tempo. Causa mais comum: a conta está com um proxy offline. Tente novamente — você pode deixar o proxy em "Automático" na lista de Contas.');
            return 'error';
          }
          return p;
        });
      }, QR_TIMEOUT_MS);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar conexão');
      setPhase('form');
    } finally {
      setBusy(false);
    }
  }

  async function requestPairing() {
    const accountId = accountIdRef.current;
    const cleanPhone = phone.replace(/\D/g, '');
    if (!accountId || !cleanPhone) {
      toast.error('Aguarde a sessão inicializar antes de pedir o código.');
      return;
    }
    setBusy(true);
    // Retry: the socket may take a moment to be ready
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await post<{ code: string }>('/api/sessions/pairing-code', { accountId, phoneNumber: cleanPhone });
        setPairingCode(res.code);
        setPhase('pairing');
        setBusy(false);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    setBusy(false);
    toast.error('Não foi possível gerar o código. Tente o QR.');
  }

  const cleanPhone = phone.replace(/\D/g, '');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Reconectar conta' : 'Conectar nova conta'}
    >
      {phase === 'form' && (
        <>
          <Field label="Número de telefone" hint="Com código do país. Ex: 5511912345678">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="55 11 91234-5678"
              inputMode="tel"
            />
          </Field>
          <Field label="Nome de exibição (opcional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Atendimento Loja" />
          </Field>
          <Button
            variant="primary"
            block
            loading={busy}
            disabled={cleanPhone.length < 10}
            onClick={() => startConnection(null, cleanPhone, false)}
          >
            Iniciar conexão
          </Button>
        </>
      )}

      {phase === 'waiting' && (
        <div className="col center" style={{ alignItems: 'center', gap: 16, padding: '24px 0' }}>
          <Spinner lg />
          <div className="col center" style={{ gap: 4 }}>
            <span style={{ fontWeight: 600 }}>Inicializando sessão…</span>
            <span className="muted text-sm">Gerando QR code, aguarde alguns segundos.</span>
          </div>
        </div>
      )}

      {phase === 'qr' && (
        <div className="col" style={{ gap: 16, alignItems: 'center' }}>
          <div className="qr-frame">
            {qrDataUrl ? <img src={qrDataUrl} alt="QR Code de conexão" /> : <Spinner lg />}
          </div>
          <div className="col center" style={{ gap: 4 }}>
            <span style={{ fontWeight: 600 }}>Escaneie com o WhatsApp</span>
            <span className="muted text-sm center">
              Abra o WhatsApp → Aparelhos conectados → Conectar um aparelho.
            </span>
          </div>
          <div className="row gap-2">
            <span className="muted text-xs">O QR renova automaticamente.</span>
            <button className="btn btn-sm btn-ghost" onClick={requestPairing} disabled={busy}>
              {busy ? <Spinner /> : null} Usar código de 8 dígitos
            </button>
          </div>
        </div>
      )}

      {phase === 'pairing' && (
        <div className="col" style={{ gap: 16, alignItems: 'center' }}>
          <div className="pairing-code spread">{pairingCode || '········'}</div>
          <div className="col center" style={{ gap: 4 }}>
            <span style={{ fontWeight: 600 }}>Digite este código no WhatsApp</span>
            <span className="muted text-sm center">
              Aparelhos conectados → Conectar com número → insira o código acima.
            </span>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => setPhase('qr')}>
            <IconRefresh /> Voltar para o QR
          </button>
        </div>
      )}

      {phase === 'connected' && (
        <div className="col center" style={{ alignItems: 'center', gap: 16, padding: '24px 0' }}>
          <div className="avatar" style={{ width: 56, height: 56, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <IconCheck width={28} />
          </div>
          <div className="col center" style={{ gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--text-lg)' }}>Conectado!</span>
            <span className="muted text-sm">A conta está pronta para aquecimento.</span>
          </div>
          <Button variant="primary" onClick={onClose}>Concluir</Button>
        </div>
      )}

      {phase === 'error' && (
        <div className="col center" style={{ alignItems: 'center', gap: 16, padding: '12px 0' }}>
          <div className="avatar" style={{ width: 56, height: 56, background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            <IconX width={28} />
          </div>
          <div className="col center" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--text-lg)' }}>Não foi possível parear</span>
            <span className="muted text-sm center">{errorMsg}</span>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setErrorMsg('');
              setQrDataUrl('');
              setPairingCode('');
              setPhase('form');
            }}
          >
            <IconRefresh /> Tentar de novo
          </Button>
        </div>
      )}
    </Modal>
  );
}
