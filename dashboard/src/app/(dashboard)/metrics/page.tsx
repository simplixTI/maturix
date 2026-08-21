"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid,
} from "recharts";
import { TrendingUp, Activity, Clock, Zap, Download, Shield } from "lucide-react";
import { useMetrics, useMetricsToday } from "@/hooks/useApi";
import type { MetricsEntry } from "@/lib/api";

const periods = ["24h", "7d", "14d", "30d"] as const;
type Period = (typeof periods)[number];

const periodDays: Record<Period, number> = { "24h": 1, "7d": 7, "14d": 14, "30d": 30 };

const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];

/* ── transform API metrics to chart format ── */

function metricsToChartData(entries: MetricsEntry[]) {
  // Group by date for daily aggregation
  const byDate = new Map<string, { sent: number; received: number; replySum: number; count: number }>();
  for (const e of entries) {
    const dateKey = e.date.split("T")[0];
    const existing = byDate.get(dateKey);
    if (existing) {
      existing.sent += e.messagesSent;
      existing.received += e.messagesReceived;
      existing.replySum += e.replyRate;
      existing.count++;
    } else {
      byDate.set(dateKey, {
        sent: e.messagesSent,
        received: e.messagesReceived,
        replySum: e.replyRate,
        count: 1,
      });
    }
  }

  const sorted = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));

  const msgs = sorted.map(([date, d]) => ({
    date: formatDateLabel(date),
    enviadas: d.sent,
    recebidas: d.received,
  }));

  const reply = sorted.map(([date, d]) => ({
    date: formatDateLabel(date),
    taxa: Math.round((d.replySum / d.count) * 100),
  }));

  return { msgs, reply };
}

function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  return `${parts[2]}/${parts[1]}`;
}

function metricsToHeatmap(entries: MetricsEntry[]): number[][] {
  // Create a 7x24 grid (days x hours)
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const countGrid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  for (const e of entries) {
    const d = new Date(e.date);
    const dayOfWeek = (d.getDay() + 6) % 7; // Monday = 0
    const hour = d.getHours();
    grid[dayOfWeek][hour] += e.messagesSent;
    countGrid[dayOfWeek][hour]++;
  }

  // Normalize to 0-1
  let maxVal = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v > maxVal) maxVal = v;
    }
  }
  if (maxVal === 0) maxVal = 1;

  return grid.map((row) => row.map((v) => v / maxVal));
}

interface AccountRanking {
  phone: string;
  warmupDay: number;
  sentToday: number;
  rate: number;
  banRisk: string;
  health: number;
}

function metricsToRankings(entries: MetricsEntry[], todayAccounts?: {
  id: string;
  phoneNumber: string;
  msgsSentToday: number;
  msgsReceivedToday: number;
  warmupDay: number;
  banRisk: string;
}[]): AccountRanking[] {
  // Aggregate per account from historical metrics
  const byAccount = new Map<string, { phone: string; sent: number; received: number; count: number; avgRate: number }>();
  for (const e of entries) {
    const existing = byAccount.get(e.accountId);
    if (existing) {
      existing.sent += e.messagesSent;
      existing.received += e.messagesReceived;
      existing.avgRate += e.replyRate;
      existing.count++;
    } else {
      byAccount.set(e.accountId, {
        phone: e.accountId.slice(0, 16),
        sent: e.messagesSent,
        received: e.messagesReceived,
        avgRate: e.replyRate,
        count: 1,
      });
    }
  }

  // Merge with today's live data if available
  const todayMap = new Map<string, typeof todayAccounts extends (infer T)[] ? T : never>();
  if (todayAccounts) {
    for (const a of todayAccounts) {
      todayMap.set(a.id, a);
    }
  }

  return Array.from(byAccount.entries())
    .map(([accountId, a]) => {
      const rate = Math.round((a.avgRate / a.count) * 100);
      const today = todayMap.get(accountId);
      const health = Math.min(100, Math.round(rate * 0.7 + Math.min(a.sent / 20, 30)));
      return {
        phone: today?.phoneNumber || a.phone,
        warmupDay: today?.warmupDay || 0,
        sentToday: today?.msgsSentToday || 0,
        rate,
        banRisk: today?.banRisk || "LOW",
        health,
      };
    })
    .sort((a, b) => b.health - a.health);
}

