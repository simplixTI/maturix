"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Play, Square, RefreshCw, Loader2, AlertTriangle, Pause, Activity,
} from "lucide-react";
import {
  accounts as accountsApi,
  warmupControl,
  type Account,
  type WarmupStatus,
} from "@/lib/api";

/* ── Warmup phase logic (mirrors backend WarmupPhase.ts) ── */

interface PhaseInfo {
  name: string;
  label: string;
  color: string;
}

function getPhaseForDay(day: number): PhaseInfo {
  if (day <= 0) return { name: "NAO_INICIADO", label: "Nao Iniciado", color: "text-muted-foreground" };
  if (day <= 3) return { name: "FUNDACAO", label: "Fundacao", color: "text-blue-400" };
  if (day <= 5) return { name: "EXPANSAO", label: "Expansao", color: "text-cyan-400" };
  if (day <= 7) return { name: "ESCALA", label: "Escala", color: "text-purple-400" };
  return { name: "MADURO", label: "Maduro", color: "text-emerald-400" };
}

/* ── Daily limit calculation (mirrors backend warmup-profiles.ts) ── */

function getDailyLimit(day: number): number {
  const DAY1_LIMIT = 15;
  const GROWTH_FACTOR = 1.35;
  const MAX_DAILY = 400;
  const clampedDay = Math.max(1, day);
  const rawLimit = Math.floor(DAY1_LIMIT * Math.pow(GROWTH_FACTOR, clampedDay - 1));
  return Math.min(rawLimit, MAX_DAILY);
}

const MAX_WARMUP_DAYS = 14;

/* ── Ban risk colors ── */

const banRiskColor: Record<string, string> = {
  LOW: "text-emerald-400",
  MEDIUM: "text-yellow-400",
  HIGH: "text-orange-400",
  CRITICAL: "text-red-400",
};

const banRiskBg: Record<string, string> = {
  LOW: "bg-emerald-400/10 border-emerald-400/20",
  MEDIUM: "bg-yellow-400/10 border-yellow-400/20",
  HIGH: "bg-orange-400/10 border-orange-400/20",
  CRITICAL: "bg-red-400/10 border-red-400/20",
};

function formatPhone(p: string): string {
  if (p.length >= 12) return `+${p.slice(0, 2)} ${p.slice(2, 4)} ${p.slice(4, 9)}-${p.slice(9)}`;
  return p;
}

