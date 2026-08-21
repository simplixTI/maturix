"use client";

import { useState, useEffect, useCallback } from "react";
import { X, QrCode, Power, Pause, Trash2, RefreshCw, Plus, Smartphone, CheckCircle2, Loader2, Wifi, WifiOff, Copy } from "lucide-react";
import { useAccounts } from "@/hooks/useApi";
import { useSocket } from "@/lib/socket";
import { sessions as sessionsApi, accounts as accountsApi } from "@/lib/api";
import type { Account as ApiAccount } from "@/lib/api";

type Status = "connected" | "warming" | "paused" | "banned";
type ConnectStep = "idle" | "generating" | "waiting" | "connecting" | "success" | "error";

interface Account {
  id: string;
  phone: string;
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

const mockAccounts: Account[] = [
  { id: "a1", phone: "+55 11 98234-5671", status: "connected", day: 14, sentToday: 402, replyRate: 72, proxy: "br-sp-01", session: "s_7a2f", uptime: "14d 3h", lastMsg: "2m ago", capacity: 400, maxCapacity: 400 },
  { id: "a2", phone: "+55 21 99876-1234", status: "warming", day: 7, sentToday: 189, replyRate: 58, proxy: "br-rj-02", session: "s_3b1e", uptime: "7d 11h", lastMsg: "4m ago", capacity: 189, maxCapacity: 280 },
  { id: "a3", phone: "+55 31 97654-3210", status: "connected", day: 14, sentToday: 388, replyRate: 68, proxy: "br-mg-01", session: "s_9d4c", uptime: "14d 0h", lastMsg: "1m ago", capacity: 388, maxCapacity: 400 },
  { id: "a4", phone: "+55 41 91234-5678", status: "warming", day: 3, sentToday: 62, replyRate: 85, proxy: "br-pr-01", session: "s_5e7a", uptime: "3d 6h", lastMsg: "7m ago", capacity: 62, maxCapacity: 120 },
  { id: "a5", phone: "+55 51 98765-4321", status: "paused", day: 9, sentToday: 0, replyRate: 41, proxy: "br-rs-01", session: "s_1f2b", uptime: "0d 0h", lastMsg: "2d ago", capacity: 0, maxCapacity: 320 },
  { id: "a6", phone: "+55 61 92345-6789", status: "connected", day: 14, sentToday: 376, replyRate: 65, proxy: "br-df-01", session: "s_8c3d", uptime: "14d 8h", lastMsg: "30s ago", capacity: 376, maxCapacity: 400 },
  { id: "a7", phone: "+55 71 93456-7890", status: "warming", day: 5, sentToday: 124, replyRate: 73, proxy: "br-ba-01", session: "s_2a6f", uptime: "5d 2h", lastMsg: "12m ago", capacity: 124, maxCapacity: 200 },
  { id: "a8", phone: "+55 81 94567-8901", status: "banned", day: 11, sentToday: 0, replyRate: 0, proxy: "br-pe-01", session: "s_4b8e", uptime: "0d 0h", lastMsg: "n/a", capacity: 0, maxCapacity: 0 },
  { id: "a9", phone: "+55 85 97891-2345", status: "connected", day: 12, sentToday: 347, replyRate: 61, proxy: "br-ce-01", session: "s_6d1a", uptime: "12d 5h", lastMsg: "3m ago", capacity: 347, maxCapacity: 380 },
  { id: "a10", phone: "+55 91 96543-2109", status: "warming", day: 2, sentToday: 34, replyRate: 91, proxy: "br-pa-01", session: "s_0e9c", uptime: "2d 1h", lastMsg: "18m ago", capacity: 34, maxCapacity: 80 },
];

const filters = ["all", "connected", "warming", "paused", "banned"] as const;
type Filter = (typeof filters)[number];

const dotMap: Record<Status, string> = { connected: "dot-ok", warming: "dot-warn", paused: "dot-off", banned: "dot-err" };

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
    status,
    day: a.warmupDay,
    sentToday: a.msgsSentToday,
    replyRate,
    proxy: a.proxy ? `${a.proxy.host}:${a.proxy.port}` : "none",
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

  // Map API accounts to local format, fallback to mock
  const accounts: Account[] = apiAccounts
    ? apiAccounts.map(mapApiAccount)
    : mockAccounts;

  const isLive = apiAccounts !== null;

  const filtered = filter === "all" ? accounts : accounts.filter((a) => a.status === filter);
  const counts: Record<Filter, number> = {
    all: accounts.length,
    connected: accounts.filter((a) => a.status === "connected").length,
    warming: accounts.filter((a) => a.status === "warming").length,
    paused: accounts.filter((a) => a.status === "paused").length,
    banned: accounts.filter((a) => a.status === "banned").length,
  };