/* ── tooltip ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label, suffix }: { active?: boolean; payload?: { value: number; dataKey?: string; color?: string }[]; label?: string; suffix?: string; [k: string]: unknown }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border px-3 py-2 font-mono text-[10px] shadow-lg">
      {label && <div className="text-muted-foreground mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || "hsl(142,72%,45%)" }} />
          <span>{p.value?.toLocaleString()}{suffix ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

/* ── CSV export ── */

function exportCSV(days: number) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
  const token = typeof window !== "undefined" ? localStorage.getItem("maturador_token") : null;
  const url = new URL(`${API_URL}/api/metrics/export`);
  url.searchParams.set("days", String(days));
  url.searchParams.set("format", "csv");
  if (token) {
    url.searchParams.set("token", token);
  }

  const link = document.createElement("a");
  link.href = url.toString();
  link.download = `metricas_${days}d.csv`;

  // Use fetch to add auth header
  fetch(url.toString(), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
    .then((res) => res.blob())
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    })
    .catch((err) => console.error("Erro ao exportar CSV:", err));
}

/* ── ban risk badge ── */

function BanRiskBadge({ risk }: { risk: string }) {
  const colors: Record<string, string> = {
    LOW: "text-primary bg-primary/10",
    MEDIUM: "text-yellow-400 bg-yellow-400/10",
    HIGH: "text-orange-400 bg-orange-400/10",
    CRITICAL: "text-red-400 bg-red-400/10",
  };
  const labels: Record<string, string> = {
    LOW: "BAIXO",
    MEDIUM: "MEDIO",
    HIGH: "ALTO",
    CRITICAL: "CRITICO",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider ${colors[risk] || colors.LOW}`}>
      {labels[risk] || risk}
    </span>
  );
}

/* ── page ── */

export default function MetricsPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [mounted, setMounted] = useState(false);

  const { data: apiMetrics, loading: metricsLoading } = useMetrics(periodDays[period]);
  const { data: apiMetricsToday, loading: todayLoading } = useMetricsToday();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isLive = apiMetrics !== null;

  const chartData = useMemo(() => {
    if (apiMetrics && apiMetrics.length > 0) {
      return metricsToChartData(apiMetrics);
    }
    return null;
  }, [apiMetrics]);

  const heatmap = useMemo(() => {
    if (apiMetrics && apiMetrics.length > 0) {
      return metricsToHeatmap(apiMetrics);
    }
    // Fallback: empty heatmap
    return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  }, [apiMetrics]);

  const rankings = useMemo(() => {
    if (apiMetrics && apiMetrics.length > 0) {
      return metricsToRankings(apiMetrics, apiMetricsToday?.accounts);
    }
    return [];
  }, [apiMetrics, apiMetricsToday]);

  const totalMessages = useMemo(() => {
    if (apiMetrics && apiMetrics.length > 0) {
      return apiMetrics.reduce((sum, e) => sum + e.messagesSent, 0).toLocaleString();
    }
    return "0";
  }, [apiMetrics]);

  const totalReceived = useMemo(() => {
    if (apiMetrics && apiMetrics.length > 0) {
      return apiMetrics.reduce((sum, e) => sum + e.messagesReceived, 0).toLocaleString();
    }
    return "0";
  }, [apiMetrics]);

  const avgReply = useMemo(() => {
    if (apiMetrics && apiMetrics.length > 0) {
      const avg = apiMetrics.reduce((sum, e) => sum + e.replyRate, 0) / apiMetrics.length;
      return `${Math.round(avg * 100)}%`;
    }
    return "0%";
  }, [apiMetrics]);

  const todaySent = apiMetricsToday ? apiMetricsToday.totals.sent : 0;
  const todayReceived = apiMetricsToday ? apiMetricsToday.totals.received : 0;

  const loading = metricsLoading || todayLoading;

  const handleExport = useCallback(() => {
    exportCSV(periodDays[period]);
  }, [period]);

  if (!mounted) return <div className="font-mono text-xs text-muted-foreground p-4">carregando...</div>;

  return (
    <div className="space-y-5">
      {/* Data source indicator */}
      <div className="flex items-center gap-2">
        <div className={`dot ${isLive ? "dot-ok" : "dot-off"}`} />
        <span className="font-mono text-[10px] text-muted-foreground">
          {isLive ? "dados ao vivo" : "dados offline"}
        </span>
        {loading && <span className="font-mono text-[10px] text-muted-foreground animate-pulse">carregando...</span>}
      </div>

      {/* Period selector + export button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 font-mono text-xs">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 rounded transition-colors ${
                period === p
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              [{p}]
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono text-[10px] text-muted-foreground">
            periodo: {period} &mdash; {totalMessages} mensagens
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border font-mono text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            title="Exportar metricas em CSV"
          >
            <Download size={10} />
            exportar CSV
          </button>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded overflow-hidden">
        <StatCell icon={TrendingUp} label="ENVIADAS" value={totalMessages} accent />
        <StatCell icon={Activity} label="TAXA RESPOSTA" value={avgReply} />
        <StatCell icon={Zap} label="ENVIADOS HOJE" value={todaySent.toLocaleString()} sub={`recebidas: ${todayReceived.toLocaleString()}`} />
        <StatCell icon={Clock} label="RECEBIDAS" value={totalReceived} />
      </div>

      {/* Messages chart (area + bar) */}
      <div>
        <div className="section-line">mensagens por dia &mdash; {period}</div>
        {!chartData || chartData.msgs.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center font-mono text-xs text-muted-foreground border border-border rounded">
            sem dados de mensagens para este periodo
          </div>
        ) : (
          <div className="h-[160px] -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.msgs} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "hsl(0 0% 50%)", fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "hsl(0 0% 50%)", fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={35}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="enviadas" fill="hsl(142,72%,45%)" opacity={0.8} radius={[2, 2, 0, 0]} />
                <Bar dataKey="recebidas" fill="hsl(200,72%,50%)" opacity={0.6} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Reply rate chart */}
      <div>
        <div className="section-line">taxa de resposta % &mdash; limite 30%</div>
        {!chartData || chartData.reply.length === 0 ? (
          <div className="h-[120px] flex items-center justify-center font-mono text-xs text-muted-foreground border border-border rounded">
            sem dados de resposta para este periodo
          </div>
        ) : (
          <div className="h-[120px] -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData.reply} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gReply" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(142,72%,45%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(142,72%,45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "hsl(0 0% 50%)", fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "hsl(0 0% 50%)", fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  domain={[0, 100]}
                />
                <Tooltip content={<ChartTooltip suffix="%" />} />
                <ReferenceLine
                  y={30}
                  stroke="hsl(0,62%,55%)"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  label={{ value: "min 30%", fill: "hsl(0,62%,55%)", fontSize: 9, fontFamily: "monospace", position: "right" }}
                />
                <Area type="monotone" dataKey="taxa" stroke="hsl(142,72%,45%)" strokeWidth={1.5} fill="url(#gReply)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Two columns: heatmap + ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Activity heatmap */}
        <div>
          <div className="section-line">mapa de atividade &mdash; mensagens por hora</div>
          <div className="border border-border rounded overflow-hidden p-3">
            <div className="flex gap-[2px]">
              {/* Day labels */}
              <div className="flex flex-col gap-[2px] mr-1 shrink-0">
                {days.map((d) => (
                  <div
                    key={d}
                    className="font-mono text-[9px] text-muted-foreground h-[14px] flex items-center justify-end w-6"
                  >
                    {d}
                  </div>
                ))}
              </div>
              {/* Grid */}
              <div className="flex-1">
                {/* Hour labels */}
                <div className="flex gap-[2px] mb-[2px]">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      className="flex-1 font-mono text-[7px] text-muted-foreground text-center"
                    >
                      {h % 3 === 0 ? h : ""}
                    </div>
                  ))}
                </div>
                {/* Cells */}
                {heatmap.map((row, ri) => (
                  <div key={ri} className="flex gap-[2px]">
                    {row.map((val, ci) => (
                      <div
                        key={ci}
                        className="flex-1 h-[14px] rounded-[1px] transition-colors"
                        style={{
                          backgroundColor: `hsl(142 72% 45% / ${Math.max(0.04, val * 0.7)})`,
                        }}
                        title={`${days[ri]} ${ci}:00 - ${(val * 100).toFixed(0)}% atividade`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-2 mt-2 font-mono text-[9px] text-muted-foreground justify-end">
              <span>menos</span>
              {[0.05, 0.15, 0.3, 0.5, 0.7].map((v) => (
                <div
                  key={v}
                  className="w-[10px] h-[10px] rounded-[1px]"
                  style={{ backgroundColor: `hsl(142 72% 45% / ${v})` }}
                />
              ))}
              <span>mais</span>
            </div>
          </div>
        </div>

        {/* Account ranking */}
        <div>
          <div className="section-line">ranking de contas &mdash; desempenho</div>
          {rankings.length === 0 ? (
            <div className="border border-border rounded p-4 font-mono text-xs text-muted-foreground text-center">
              sem dados de contas disponiveis
            </div>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              <div className="term-row text-muted-foreground text-[10px] uppercase tracking-widest bg-secondary/50">
                <span className="w-5">#</span>
                <span className="flex-1">telefone</span>
                <span className="w-10 text-center">dia</span>
                <span className="w-14 text-right">hoje</span>
                <span className="w-12 text-right">taxa</span>
                <span className="w-16 text-center">risco</span>
                <span className="w-20 text-center">saude</span>
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {rankings.map((a, i) => (
                  <div key={i} className="term-row">
                    <span className="w-5 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 font-mono text-xs truncate">{a.phone}</span>
                    <span className="w-10 text-center font-mono text-[10px] text-muted-foreground">D{a.warmupDay}</span>
                    <span className="w-14 text-right font-mono text-xs">{a.sentToday.toLocaleString()}</span>
                    <span
                      className={`w-12 text-right font-mono text-xs ${
                        a.rate < 30 ? "text-red-400" : a.rate < 50 ? "text-yellow-400" : "text-foreground"
                      }`}
                    >
                      {a.rate}%
                    </span>
                    <span className="w-16 text-center">
                      <BanRiskBadge risk={a.banRisk} />
                    </span>
                    <span className="w-20 flex items-center gap-1.5">
                      <div className="flex-1 h-[3px] bg-border rounded overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${a.health}%`,
                            backgroundColor:
                              a.health >= 70
                                ? "hsl(142,72%,45%)"
                                : a.health >= 40
                                ? "hsl(45,93%,47%)"
                                : "hsl(0,62%,55%)",
                          }}
                        />
                      </div>
                      <span
                        className={`font-mono text-[10px] w-7 text-right ${
                          a.health >= 70
                            ? "text-primary"
                            : a.health >= 40
                            ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {a.health}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── helpers ── */

function StatCell({
  icon: Icon,
  label,
  value,
  accent,
  sub,
}: {
  icon: React.ComponentType<Record<string, unknown>>;
  label: string;
  value: string | number;
  accent?: boolean;
  sub?: string;
}) {
  return (
    <div className="bg-background px-3 py-2.5">
      <div className="flex items-center gap-1 term-label">
        <Icon size={10} />
        {label}
      </div>
      <div className={`font-mono text-lg font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
      {sub && <div className="font-mono text-[9px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
