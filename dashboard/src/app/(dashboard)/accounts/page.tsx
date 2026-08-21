"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, QrCode, Power, Pause, Trash2, RefreshCw, Plus, Smartphone, CheckCircle2, Loader2, Wifi, WifiOff, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAccounts } from "@/hooks/useApi";
import { useSocket } from "@/lib/socket";
import { sessions as sessionsApi, accounts as accountsApi } from "@/lib/api";
import type { Account as ApiAccount } from "@/lib/api";

type Status = "connected" | "warming" | "paused" | "banned";
type ConnectStep = "idle" | "generating" | "waiting" | "connecting" | "success" | "error";

interface Account {
  id: string;
  phone: string;
  name: string;
  status: Status;
  day: number;
  sentToday: number;
  replyRate: number;
  proxy: string;
  session: string;
  uptime: string;
  lastMsg: string;
  capacity: number;
  maxCapacity: number;
}

const filters = ["all", "connected", "warming", "paused", "banned"] as const;
type Filter = (typeof filters)[number];
const filterLabels: Record<string, string> = { all: "todos", connected: "conectados", warming: "aquecendo", paused: "pausados", banned: "banidos" };

const dotMap: Record<Status, string> = { connected: "dot-ok", warming: "dot-warn", paused: "dot-off", banned: "dot-err" };
const statusLabels: Record<Status, string> = { connected: "conectado", warming: "aquecendo", paused: "pausado", banned: "banido" };

function mapApiStatus(s: string): Status {
  if (s === "CONNECTED") return "connected";
  if (s === "PAUSED") return "paused";
  if (s === "BANNED") return "banned";
  return "warming";
}

function mapApiAccount(a: ApiAccount): Account {
  const status = mapApiStatus(a.status);
  const replyRate = a.msgsReceivedToday > 0
    ? Math.round((a.msgsReceivedToday / Math.max(a.msgsSentToday, 1)) * 100)
    : 0;
  return {
    id: a.id,
    phone: a.phoneNumber,
    name: a.displayName || "",
    status,
    day: a.warmupDay,
    sentToday: a.msgsSentToday,
    replyRate,
    proxy: a.proxy ? `${a.proxy.host}:${a.proxy.port}` : "nenhum",
    session: a.id.slice(0, 6),
    uptime: `${a.warmupDay}d`,
    lastMsg: "--",
    capacity: a.msgsSentToday,
    maxCapacity: a.warmupState?.maxCapacity ?? 400,
  };
}