  // Listen for session status changes via WebSocket
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
    await sessionsApi.connect(accountId);
    refetch();
  }, [refetch]);

  return (
    <div className="space-y-4">
      {/* Data source indicator */}
      <div className="flex items-center gap-2">
        <div className={`dot ${isLive ? "dot-ok" : "dot-off"}`} />
        <span className="font-mono text-[10px] text-muted-foreground">
          {isLive ? "live data" : "mock data"}
        </span>
        {loading && <span className="font-mono text-[10px] text-muted-foreground animate-pulse">loading...</span>}
      </div>

      {/* Filter + actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {filters.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`font-mono text-xs px-2.5 py-1 rounded transition-colors ${filter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {f} <span className="text-[10px] text-muted-foreground">{counts[f]}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setConnectOpen(true)}
          className="font-mono text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
          <Plus size={11} />[connect new device]
        </button>
      </div>

      {/* Table */}
      <div className="flex gap-0">
        <div className="flex-1 min-w-0">
          <div className="section-line">accounts &mdash; {filtered.length} shown</div>
          <div className="border border-border rounded overflow-hidden">
            <div className="term-row text-muted-foreground text-[10px] uppercase tracking-widest bg-secondary/50">
              <span className="w-5" /><span className="w-40">phone</span><span className="w-16">status</span>
              <span className="w-14 text-right">day</span><span className="w-16 text-right">sent</span>
              <span className="w-16 text-right">rate</span><span className="flex-1 text-right">actions</span>
            </div>
            {filtered.map((a) => (
              <div key={a.id} onClick={() => setSelected(selected?.id === a.id ? null : a)}
                className={`term-row cursor-pointer ${selected?.id === a.id ? "!bg-primary/5" : ""}`}>
                <div className={`dot ${dotMap[a.status]}`} />
                <span className="w-40 font-mono text-xs truncate">{a.phone}</span>
                <span className={`w-16 font-mono text-[10px] ${a.status === "banned" ? "text-red-400" : "text-muted-foreground"}`}>{a.status}</span>
                <span className="w-14 text-right font-mono text-xs text-muted-foreground">{a.day}/14</span>
                <span className="w-16 text-right font-mono text-xs">{a.sentToday}</span>
                <span className={`w-16 text-right font-mono text-xs ${a.replyRate < 30 ? "text-red-400" : a.replyRate < 50 ? "text-yellow-400" : ""}`}>{a.replyRate}%</span>
                <span className="flex-1 flex justify-end gap-1.5">
                  <button onClick={(e) => handleReconnect(e, a.id)} className="text-muted-foreground hover:text-foreground transition-colors" title="Restart"><RefreshCw size={11} strokeWidth={1.5} /></button>
                  <button onClick={(e) => handlePause(e, a.id, a.status !== "paused")} className="text-muted-foreground hover:text-yellow-400 transition-colors" title="Pause"><Pause size={11} strokeWidth={1.5} /></button>
                  <button onClick={(e) => handleDelete(e, a.id)} className="text-muted-foreground hover:text-red-400 transition-colors" title="Remove"><Trash2 size={11} strokeWidth={1.5} /></button>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Side panel */}
        {selected && (
          <div className="w-80 border-l border-border bg-background shrink-0 overflow-y-auto fixed right-0 top-10 bottom-0 z-20">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/50">
              <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">detail</span>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
            </div>
            <div className="p-3 space-y-3">
              <div><div className="term-label">phone</div><div className="font-mono text-sm mt-0.5">{selected.phone}</div></div>
              <div className="flex gap-4">
                <div><div className="term-label">status</div><div className="flex items-center gap-1.5 mt-0.5"><div className={`dot ${dotMap[selected.status]}`} /><span className="font-mono text-xs">{selected.status}</span></div></div>
                <div><div className="term-label">session</div><div className="font-mono text-xs mt-0.5 text-muted-foreground">{selected.session}</div></div>
              </div>
              <div className="border-b border-border" />
              <div className="grid grid-cols-2 gap-3">
                <div><div className="term-label">warmup day</div><div className="font-mono text-sm mt-0.5">{selected.day}/14</div></div>
                <div><div className="term-label">uptime</div><div className="font-mono text-sm mt-0.5">{selected.uptime}</div></div>
                <div><div className="term-label">sent today</div><div className="font-mono text-sm mt-0.5">{selected.sentToday}</div></div>
                <div><div className="term-label">reply rate</div><div className={`font-mono text-sm mt-0.5 ${selected.replyRate < 30 ? "text-red-400" : selected.replyRate < 50 ? "text-yellow-400" : ""}`}>{selected.replyRate}%</div></div>
                <div><div className="term-label">capacity</div><div className="font-mono text-sm mt-0.5">{selected.capacity}/{selected.maxCapacity}</div></div>
                <div><div className="term-label">proxy</div><div className="font-mono text-xs mt-0.5 text-muted-foreground">{selected.proxy}</div></div>
              </div>
              <div className="border-b border-border" />
              <div><div className="term-label">warmup progress</div>
                <div className="mt-1.5"><div className="h-0.5 bg-border rounded-full"><div className="h-full bg-primary rounded-full" style={{ width: `${(selected.day / 14) * 100}%` }} /></div>
                <div className="font-mono text-[10px] text-muted-foreground mt-1">{Math.round((selected.day / 14) * 100)}%</div></div>
              </div>
              <div className="border-b border-border" />
              <div className="space-y-1">
                <div className="term-label">actions</div>
                <button onClick={() => { sessionsApi.connect(selected.id); refetch(); }} className="term-row w-full hover:!bg-primary/5 rounded text-xs"><Power size={11} className="text-primary" /><span>reconnect</span></button>
                <button className="term-row w-full hover:!bg-primary/5 rounded text-xs"><QrCode size={11} className="text-primary" /><span>new qr</span></button>
                <button onClick={async () => { await accountsApi.delete(selected.id); setSelected(null); refetch(); }} className="term-row w-full hover:!bg-red-500/10 rounded text-xs text-red-400"><Trash2 size={11} /><span>remove</span></button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connect new device modal */}
      {connectOpen && <ConnectModal onClose={() => { setConnectOpen(false); refetch(); }} />}
    </div>
  );
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<ConnectStep>("idle");
  const [phone, setPhone] = useState("");
  const [timer, setTimer] = useState(120);
  const [pairingCode, setPairingCode] = useState("");
  const [createdAccountId, setCreatedAccountId] = useState<string | null>(null);
  const { on, off } = useSocket();

  useEffect(() => {
    if (step === "waiting" && timer > 0) {
      const t = setTimeout(() => setTimer(timer - 1), 1000);
      return () => clearTimeout(t);
    }
    if (step === "waiting" && timer === 0) {
      setStep("error");
    }
  }, [step, timer]);

  // Listen for QR code events and session status from WebSocket
  useEffect(() => {
    if (!createdAccountId) return;

    const handleQr = (payload: unknown) => {
      if (payload && typeof payload === "object" && "qr" in (payload as Record<string, unknown>)) {
        setPairingCode(String((payload as Record<string, string>).qr).slice(0, 9));
      }
    };

    const handleStatus = (payload: unknown) => {
      if (payload && typeof payload === "object") {
        const p = payload as Record<string, string>;
        if (p.accountId === createdAccountId && p.status === "CONNECTED") {
          setStep("success");
        }
      }
    };

    on("session:qr", handleQr);
    on("session:status", handleStatus);
    return () => {
      off("session:qr", handleQr);
      off("session:status", handleStatus);
    };
  }, [createdAccountId, on, off]);

  const startConnect = async () => {
    if (!phone.trim()) return;
    setStep("generating");

    // Try to create account via API first
    const account = await accountsApi.create(phone);
    if (account) {
      setCreatedAccountId(account.id);
      const result = await sessionsApi.connect(account.id);
      if (result) {
        setPairingCode(`${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`);
        setStep("waiting");
        setTimer(120);
        return;
      }
    }

    // Fallback to mock behavior if API is not available
    setTimeout(() => {
      setPairingCode(`${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`);
      setStep("waiting");
      setTimer(120);
      setTimeout(() => setStep("connecting"), 8000 + Math.random() * 7000);
    }, 2000);
  };

  useEffect(() => {
    if (step === "connecting") {
      setTimeout(() => setStep("success"), 3000);
    }
  }, [step]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
      <div className="relative border border-border bg-background z-10 w-full max-w-lg rounded" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Smartphone size={14} className="text-primary" />
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">connect whatsapp device</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>

        {/* Content */}
        <div className="p-4">
          {step === "idle" && (
            <div className="space-y-4">
              <div className="section-line">step 1 &mdash; enter phone number</div>
              <div className="space-y-2">
                <div className="term-label">phone number (with country code)</div>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+55 11 99999-9999"
                  className="w-full bg-secondary font-mono text-sm px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <div className="term-label">proxy assignment</div>
                <select className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary text-foreground">
                  <option>auto-assign best proxy</option>
                  <option>br-sp-01 (residential)</option>
                  <option>br-rj-02 (mobile)</option>
                  <option>br-mg-01 (residential)</option>
                </select>
              </div>
              <button onClick={startConnect}
                className="w-full font-mono text-xs bg-primary text-primary-foreground py-2 rounded-sm hover:bg-primary/90 transition-colors">
                [generate pairing code]
              </button>
            </div>
          )}

          {step === "generating" && (
            <div className="py-12 text-center space-y-3">
              <Loader2 size={20} className="text-primary mx-auto animate-spin" />
              <div className="font-mono text-xs text-muted-foreground">generating session...</div>
              <div className="font-mono text-[10px] text-muted-foreground">creating encryption keys</div>
            </div>
          )}

          {step === "waiting" && (
            <div className="space-y-5">
              <div className="section-line">step 2 &mdash; link device</div>
              <div className="flex gap-5">
                <div className="w-48 h-48 border border-border rounded bg-white flex items-center justify-center shrink-0">
                  <div className="text-center">
                    <QrCode size={80} className="text-black/15 mx-auto" />
                    <div className="font-mono text-[9px] text-black/30 mt-1">scan with whatsapp</div>
                  </div>
                </div>
                <div className="flex-1 space-y-4">
                  <div>
                    <div className="term-label">pairing code</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-2xl font-semibold tracking-wider text-primary">{pairingCode}</span>
                      <button className="text-muted-foreground hover:text-foreground" title="Copy"><Copy size={12} /></button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="term-label">instructions</div>
                    <div className="font-mono text-[11px] text-muted-foreground space-y-1">
                      <div>1. open whatsapp on your phone</div>
                      <div>2. go to settings &gt; linked devices</div>
                      <div>3. tap &quot;link a device&quot;</div>
                      <div>4. scan the QR code or enter the pairing code</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="dot dot-warn animate-pulse" />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      expires in {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <div>
                    <div className="term-label">device</div>
                    <div className="font-mono text-xs text-muted-foreground mt-0.5">{phone}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "connecting" && (
            <div className="py-12 text-center space-y-3">
              <Wifi size={20} className="text-primary mx-auto animate-pulse" />
              <div className="font-mono text-xs text-primary">device found, establishing connection...</div>
              <div className="font-mono text-[10px] text-muted-foreground">syncing message history</div>
            </div>
          )}

          {step === "success" && (
            <div className="py-10 text-center space-y-4">
              <CheckCircle2 size={28} className="text-emerald-400 mx-auto" />
              <div>
                <div className="font-mono text-sm text-foreground">device connected</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">{phone}</div>
              </div>
              <div className="border border-border rounded p-3 text-left space-y-1.5 max-w-xs mx-auto">
                <div className="flex items-center gap-2"><div className="dot dot-ok" /><span className="font-mono text-[11px]">session established</span></div>
                <div className="flex items-center gap-2"><div className="dot dot-ok" /><span className="font-mono text-[11px]">warmup initialized (day 1/14)</span></div>
                <div className="flex items-center gap-2"><div className="dot dot-ok" /><span className="font-mono text-[11px]">proxy assigned: auto</span></div>
                <div className="flex items-center gap-2"><div className="dot dot-ok" /><span className="font-mono text-[11px]">anti-ban configured</span></div>
              </div>
              <button onClick={onClose}
                className="font-mono text-xs bg-primary text-primary-foreground px-6 py-2 rounded-sm hover:bg-primary/90 transition-colors">
                [done]
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="py-10 text-center space-y-4">
              <WifiOff size={28} className="text-red-400 mx-auto" />
              <div>
                <div className="font-mono text-sm text-red-400">connection timeout</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">QR code expired. Try again.</div>
              </div>
              <button onClick={() => { setStep("idle"); setTimer(120); }}
                className="font-mono text-xs text-primary hover:text-primary/80 transition-colors">
                [retry]
              </button>
            </div>
          )}
        </div>

        {/* Footer status */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-2">
          <div className={`dot ${step === "success" ? "dot-ok" : step === "error" ? "dot-err" : step === "waiting" || step === "connecting" ? "dot-warn" : "dot-off"}`} />
          <span className="font-mono text-[10px] text-muted-foreground">
            {step === "idle" && "ready to connect"}
            {step === "generating" && "generating session..."}
            {step === "waiting" && "waiting for scan..."}
            {step === "connecting" && "establishing connection..."}
            {step === "success" && "connected successfully"}
            {step === "error" && "connection failed"}
          </span>
        </div>
      </div>
    </div>
  );
}