export default function AquecimentoPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [engineStatus, setEngineStatus] = useState<WarmupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [engineLoading, setEngineLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  /* ── Fetch data ── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    const [accRes, statusRes] = await Promise.all([
      accountsApi.getAll(),
      warmupControl.getStatus(),
    ]);
    if (accRes) setAccounts(accRes);
    if (statusRes) setEngineStatus(statusRes);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 15000);
    return () => clearInterval(iv);
  }, [fetchData]);

  /* ── Engine control ── */
  const handleStartEngine = async () => {
    setError("");
    setSuccess("");
    setEngineLoading(true);
    const res = await warmupControl.start();
    if (res) {
      setSuccess("Motor de aquecimento iniciado");
      await fetchData();
    } else {
      setError("Falha ao iniciar motor de aquecimento");
    }
    setEngineLoading(false);
  };

  const handleStopEngine = async () => {
    setError("");
    setSuccess("");
    setEngineLoading(true);
    const res = await warmupControl.stop();
    if (res) {
      setSuccess("Motor de aquecimento parado");
      await fetchData();
    } else {
      setError("Falha ao parar motor de aquecimento");
    }
    setEngineLoading(false);
  };

  /* ── Derived stats ── */
  const warmingAccounts = useMemo(
    () => accounts.filter((a) => a.warmupDay > 0 && a.status === "CONNECTED"),
    [accounts]
  );

  const overallStats = useMemo(() => {
    const warming = warmingAccounts;
    const totalWarming = warming.length;
    const avgDay =
      totalWarming > 0
        ? Math.round(warming.reduce((s, a) => s + a.warmupDay, 0) / totalWarming)
        : 0;
    const totalMsgsToday = warming.reduce((s, a) => s + (a.msgsSentToday || 0), 0);
    const pausedCount = warming.filter((a) => a.isPaused).length;
    const atRiskCount = warming.filter(
      (a) => a.banRisk === "HIGH" || a.banRisk === "CRITICAL"
    ).length;
    return { totalWarming, avgDay, totalMsgsToday, pausedCount, atRiskCount };
  }, [warmingAccounts]);

  const isEngineRunning = engineStatus?.warmupRunning ?? false;

  /* ── Clear messages after 5s ── */
  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(""); setSuccess(""); }, 5000);
      return () => clearTimeout(t);
    }
  }, [error, success]);

  return (
    <div className="space-y-5">
      {/* ── Overall Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border rounded overflow-hidden">
        <StatCell label="CONTAS AQUECENDO" value={String(overallStats.totalWarming)} accent />
        <StatCell label="DIA MEDIO" value={`${overallStats.avgDay}/${MAX_WARMUP_DAYS}`} />
        <StatCell label="MSGS HOJE" value={String(overallStats.totalMsgsToday)} accent />
        <StatCell label="PAUSADAS" value={String(overallStats.pausedCount)} />
        <StatCell label="EM RISCO" value={String(overallStats.atRiskCount)} danger={overallStats.atRiskCount > 0} />
      </div>

      {/* ── Engine Control ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className={`dot ${isEngineRunning ? "dot-ok" : "dot-off"}`} />
          <span className="font-mono text-xs text-muted-foreground">
            motor: {isEngineRunning ? "ativo" : "parado"}
          </span>
        </div>

        {isEngineRunning ? (
          <button
            type="button"
            onClick={handleStopEngine}
            disabled={engineLoading}
            className="flex items-center gap-1.5 font-mono text-[11px] px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-400/30 rounded-sm hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {engineLoading ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />}
            [parar motor]
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStartEngine}
            disabled={engineLoading}
            className="flex items-center gap-1.5 font-mono text-[11px] px-3 py-1.5 bg-primary/10 text-primary border border-primary/30 rounded-sm hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {engineLoading ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            [iniciar motor]
          </button>
        )}

        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          <RefreshCw size={9} className={loading ? "animate-spin" : ""} />[atualizar]
        </button>
      </div>

      {/* ── Feedback messages ── */}
      {error && (
        <div className="flex items-center gap-2 font-mono text-xs text-red-400 bg-red-400/5 border border-red-400/20 px-3 py-2 rounded-sm">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 font-mono text-xs text-primary bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm">
          <Activity size={12} /> {success}
        </div>
      )}

      {/* ── Section header ── */}
      <div className="section-line">contas em aquecimento ({warmingAccounts.length})</div>

      {/* ── Account cards ── */}
      {warmingAccounts.length === 0 ? (
        <div className="border border-border rounded p-8 text-center font-mono text-xs text-muted-foreground">
          nenhuma conta em processo de aquecimento.
          <br />
          conecte contas e inicie o motor para comecar.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {warmingAccounts.map((account) => (
            <AccountWarmupCard key={account.id} account={account} />
          ))}
        </div>
      )}

      {/* ── Show non-warming connected accounts ── */}
      {accounts.filter((a) => a.status === "CONNECTED" && a.warmupDay <= 0).length > 0 && (
        <>
          <div className="section-line">
            contas conectadas sem aquecimento (
            {accounts.filter((a) => a.status === "CONNECTED" && a.warmupDay <= 0).length})
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {accounts
              .filter((a) => a.status === "CONNECTED" && a.warmupDay <= 0)
              .map((account) => (
                <div
                  key={account.id}
                  className="border border-border rounded p-3 bg-secondary/20"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">
                      {formatPhone(account.phoneNumber)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      dia 0 - aguardando inicio
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Account Warmup Card ── */

function AccountWarmupCard({ account }: { account: Account }) {
  const day = account.warmupDay || 0;
  const phase = getPhaseForDay(day);
  const dailyLimit = getDailyLimit(day);
  const sentToday = account.msgsSentToday || 0;
  const receivedToday = account.msgsReceivedToday || 0;
  const replyRate =
    sentToday > 0 ? Math.round((receivedToday / sentToday) * 100) : 0;
  const progressPct = Math.min((day / MAX_WARMUP_DAYS) * 100, 100);
  const sentPct = dailyLimit > 0 ? Math.min((sentToday / dailyLimit) * 100, 100) : 0;
  const risk = account.banRisk || "LOW";
  const riskColor = banRiskColor[risk] || banRiskColor.LOW;
  const riskBgClass = banRiskBg[risk] || banRiskBg.LOW;

  return (
    <div className="border border-border rounded p-4 space-y-3 bg-secondary/10 hover:bg-secondary/20 transition-colors">
      {/* Header: phone + status */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs font-semibold">
            {formatPhone(account.phoneNumber)}
          </div>
          {account.displayName && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {account.displayName}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {account.isPaused && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-sm">
              <Pause size={9} /> pausado
            </span>
          )}
          <span
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded-sm border ${riskBgClass} ${riskColor}`}
          >
            {risk}
          </span>
        </div>
      </div>

      {/* Phase + Day */}
      <div className="flex items-center justify-between">
        <span className={`font-mono text-[11px] font-semibold ${phase.color}`}>
          {phase.label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          dia {day}/{MAX_WARMUP_DAYS}
        </span>
      </div>

      {/* Progress bar - day/14 */}
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="font-mono text-[10px] text-muted-foreground">progresso geral</span>
          <span className="font-mono text-[10px] text-muted-foreground">{Math.round(progressPct)}%</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Messages sent today vs limit */}
      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="font-mono text-[10px] text-muted-foreground">
            msgs hoje: {sentToday}/{dailyLimit}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{Math.round(sentPct)}%</span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              sentPct >= 90 ? "bg-red-400" : sentPct >= 70 ? "bg-yellow-400" : "bg-emerald-400"
            }`}
            style={{ width: `${sentPct}%` }}
          />
        </div>
      </div>

      {/* Bottom stats row */}
      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <div className="font-mono text-[10px] text-muted-foreground">
          recebidas: <span className="text-foreground">{receivedToday}</span>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">
          taxa resposta:{" "}
          <span
            className={
              replyRate >= 50
                ? "text-emerald-400"
                : replyRate >= 25
                ? "text-yellow-400"
                : "text-red-400"
            }
          >
            {replyRate}%
          </span>
        </div>
        <div className={`font-mono text-[10px] ${riskColor}`}>
          risco: {risk.toLowerCase()}
        </div>
      </div>
    </div>
  );
}

/* ── Stat Cell ── */

function StatCell({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="bg-background px-3 py-2.5">
      <div className="term-label">{label}</div>
      <div
        className={`font-mono text-lg font-semibold tabular-nums ${
          danger ? "text-red-400" : accent ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