export default function AccountsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Account | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const { data: apiAccounts, loading, refetch } = useAccounts();
  const { on, off } = useSocket();

  const accounts: Account[] = apiAccounts
    ? apiAccounts.map(mapApiAccount)
    : [];

  const isLive = apiAccounts !== null;

  const filtered = filter === "all" ? accounts : accounts.filter((a) => a.status === filter);
  const counts: Record<Filter, number> = {
    all: accounts.length,
    connected: accounts.filter((a) => a.status === "connected").length,
    warming: accounts.filter((a) => a.status === "warming").length,
    paused: accounts.filter((a) => a.status === "paused").length,
    banned: accounts.filter((a) => a.status === "banned").length,
  };

  useEffect(() => {
    const handler = () => { refetch(); };
    on("session:status", handler);
    return () => { off("session:status", handler); };
  }, [on, off, refetch]);

  const handleDelete = useCallback(async (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    const result = await accountsApi.delete(accountId);
    if (result?.success) {
      refetch();
      if (selected?.id === accountId) setSelected(null);
    }
  }, [refetch, selected]);

  const handlePause = useCallback(async (e: React.MouseEvent, accountId: string, isPaused: boolean) => {
    e.stopPropagation();
    await accountsApi.update(accountId, { isPaused });
    refetch();
  }, [refetch]);

  const handleReconnect = useCallback(async (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    await sessionsApi.reconnect(accountId);
    refetch();
  }, [refetch]);

  const [tab, setTab] = useState<"active" | "history">("active");

  return (
    <div className="space-y-4">
      {/* Data source + tabs */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className={`dot ${isLive ? "dot-ok" : "dot-off"}`} />
          <span className="font-mono text-[10px] text-muted-foreground">
            {isLive ? "ao vivo" : "offline"}
          </span>
        </div>
        <div className="flex gap-0 border border-border rounded overflow-hidden">
          <button onClick={() => setTab("active")}
            className={`font-mono text-[11px] px-3 py-1 transition-colors ${tab === "active" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            ativas
          </button>
          <button onClick={() => setTab("history")}
            className={`font-mono text-[11px] px-3 py-1 border-l border-border transition-colors ${tab === "history" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            historico
          </button>
        </div>
        {loading && <span className="font-mono text-[10px] text-muted-foreground animate-pulse">carregando...</span>}
      </div>

      {tab === "history" ? (
        <HistoryTab accounts={accounts} />
      ) : (<>
      {/* Filter + actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {filters.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`font-mono text-xs px-2.5 py-1 rounded transition-colors ${filter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {filterLabels[f] ?? f} <span className="text-[10px] text-muted-foreground">{counts[f]}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setConnectOpen(true)}
          className="font-mono text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
          <Plus size={11} />[conectar novo dispositivo]
        </button>
      </div>

      {/* Table */}
      <div className="flex gap-0">
        <div className="flex-1 min-w-0">
          <div className="section-line">contas &mdash; {filtered.length} exibidas</div>
          <div className="border border-border rounded overflow-hidden">
            <div className="term-row text-muted-foreground text-[10px] uppercase tracking-widest bg-secondary/50">
              <span className="w-5" /><span className="w-40">telefone</span><span className="w-16">status</span>
              <span className="w-14 text-right">dia</span><span className="w-16 text-right">enviados</span>
              <span className="w-16 text-right">taxa</span><span className="flex-1 text-right">acoes</span>
            </div>
            {filtered.map((a) => (
              <div key={a.id} onClick={() => setSelected(selected?.id === a.id ? null : a)}
                className={`term-row cursor-pointer ${selected?.id === a.id ? "!bg-primary/5" : ""}`}>
                <div className={`dot ${dotMap[a.status]}`} />
                <span className="w-40 font-mono text-xs truncate">{a.name || a.phone}</span>
                <span className={`w-16 font-mono text-[10px] ${a.status === "banned" ? "text-red-400" : "text-muted-foreground"}`}>{statusLabels[a.status]}</span>
                <span className="w-14 text-right font-mono text-xs text-muted-foreground">{a.day}/14</span>
                <span className="w-16 text-right font-mono text-xs">{a.sentToday}</span>
                <span className={`w-16 text-right font-mono text-xs ${a.replyRate < 30 ? "text-red-400" : a.replyRate < 50 ? "text-yellow-400" : ""}`}>{a.replyRate}%</span>
                <span className="flex-1 flex justify-end gap-1.5">
                  <button onClick={(e) => handleReconnect(e, a.id)} className="text-muted-foreground hover:text-foreground transition-colors" title="Reconectar"><RefreshCw size={11} strokeWidth={1.5} /></button>
                  <button onClick={(e) => handlePause(e, a.id, a.status !== "paused")} className="text-muted-foreground hover:text-yellow-400 transition-colors" title="Pausar"><Pause size={11} strokeWidth={1.5} /></button>
                  <button onClick={(e) => handleDelete(e, a.id)} className="text-muted-foreground hover:text-red-400 transition-colors" title="Remover"><Trash2 size={11} strokeWidth={1.5} /></button>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Side panel */}
        {selected && (
          <div className="w-80 border-l border-border bg-background shrink-0 overflow-y-auto fixed right-0 top-10 bottom-0 z-20">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/50">
              <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">detalhes</span>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
            </div>
            <div className="p-3 space-y-3">
              <div><div className="term-label">telefone</div><div className="font-mono text-sm mt-0.5">{selected.phone}</div></div>
              <NameEditor accountId={selected.id} currentName={selected.name} onSaved={refetch} />
              <div className="flex gap-4">
                <div><div className="term-label">status</div><div className="flex items-center gap-1.5 mt-0.5"><div className={`dot ${dotMap[selected.status]}`} /><span className="font-mono text-xs">{statusLabels[selected.status]}</span></div></div>
                <div><div className="term-label">sessao</div><div className="font-mono text-xs mt-0.5 text-muted-foreground">{selected.session}</div></div>
              </div>
              <div className="border-b border-border" />
              <div className="grid grid-cols-2 gap-3">
                <div><div className="term-label">dia aquecimento</div><div className="font-mono text-sm mt-0.5">{selected.day}/14</div></div>
                <div><div className="term-label">tempo ativo</div><div className="font-mono text-sm mt-0.5">{selected.uptime}</div></div>
                <div><div className="term-label">enviados hoje</div><div className="font-mono text-sm mt-0.5">{selected.sentToday}</div></div>
                <div><div className="term-label">taxa resposta</div><div className={`font-mono text-sm mt-0.5 ${selected.replyRate < 30 ? "text-red-400" : selected.replyRate < 50 ? "text-yellow-400" : ""}`}>{selected.replyRate}%</div></div>
                <div><div className="term-label">capacidade</div><div className="font-mono text-sm mt-0.5">{selected.capacity}/{selected.maxCapacity}</div></div>
                <div><div className="term-label">proxy</div><div className="font-mono text-xs mt-0.5 text-muted-foreground">{selected.proxy}</div></div>
              </div>
              <div className="border-b border-border" />
              <div><div className="term-label">progresso aquecimento</div>
                <div className="mt-1.5"><div className="h-0.5 bg-border rounded-full"><div className="h-full bg-primary rounded-full" style={{ width: `${(selected.day / 14) * 100}%` }} /></div>
                <div className="font-mono text-[10px] text-muted-foreground mt-1">{Math.round((selected.day / 14) * 100)}%</div></div>
              </div>
              <div className="border-b border-border" />
              <div className="space-y-1.5">
                <div className="term-label">acoes</div>
                <ActionBtn icon={Power} label="reconectar sessao" onClick={async () => {
                  await sessionsApi.reconnect(selected.id);
                  refetch();
                }} />
                <ActionBtn icon={QrCode} label="novo QR code" onClick={async () => {
                  await sessionsApi.reconnect(selected.id);
                  refetch();
                }} />
                <ActionBtn icon={Pause} label="desconectar" color="yellow" onClick={async () => {
                  await sessionsApi.disconnect(selected.id);
                  refetch();
                }} />
                <ActionBtn icon={Trash2} label="remover conta" color="red" onClick={async () => {
                  const id = selected.id;
                  setSelected(null);
                  await accountsApi.delete(id);
                  setTimeout(() => refetch(), 300);
                }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connect new device modal */}
      {connectOpen && <ConnectModal onClose={() => { setConnectOpen(false); refetch(); }} />}
      </>)}
    </div>
  );
}

function ActionBtn({ icon: Icon, label, color, onClick }: { icon: any; label: string; color?: "red" | "yellow"; onClick: () => void }) {
  const [busy, setBusy] = useState(false);
  const handleClick = async () => {
    setBusy(true);
    try { await onClick(); } finally { setBusy(false); }
  };
  const cls = color === "red"
    ? "hover:bg-red-500/10 hover:border-red-500/20 text-red-400"
    : color === "yellow"
    ? "hover:bg-yellow-500/10 hover:border-yellow-500/20 text-yellow-400"
    : "hover:bg-primary/5 hover:border-primary/20";
  return (
    <button type="button" disabled={busy} onClick={handleClick}
      className={`flex items-center gap-2 w-full px-3 py-2 font-mono text-xs rounded border border-border transition-colors cursor-pointer disabled:opacity-50 ${cls}`}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} className={!color ? "text-primary" : ""} />}
      {busy ? `${label}...` : label}
    </button>
  );
}

function NameEditor({ accountId, currentName, onSaved }: { accountId: string; currentName: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await accountsApi.update(accountId, { displayName: name.trim() } as any);
    setSaving(false);
    setEditing(false);
    onSaved();
  };

  return (
    <div>
      <div className="term-label">apelido</div>
      {editing ? (
        <div className="flex gap-1 mt-0.5">
          <input value={name} onChange={e => setName(e.target.value)} autoFocus
            placeholder="ex: Conta Aquecida 1"
            className="flex-1 bg-secondary font-mono text-xs px-2 py-1 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary" />
          <button onClick={save} disabled={saving}
            className="font-mono text-[10px] px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-50">
            {saving ? "..." : "ok"}
          </button>
          <button onClick={() => { setEditing(false); setName(currentName); }}
            className="font-mono text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground">
            x
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-xs">{currentName || <span className="text-muted-foreground">sem apelido</span>}</span>
          <button onClick={() => setEditing(true)} className="font-mono text-[10px] text-primary hover:text-primary/80">[editar]</button>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ accounts }: { accounts: Account[] }) {
  const all = [...accounts].sort((a, b) => {
    const order: Record<Status, number> = { banned: 0, paused: 1, warming: 2, connected: 3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  return (
    <div>
      <div className="section-line">historico &mdash; {all.length} numeros registrados</div>
      {all.length === 0 ? (
        <div className="border border-border rounded p-8 text-center font-mono text-xs text-muted-foreground">
          nenhum numero registrado ainda
        </div>
      ) : (
        <div className="border border-border rounded overflow-hidden">
          <div className="term-row text-muted-foreground text-[10px] uppercase tracking-widest bg-secondary/50">
            <span className="w-5" />
            <span className="w-44">telefone</span>
            <span className="w-20">status</span>
            <span className="w-16 text-right">aquecimento</span>
            <span className="w-20 text-right">total enviado</span>
            <span className="w-16 text-right">taxa</span>
            <span className="flex-1 text-right">tempo ativo</span>
          </div>
          {all.map((a) => (
            <div key={a.id} className="term-row">
              <div className={`dot ${dotMap[a.status]}`} />
              <span className="w-44 font-mono text-xs">{a.phone}</span>
              <span className={`w-20 font-mono text-[10px] ${a.status === "banned" ? "text-red-400" : a.status === "paused" ? "text-yellow-400" : a.status === "connected" ? "text-primary" : "text-muted-foreground"}`}>
                {statusLabels[a.status]}
              </span>
              <span className="w-16 text-right font-mono text-xs text-muted-foreground">
                dia {a.day}/14
              </span>
              <span className="w-20 text-right font-mono text-xs">{a.sentToday}</span>
              <span className={`w-16 text-right font-mono text-xs ${a.replyRate < 30 ? "text-red-400" : a.replyRate < 50 ? "text-yellow-400" : ""}`}>
                {a.replyRate}%
              </span>
              <span className="flex-1 text-right font-mono text-[10px] text-muted-foreground">{a.uptime}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      {all.length > 0 && (
        <div className="grid grid-cols-4 gap-px bg-border rounded overflow-hidden mt-4">
          <div className="bg-background px-3 py-2">
            <div className="term-label">total</div>
            <div className="font-mono text-sm font-medium">{all.length}</div>
          </div>
          <div className="bg-background px-3 py-2">
            <div className="term-label">ativas</div>
            <div className="font-mono text-sm font-medium text-primary">{all.filter(a => a.status === "connected" || a.status === "warming").length}</div>
          </div>
          <div className="bg-background px-3 py-2">
            <div className="term-label">banidas</div>
            <div className="font-mono text-sm font-medium text-red-400">{all.filter(a => a.status === "banned").length}</div>
          </div>
          <div className="bg-background px-3 py-2">
            <div className="term-label">taxa media</div>
            <div className="font-mono text-sm font-medium">{all.length > 0 ? Math.round(all.reduce((s, a) => s + a.replyRate, 0) / all.length) : 0}%</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<ConnectStep>("idle");
  const [phone, setPhone] = useState("");
  const [timer, setTimer] = useState(120);
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrCount, setQrCount] = useState(0);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { emit, on, off } = useSocket();
  const stepRef = useRef(step);
  const accountIdRef = useRef(accountId);
  stepRef.current = step;
  accountIdRef.current = accountId;

  // Countdown timer
  useEffect(() => {
    if (step !== "waiting" || timer <= 0) return;
    const t = setTimeout(() => setTimer(t => t - 1), 1000);
    return () => clearTimeout(t);
  }, [step, timer]);

  useEffect(() => {
    if (step === "waiting" && timer === 0) setStep("error");
  }, [step, timer]);

  // Listen for QR code and connection status - stable handler via refs
  useEffect(() => {
    const handleQr = (payload: any) => {
      const s = stepRef.current;
      const aid = accountIdRef.current;
      if (payload?.qr && (s === "generating" || s === "waiting")) {
        if (!aid || payload.accountId === aid) {
          setQrData(payload.qr);
          setQrCount(c => c + 1);
          setTimer(120);
          if (s === "generating") {
            setStep("waiting");
          }
        }
      }
    };

    const handlePairingCode = (payload: any) => {
      const aid = accountIdRef.current;
      if (payload?.code && (!aid || payload.accountId === aid)) {
        setPairingCode(payload.code);
      }
    };

    const handleStatus = (payload: any) => {
      const aid = accountIdRef.current;
      if (!aid || payload?.accountId !== aid) return;

      if (payload?.status === "CONNECTED") {
        setStep("success");
      } else if (payload?.status === "DISCONNECTED" && payload?.reason === "qr_expired") {
        // QR expired without scan - show error so user can retry
        setError("QR code expirou. Tente novamente.");
        setStep("error");
      }
    };

    on("session:qr", handleQr);
    on("session:pairing-code", handlePairingCode);
    on("session:status", handleStatus);

    return () => {
      off("session:qr", handleQr);
      off("session:pairing-code", handlePairingCode);
      off("session:status", handleStatus);
    };
  }, [on, off]);

  const startConnect = async () => {
    if (!phone.trim()) return;
    setError("");
    setStep("generating");
    setQrData(null);
    setPairingCode(null);
    setQrCount(0);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const token = localStorage.getItem("maturador_token");

    try {
      // Call backend to create account + start Baileys session
      // The session will emit QR codes via Socket.IO as they are generated
      const res = await fetch(`${apiUrl}/api/sessions/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phoneNumber: phone }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erro ao conectar");
        setStep("error");
        return;
      }

      setAccountId(data.accountId);

      // NOTE: We do NOT request a pairing code here anymore.
      // Pairing code and QR are mutually exclusive in Baileys.
      // The QR will arrive via the session:qr socket event.
      // If you want pairing code mode, that needs a separate flow
      // that creates the session WITHOUT QR (printQRInTerminal: false
      // and requestPairingCode before QR is emitted).

    } catch {
      setError("Servidor indisponivel");
      setStep("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
      <div className="relative border border-border bg-background z-10 w-full max-w-lg rounded" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Smartphone size={14} className="text-primary" />
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">conectar whatsapp</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>

        <div className="p-4">
          {/* STEP 1: Enter phone */}
          {step === "idle" && (
            <div className="space-y-4">
              <div className="section-line">passo 1 &mdash; inserir numero de telefone</div>
              <div className="space-y-2">
                <div className="term-label">numero de telefone (com codigo do pais)</div>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-9999"
                  className="w-full bg-secondary font-mono text-sm px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50" autoFocus />
              </div>
              <button onClick={startConnect} className="w-full font-mono text-xs bg-primary text-primary-foreground py-2.5 rounded-sm hover:bg-primary/90 transition-colors">
                [conectar dispositivo]
              </button>
            </div>
          )}

          {/* STEP 2: Generating session */}
          {step === "generating" && (
            <div className="py-12 text-center space-y-3">
              <Loader2 size={20} className="text-primary mx-auto animate-spin" />
              <div className="font-mono text-xs text-muted-foreground">inicializando sessao baileys...</div>
              <div className="font-mono text-[10px] text-muted-foreground">gerando chaves de criptografia, aguardando QR</div>
            </div>
          )}

          {/* STEP 3: QR code + pairing code */}
          {step === "waiting" && (
            <div className="space-y-4">
              <div className="section-line">passo 2 &mdash; escaneie o QR ou insira o codigo</div>
              <div className="flex gap-5">
                {/* QR Code */}
                <div className="w-52 h-52 border border-border rounded bg-white flex items-center justify-center shrink-0 p-2">
                  {qrData ? (
                    <QRCodeSVG value={qrData} size={180} bgColor="#ffffff" fgColor="#000000" level="M" />
                  ) : (
                    <div className="text-center">
                      <Loader2 size={24} className="text-black/20 mx-auto animate-spin" />
                      <div className="font-mono text-[9px] text-black/30 mt-2">carregando QR...</div>
                    </div>
                  )}
                </div>

                {/* Right side info */}
                <div className="flex-1 space-y-3">
                  {/* Pairing code */}
                  <div>
                    <div className="term-label">codigo de pareamento (alternativo)</div>
                    <div className="flex items-center gap-2 mt-1">
                      {pairingCode ? (
                        <>
                          <span className="font-mono text-xl font-semibold tracking-[0.2em] text-primary">{pairingCode}</span>
                          <button onClick={() => navigator.clipboard.writeText(pairingCode)} className="text-muted-foreground hover:text-foreground" title="Copiar"><Copy size={12} /></button>
                        </>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground animate-pulse">gerando...</span>
                      )}
                    </div>
                  </div>

                  {/* Instructions */}
                  <div className="space-y-1">
                    <div className="term-label">como vincular</div>
                    <div className="font-mono text-[11px] text-muted-foreground space-y-0.5">
                      <div>1. abra o whatsapp</div>
                      <div>2. configuracoes &gt; dispositivos vinculados</div>
                      <div>3. toque em &quot;vincular dispositivo&quot;</div>
                      <div>4. escaneie o QR ou insira o codigo acima</div>
                    </div>
                  </div>

                  {/* Timer */}
                  <div className="flex items-center gap-2">
                    <div className="dot dot-warn animate-pulse" />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, "0")}
                    </span>
                  </div>

                  {/* Phone */}
                  <div>
                    <div className="term-label">dispositivo</div>
                    <div className="font-mono text-xs text-muted-foreground mt-0.5">{phone}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Connecting */}
          {step === "connecting" && (
            <div className="py-12 text-center space-y-3">
              <Wifi size={20} className="text-primary mx-auto animate-pulse" />
              <div className="font-mono text-xs text-primary">estabelecendo conexao...</div>
              <div className="font-mono text-[10px] text-muted-foreground">sincronizando dados da sessao</div>
            </div>
          )}

          {/* Success */}
          {step === "success" && (
            <div className="py-10 text-center space-y-4">
              <CheckCircle2 size={28} className="text-emerald-400 mx-auto" />
              <div>
                <div className="font-mono text-sm text-foreground">dispositivo conectado</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">{phone}</div>
              </div>
              <div className="border border-border rounded p-3 text-left space-y-1.5 max-w-xs mx-auto">
                <div className="flex items-center gap-2"><div className="dot dot-ok" /><span className="font-mono text-[11px]">sessao estabelecida</span></div>
                <div className="flex items-center gap-2"><div className="dot dot-ok" /><span className="font-mono text-[11px]">aquecimento inicializado (dia 1/14)</span></div>
                <div className="flex items-center gap-2"><div className="dot dot-ok" /><span className="font-mono text-[11px]">anti-ban configurado</span></div>
              </div>
              <button onClick={onClose} className="font-mono text-xs bg-primary text-primary-foreground px-6 py-2 rounded-sm hover:bg-primary/90 transition-colors">[concluido]</button>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <div className="py-10 text-center space-y-4">
              <WifiOff size={28} className="text-red-400 mx-auto" />
              <div>
                <div className="font-mono text-sm text-red-400">{error || "tempo de conexao esgotado"}</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">QR expirou ou sessao falhou.</div>
              </div>
              <button onClick={() => { setStep("idle"); setTimer(120); setError(""); }} className="font-mono text-xs text-primary hover:text-primary/80 transition-colors">[tentar novamente]</button>
            </div>
          )}
        </div>

        {/* Footer status */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-2">
          <div className={`dot ${step === "success" ? "dot-ok" : step === "error" ? "dot-err" : step === "waiting" || step === "connecting" || step === "generating" ? "dot-warn" : "dot-off"}`} />
          <span className="font-mono text-[10px] text-muted-foreground">
            {step === "idle" && "pronto"}
            {step === "generating" && "inicializando sessao..."}
            {step === "waiting" && (qrData ? `QR #${qrCount} - escaneie agora` : "aguardando QR...")}
            {step === "connecting" && "conectando..."}
            {step === "success" && "conectado"}
            {step === "error" && "falhou"}
          </span>
        </div>
      </div>
    </div>
  );
}
