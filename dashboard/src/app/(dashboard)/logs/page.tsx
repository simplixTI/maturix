"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAlerts } from "@/hooks/useApi";
import { useSocket } from "@/lib/socket";
import type { AlertItem } from "@/lib/api";

type Level = "INFO" | "WARN" | "ERROR";

interface LogEntry {
  id: string;
  timestamp: string;
  level: Level;
  module: string;
  message: string;
}

/* ── map API alerts to log entries ── */

function severityToLevel(severity: string): Level {
  if (severity === "CRITICAL" || severity === "ERROR") return "ERROR";
  if (severity === "WARNING") return "WARN";
  return "INFO";
}

function formatTimestamp(date: Date): string {
  return (
    date.toTimeString().slice(0, 8) +
    "." +
    String(date.getMilliseconds()).padStart(3, "0")
  );
}

function mapAlertToLog(alert: AlertItem, index: number): LogEntry {
  const date = new Date(alert.createdAt);
  return {
    id: `alert-${alert.id || index}`,
    timestamp: formatTimestamp(date),
    level: severityToLevel(alert.severity),
    module: alert.accountId ? alert.accountId.slice(0, 12) : "sistema",
    message: alert.message,
  };
}

/* ── constants ── */

const levelColor: Record<Level, string> = {
  INFO: "text-emerald-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
};

const levelBg: Record<Level, string> = {
  INFO: "bg-emerald-400/10 text-emerald-400",
  WARN: "bg-yellow-400/10 text-yellow-400",
  ERROR: "bg-red-400/10 text-red-400",
};

type Filter = "ALL" | Level;

const MAX_LOG_ENTRIES = 500;

