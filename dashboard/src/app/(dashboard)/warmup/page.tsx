"use client";

import { useState, useMemo } from "react";
import { Play, Pause, RefreshCw, ChevronDown, Flame, Shield, Zap, Clock } from "lucide-react";
import { useAccounts } from "@/hooks/useApi";
import { accounts as accountsApi, sessions as sessionsApi } from "@/lib/api";
import type { Account } from "@/lib/api";

type Status = "active" | "complete" | "paused" | "at-risk" | "disconnected";

interface WarmupAccount {
  id: string;
  phone: string;
  status: Status;
  day: number;
  sentToday: number;
  received: number;
  capacity: number;
  maxCapacity: number;
  replyRate: number;
  isPaused: boolean;
  banRisk: string;
  apiStatus: string;
}

const dotMap: Record<Status, string> = {
  active: "dot-warn",
  complete: "dot-ok",
  paused: "dot-off",
  "at-risk": "dot-err",
  disconnected: "dot-off",
};

const statusLabel: Record<Status, string> = {
  active: "aquecendo",
  complete: "pronto",
  paused: "pausado",
  "at-risk": "risco",
  disconnected: "offline",
};

function mapAccount(a: Account): WarmupAccount {
  const day = a.warmupState?.currentDay ?? a.warmupDay ?? 0;
  let status: Status;
  if (a.status === "DISCONNECTED" || a.status === "BANNED") status = "disconnected";
  else if (a.isPaused) status = "paused";
  else if (a.banRisk === "CRITICAL" || a.banRisk === "HIGH") status = "at-risk";
  else if (day >= 14) status = "complete";
  else status = "active";

  return {
    id: a.id,
    phone: a.phoneNumber,
    status,
    day: Math.min(day, 14),
    sentToday: a.msgsSentToday,
    received: a.msgsReceivedToday,
    capacity: a.msgsSentToday,
    maxCapacity: a.warmupState?.maxCapacity ?? 400,
    replyRate: a.msgsReceivedToday > 0 ? Math.round((a.msgsReceivedToday / Math.max(a.msgsSentToday, 1)) * 100) : 0,
    isPaused: a.isPaused,
    banRisk: a.banRisk,
    apiStatus: a.status,
  };
}

function formatPhone(p: string): string {
  if (p.length >= 12) return `+${p.slice(0,2)} ${p.slice(2,4)} ${p.slice(4,9)}-${p.slice(9)}`;
  return p;
}

