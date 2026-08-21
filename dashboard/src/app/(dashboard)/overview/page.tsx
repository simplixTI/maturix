"use client";

import { useState, useEffect, useCallback } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useOverview, useAlerts, useMetricsToday } from "@/hooks/useApi";
import { useSocket } from "@/lib/socket";

function makeChart() {
  return Array.from({ length: 48 }, (_, i) => ({
    t: i,
    v: Math.floor(40 + Math.random() * 80 + Math.sin(i / 6) * 30),
  }));
}

const dotClass: Record<string, string> = { on: "dot-ok", wrm: "dot-warn", off: "dot-off", ban: "dot-err" };
const lvlDot: Record<string, string> = { err: "dot-err", warn: "dot-warn", ok: "dot-ok", info: "dot-off" };

function statusToShort(s: string): string {
  if (s === "CONNECTED") return "on";
  if (s === "WARMING" || s === "CONNECTING") return "wrm";
  if (s === "BANNED") return "ban";
  return "off";
}

function severityToLvl(s: string): string {
  if (s === "CRITICAL") return "err";
  if (s === "WARNING") return "warn";
  if (s === "INFO") return "info";
  return "ok";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function Page() {
  const [chart, setChart] = useState<{t:number;v:number}[]>([]);
  const { data: overview, loading: overviewLoading } = useOverview();
  const { data: apiAlerts } = useAlerts();
  const { data: metricsToday } = useMetricsToday();
  const { connected: socketConnected, on, off } = useSocket();

  const [liveOverview, setLiveOverview] = useState(overview);

  useEffect(() => { setChart(makeChart()); }, []);

  useEffect(() => {
    if (overview) setLiveOverview(overview);
  }, [overview]);

  // Listen for real-time metrics updates via WebSocket
  const handleMetricsUpdate = useCallback((payload: unknown) => {
    if (payload && typeof payload === "object") {
      setLiveOverview((prev) => prev ? { ...prev, ...(payload as Record<string, unknown>) } as typeof prev : prev);
    }
  }, []);

  useEffect(() => {
    on("metrics:update", handleMetricsUpdate);
    return () => { off("metrics:update", handleMetricsUpdate); };
  }, [on, off, handleMetricsUpdate]);

  const isLive = liveOverview !== null;
  const stats = liveOverview ?? { total: 0, connected: 0, warming: 0, atRisk: 0 };

  const accountsList = metricsToday
    ? metricsToday.accounts.map((a) => ({
        phone: a.phoneNumber,
        status: statusToShort(a.banRisk === "CRITICAL" ? "BANNED" : a.warmupDay >= 14 ? "CONNECTED" : a.warmupDay > 0 ? "WARMING" : "DISCONNECTED"),
        day: a.warmupDay,
        sent: a.msgsSentToday,
        rate: a.msgsReceivedToday > 0 ? Math.round((a.msgsReceivedToday / Math.max(a.msgsSentToday, 1)) * 100) : 0,
      }))
    : [];

  const alertsList = apiAlerts
    ? apiAlerts.slice(0, 5).map((a) => ({
        msg: a.message,
        lvl: severityToLvl(a.severity),
        t: timeAgo(a.createdAt),
      }))
    : [];

  const totalSent = metricsToday ? metricsToday.totals.sent : 0;

  return (
    <div className="space-y-5">
      {/* Data source indicator */}
      <div className="flex items-center gap-2">
        <div className={`dot ${isLive ? "dot-ok" : "dot-off"}`} />
        <span className="font-mono text-[10px] text-muted-foreground">
          {isLive ? "dados ao vivo" : "offline"}{socketConnected ? " / ws" : ""}
        </span>
        {overviewLoading && <span className="font-mono text-[10px] text-muted-foreground animate-pulse">carregando...</span>}
        <div className="ml-auto" />
        <WarmupControl />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-px bg-border rounded overflow-hidden">
        <StatCell label="TOTAL" value={String(stats.total)} />
        <StatCell label="CONECTADOS" value={String(stats.connected)} accent />
        <StatCell label="AQUECENDO" value={String(stats.warming)} />
        <StatCell label="EM RISCO" value={String(stats.atRisk)} danger />
      </div>

      {/* Chart */}
      <div>
        <div className="section-line">mensagens / 24h &mdash; {totalSent.toLocaleString()} total</div>
        {chart.length > 0 ? (
          <div className="h-[100px] -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(142,72%,45%)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(142,72%,45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke="hsl(142,72%,45%)" strokeWidth={1} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[100px] flex items-center justify-center border border-border rounded font-mono text-xs text-muted-foreground">
            sem dados de mensagens ainda
          </div>
        )}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Accounts table */}
        <div>
          <div className="section-line">contas ativas</div>
          <div className="border border-border rounded overflow-hidden">
            <div className="term-row text-muted-foreground text-[10px] uppercase tracking-widest bg-secondary/50">
              <span className="w-5">#</span>
              <span className="flex-1">telefone</span>
              <span className="w-10 text-right">dia</span>
              <span className="w-12 text-right">enviados</span>
              <span className="w-12 text-right">taxa</span>
            </div>
            {accountsList.map((a, i) => (
              <div key={i} className="term-row">
                <div className={`dot ${dotClass[a.status] ?? "dot-off"}`} />
                <span className="flex-1 font-mono text-xs">{a.phone}</span>
                <span className="w-10 text-right font-mono text-xs text-muted-foreground">{a.day}/14</span>
                <span className="w-12 text-right font-mono text-xs">{a.sent}</span>
                <span className={`w-12 text-right font-mono text-xs ${a.rate < 30 ? "text-red-400" : a.rate < 50 ? "text-yellow-400" : "text-foreground"}`}>
                  {a.rate}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts + System */}
        <div className="space-y-5">
          <div>
            <div className="section-line">alertas</div>
            <div className="border border-border rounded overflow-hidden">
              {alertsList.map((a, i) => (
                <div key={i} className="term-row">
                  <div className={`dot ${lvlDot[a.lvl] ?? "dot-off"}`} />
                  <span className="flex-1 text-xs truncate">{a.msg}</span>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">{a.t}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="section-line">sistema</div>
            <div className="border border-border rounded overflow-hidden">
              <SysRow label="redis" ok val="2ms" />
              <SysRow label="postgresql" ok val="4ms" />
              <SysRow label="fila" ok val="em memoria" />
              <SysRow label="sessoes" ok val={isLive ? `${stats.connected} ativas` : "38 ativas"} />
              <SysRow label="motor-aquecimento" ok val="rodando" />
              <SysRow label="pool-proxies" ok val="12 saudaveis" />
            </div>
          </div>

          <div>
            <div className="section-line">vazao</div>
            <div className="grid grid-cols-3 gap-px bg-border rounded overflow-hidden">
              <MiniStat label="msg/min" value="4.2" />
              <MiniStat label="taxa resposta" value="67%" />
              <MiniStat label="conversas" value="142" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="bg-background px-3 py-2.5">
      <div className="term-label">{label}</div>
      <div className={`font-mono text-lg font-semibold tabular-nums ${danger ? "text-red-400" : accent ? "text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function SysRow({ label, ok, val }: { label: string; ok?: boolean; val: string }) {
  return (
    <div className="term-row">
      <div className={`dot ${ok ? "dot-ok" : "dot-warn"}`} />
      <span className="font-mono text-xs flex-1">{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{val}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-3 py-2">
      <div className="term-label">{label}</div>
      <div className="font-mono text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function WarmupControl() {
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
  const getHeaders = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("maturador_token") : null;
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  };

  useEffect(() => {
    fetch(`${apiUrl}/api/warmup/status`, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setRunning(data.warmupRunning); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    setLoading(true);
    const action = running ? "stop" : "start";
    try {
      const res = await fetch(`${apiUrl}/api/warmup/${action}`, { method: "POST", headers: getHeaders() });
      if (res.ok) setRunning(!running);
    } catch {}
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`dot ${running ? "dot-ok animate-pulse" : "dot-off"}`} />
      <span className="font-mono text-[10px] text-muted-foreground">
        warmup {running ? "ativo" : "parado"}
      </span>
      <button type="button" onClick={toggle} disabled={loading}
        className={`font-mono text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${
          running
            ? "border-red-400/30 text-red-400 hover:bg-red-400/10"
            : "border-primary/30 text-primary hover:bg-primary/10"
        }`}>
        {loading ? "..." : running ? "[parar]" : "[iniciar]"}
      </button>
    </div>
  );
}