export default function LogsPage() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [moduleFilter, setModuleFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [socketLogs, setSocketLogs] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);

  const { data: apiAlerts, loading } = useAlerts();
  const { connected, on, off } = useSocket();

  /* ── Socket.IO real-time log entries ── */
  const handleLogEntry = useCallback((data: any) => {
    const entry: LogEntry = {
      id: `ws-${++logIdCounter.current}`,
      timestamp: formatTimestamp(new Date()),
      level: ((data?.level || "info").toUpperCase() as Level),
      module: data?.module || data?.source || "sistema",
      message: data?.message || data?.msg || JSON.stringify(data),
    };
    setSocketLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > MAX_LOG_ENTRIES) return next.slice(-MAX_LOG_ENTRIES);
      return next;
    });
  }, []);

  useEffect(() => {
    on("log:entry", handleLogEntry);
    return () => {
      off("log:entry", handleLogEntry);
    };
  }, [on, off, handleLogEntry]);

  /* ── Merge API alerts + socket logs ── */
  const allLogs: LogEntry[] = useMemo(() => {
    const alertLogs = (apiAlerts || []).map(mapAlertToLog);
    return [...alertLogs, ...socketLogs];
  }, [apiAlerts, socketLogs]);

  /* ── Counts ── */
  const counts = useMemo(() => {
    const c = { INFO: 0, WARN: 0, ERROR: 0 };
    for (const log of allLogs) {
      c[log.level]++;
    }
    return c;
  }, [allLogs]);

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    let result = allLogs;
    if (filter !== "ALL") {
      result = result.filter((l) => l.level === filter);
    }
    if (moduleFilter.trim()) {
      const term = moduleFilter.toLowerCase();
      result = result.filter(
        (l) =>
          l.module.toLowerCase().includes(term) ||
          l.message.toLowerCase().includes(term)
      );
    }
    return result;
  }, [allLogs, filter, moduleFilter]);

  /* ── Auto-scroll ── */
  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [filtered, paused]);

  const filters: Filter[] = ["ALL", "INFO", "WARN", "ERROR"];

  const filterBtnClass = (f: Filter, active: boolean): string => {
    if (!active) return "text-muted-foreground hover:text-foreground";
    if (f === "ALL") return "text-primary bg-primary/10";
    return levelBg[f as Level] || "text-primary bg-primary/10";
  };

  const clearLogs = () => {
    setSocketLogs([]);
  };

  return (
    <div className="flex flex-col h-full -m-4 md:-m-5">
      {/* ── Top bar: filters + level counts ── */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`font-mono text-[10px] px-2 py-0.5 rounded-sm transition-colors ${filterBtnClass(f, filter === f)}`}
          >
            [{f}]
            {f !== "ALL" && (
              <span className="ml-1 opacity-70">{counts[f as Level]}</span>
            )}
          </button>
        ))}

        {/* Module filter input */}
        <input
          type="text"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          placeholder="filtrar modulo..."
          className="ml-2 font-mono text-[10px] px-2 py-0.5 bg-secondary rounded-sm border-none outline-none focus:ring-1 focus:ring-primary w-28 placeholder:text-muted-foreground/40"
        />

        <div className="flex-1" />

        {/* Level counts summary */}
        <div className="hidden md:flex items-center gap-2 mr-2">
          <span className="font-mono text-[10px] text-emerald-400">
            {counts.INFO} info
          </span>
          <span className="font-mono text-[10px] text-yellow-400">
            {counts.WARN} warn
          </span>
          <span className="font-mono text-[10px] text-red-400">
            {counts.ERROR} erro
          </span>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-1.5 mr-2">
          <div className={`dot ${connected ? "dot-ok" : "dot-off"}`} />
          <span className="font-mono text-[10px] text-muted-foreground">
            {connected ? "socket conectado" : "socket desconectado"}
          </span>
        </div>

        {loading && (
          <span className="font-mono text-[10px] text-muted-foreground animate-pulse mr-2">
            carregando...
          </span>
        )}

        {/* Actions */}
        <button
          onClick={clearLogs}
          className="font-mono text-[10px] px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors mr-1"
        >
          [limpar]
        </button>
        <button
          onClick={() => setPaused((p) => !p)}
          className={`font-mono text-[10px] px-2 py-0.5 rounded-sm transition-colors ${
            paused
              ? "text-yellow-400 bg-yellow-400/10"
              : "text-primary bg-primary/10"
          }`}
        >
          {paused ? "[retomar]" : "[pausar]"}
        </button>
      </div>

      {/* ── Log entries ── */}
      <div ref={containerRef} className="flex-1 overflow-y-auto bg-background">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full font-mono text-xs text-muted-foreground">
            sem entradas de log
            {filter !== "ALL" ? ` para [${filter}]` : ""}
            {moduleFilter ? ` com filtro "${moduleFilter}"` : ""}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className="flex items-baseline gap-2 px-3 py-0.5 font-mono text-xs hover:bg-secondary/30 transition-colors"
              style={{ borderBottom: "1px solid hsl(0 0% 5%)" }}
            >
              <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                {entry.timestamp}
              </span>
              <span
                className={`shrink-0 w-12 text-[10px] uppercase font-semibold text-center ${levelColor[entry.level]}`}
              >
                {entry.level}
              </span>
              <span className="text-blue-400 shrink-0 text-[11px] w-24 truncate">
                {entry.module}
              </span>
              <span className="text-foreground truncate">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`dot ${paused ? "dot-warn" : "dot-ok"}`} />
            <span className="font-mono text-[10px] text-muted-foreground">
              {paused ? "fluxo pausado" : "transmitindo ao vivo"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`dot ${connected ? "dot-ok" : "dot-err"}`} />
            <span className="font-mono text-[10px] text-muted-foreground">
              ws: {connected ? "on" : "off"}
            </span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          total: {allLogs.length} | exibindo: {filtered.length} |{" "}
          <span className="text-emerald-400">{counts.INFO}i</span>{" "}
          <span className="text-yellow-400">{counts.WARN}w</span>{" "}
          <span className="text-red-400">{counts.ERROR}e</span>
        </span>
      </div>
    </div>
  );
}