export default function WarmupPage() {
  const { data: apiAccounts, loading, refetch } = useAccounts();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const accounts = useMemo(() => apiAccounts ? apiAccounts.map(mapAccount) : [], [apiAccounts]);

  const token = typeof window !== "undefined" ? localStorage.getItem("maturador_token") : null;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const summary = useMemo(() => ({
    total: accounts.length,
    avgDay: accounts.length > 0 ? Math.round(accounts.reduce((s, a) => s + a.day, 0) / accounts.length * 10) / 10 : 0,
    warmed: accounts.filter(a => a.status === "complete").length,
    atRisk: accounts.filter(a => a.status === "at-risk").length,
    totalSent: accounts.reduce((s, a) => s + a.sentToday, 0),
    active: accounts.filter(a => a.status === "active").length,
    paused: accounts.filter(a => a.isPaused).length,
  }), [accounts]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(accounts.map(a => a.id)));
  const selectNone = () => setSelected(new Set());

  const doAction = async (action: string, accountId: string) => {
    setActionLoading(accountId);
    try {
      if (action === "pause") await accountsApi.update(accountId, { isPaused: true });
      if (action === "resume") await accountsApi.update(accountId, { isPaused: false });
      if (action === "reconnect") await sessionsApi.reconnect(accountId);
      if (action === "remove") await accountsApi.delete(accountId);
      await new Promise(r => setTimeout(r, 500));
      refetch();
    } catch {}
    setActionLoading(null);
  };

  const doBulkAction = async (action: string) => {
    for (const id of selected) {
      await doAction(action, id);
    }
    selectNone();
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-4 lg:grid-cols-7 gap-px bg-border rounded overflow-hidden">
        <StatCell label="TOTAL" value={String(summary.total)} />
        <StatCell label="ATIVOS" value={String(summary.active)} accent />
        <StatCell label="AQUECIDOS" value={String(summary.warmed)} accent />
        <StatCell label="EM RISCO" value={String(summary.atRisk)} danger />
        <StatCell label="PAUSADOS" value={String(summary.paused)} />
        <StatCell label="DIA MEDIO" value={`${summary.avgDay}/14`} />
        <StatCell label="ENVIADOS HOJE" value={String(summary.totalSent)} />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={selectAll} className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors">[selecionar todos]</button>
        <button onClick={selectNone} className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors">[limpar]</button>

        {selected.size > 0 && (
          <>
            <span className="font-mono text-[10px] text-primary">{selected.size} selecionados</span>
            <button onClick={() => doBulkAction("pause")}
              className="font-mono text-[10px] px-2 py-0.5 rounded border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10 transition-colors">
              [pausar selecionados]
            </button>
            <button onClick={() => doBulkAction("resume")}
              className="font-mono text-[10px] px-2 py-0.5 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors">
              [retomar selecionados]
            </button>
            <button onClick={() => doBulkAction("reconnect")}
              className="font-mono text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors">
              [reconectar selecionados]
            </button>
          </>
        )}

        <div className="flex-1" />
        <button onClick={async () => { await refetch(); }} className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 active:text-primary">
          <RefreshCw size={9} className={loading ? "animate-spin" : ""} />[atualizar]
        </button>
        {loading && <span className="font-mono text-[10px] text-muted-foreground animate-pulse">carregando...</span>}
      </div>

      {/* Accounts list */}
      <div className="section-line">progresso aquecimento &mdash; {accounts.length} contas</div>

      {accounts.length === 0 ? (
        <div className="border border-border rounded p-8 text-center font-mono text-xs text-muted-foreground">
          nenhuma conta conectada
        </div>
      ) : (
        <div className="border border-border rounded overflow-hidden">
          {/* Header */}
          <div className="term-row text-[10px] text-muted-foreground uppercase tracking-widest bg-secondary/30">
            <span className="w-5" />
            <span className="w-5" />
            <span className="w-40">telefone</span>
            <span className="w-14">status</span>
            <span className="w-20">progresso</span>
            <span className="w-14 text-right">dia</span>
            <span className="w-20 text-right">env/cap</span>
            <span className="w-14 text-right">taxa</span>
            <span className="flex-1 text-right">acoes</span>
          </div>

          {accounts.map(acc => (
            <div key={acc.id}>
              {/* Row */}
              <div className={`term-row cursor-pointer ${expanded === acc.id ? "!bg-primary/5" : ""} ${selected.has(acc.id) ? "!bg-secondary" : ""}`}
                onClick={() => setExpanded(expanded === acc.id ? null : acc.id)}>
                {/* Checkbox */}
                <button className="w-5 flex justify-center" onClick={e => { e.stopPropagation(); toggleSelect(acc.id); }}>
                  <div className={`w-3 h-3 rounded-sm border transition-colors ${selected.has(acc.id) ? "bg-primary border-primary" : "border-border hover:border-foreground/30"}`} />
                </button>
                {/* Status dot */}
                <div className={`dot ${dotMap[acc.status]}`} />
                {/* Phone */}
                <span className="w-40 font-mono text-xs truncate">{formatPhone(acc.phone)}</span>
                {/* Status */}
                <span className={`w-14 font-mono text-[10px] ${acc.status === "at-risk" ? "text-red-400" : acc.status === "complete" ? "text-primary" : acc.status === "paused" ? "text-yellow-400" : "text-muted-foreground"}`}>
                  {statusLabel[acc.status]}
                </span>
                {/* Progress bar */}
                <span className="w-20">
                  <div className="h-1 bg-border rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${acc.status === "at-risk" ? "bg-red-400" : acc.status === "complete" ? "bg-primary" : "bg-yellow-400"}`}
                      style={{ width: `${Math.min(100, (acc.day / 14) * 100)}%` }} />
                  </div>
                </span>
                {/* Day */}
                <span className="w-14 text-right font-mono text-xs text-muted-foreground">{acc.day}/14</span>
                {/* Sent/Capacity */}
                <span className="w-20 text-right font-mono text-xs">{acc.sentToday}/{acc.maxCapacity}</span>
                {/* Reply rate */}
                <span className={`w-14 text-right font-mono text-xs ${acc.replyRate < 30 ? "text-red-400" : acc.replyRate < 50 ? "text-yellow-400" : ""}`}>
                  {acc.replyRate}%
                </span>
                {/* Quick actions */}
                <span className="flex-1 flex justify-end gap-1">
                  {acc.isPaused ? (
                    <button onClick={e => { e.stopPropagation(); doAction("resume", acc.id); }}
                      className="text-primary hover:text-primary/80 transition-colors" title="Retomar">
                      <Play size={11} />
                    </button>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); doAction("pause", acc.id); }}
                      className="text-yellow-400 hover:text-yellow-300 transition-colors" title="Pausar">
                      <Pause size={11} />
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); doAction("reconnect", acc.id); }}
                    className="text-muted-foreground hover:text-foreground transition-colors" title="Reconectar">
                    <RefreshCw size={11} />
                  </button>
                  <ChevronDown size={11} className={`text-muted-foreground transition-transform ${expanded === acc.id ? "rotate-180" : ""}`} />
                </span>
              </div>

              {/* Expanded details */}
              {expanded === acc.id && (
                <div className="px-4 py-3 bg-secondary/20 border-t border-border/50 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <DetailItem icon={Flame} label="dia aquecimento" value={`${acc.day}/14`} sub={`${Math.round((acc.day/14)*100)}% completo`} />
                    <DetailItem icon={Zap} label="enviados hoje" value={String(acc.sentToday)} sub={`capacidade: ${acc.maxCapacity}`} />
                    <DetailItem icon={Shield} label="taxa resposta" value={`${acc.replyRate}%`} sub={`recebidos: ${acc.received}`}
                      color={acc.replyRate < 30 ? "text-red-400" : acc.replyRate < 50 ? "text-yellow-400" : "text-primary"} />
                    <DetailItem icon={Clock} label="risco ban" value={acc.banRisk} sub={`status: ${acc.apiStatus}`}
                      color={acc.banRisk === "CRITICAL" ? "text-red-400" : acc.banRisk === "HIGH" ? "text-yellow-400" : "text-primary"} />
                  </div>

                  {/* Progress bar detailed */}
                  <div>
                    <div className="term-label mb-1">progresso aquecimento</div>
                    <div className="h-2 bg-border rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${acc.status === "at-risk" ? "bg-red-400" : acc.status === "complete" ? "bg-primary" : "bg-yellow-400"}`}
                        style={{ width: `${Math.min(100, (acc.day / 14) * 100)}%` }} />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="font-mono text-[9px] text-muted-foreground">dia 1</span>
                      <span className="font-mono text-[9px] text-muted-foreground">dia 7</span>
                      <span className="font-mono text-[9px] text-muted-foreground">dia 14</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <div className="term-label">acoes</div>
                    <div className="flex gap-1.5 ml-2">
                      {acc.isPaused ? (
                        <ActionBtn label="retomar aquecimento" color="green" loading={actionLoading === acc.id} onClick={() => doAction("resume", acc.id)} />
                      ) : (
                        <ActionBtn label="pausar aquecimento" color="yellow" loading={actionLoading === acc.id} onClick={() => doAction("pause", acc.id)} />
                      )}
                      <ActionBtn label="reconectar" loading={actionLoading === acc.id} onClick={() => doAction("reconnect", acc.id)} />
                      <ActionBtn label="remover" color="red" loading={actionLoading === acc.id} onClick={() => doAction("remove", acc.id)} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="bg-background px-3 py-2.5">
      <div className="term-label">{label}</div>
      <div className={`font-mono text-lg font-semibold tabular-nums ${danger ? "text-red-400" : accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

function DetailItem({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={12} className="text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <div className="term-label">{label}</div>
        <div className={`font-mono text-sm font-medium ${color || ""}`}>{value}</div>
        <div className="font-mono text-[9px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

function ActionBtn({ label, color, loading, onClick }: { label: string; color?: "red" | "yellow" | "green"; loading: boolean; onClick: () => void }) {
  const cls = color === "red" ? "border-red-400/30 text-red-400 hover:bg-red-400/10"
    : color === "yellow" ? "border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10"
    : color === "green" ? "border-primary/30 text-primary hover:bg-primary/10"
    : "border-border text-muted-foreground hover:text-foreground";
  return (
    <button type="button" disabled={loading} onClick={onClick}
      className={`font-mono text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${cls}`}>
      [{label}]
    </button>
  );
}
