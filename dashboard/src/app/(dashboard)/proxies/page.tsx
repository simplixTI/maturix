"use client";

import { useState, useCallback } from "react";
import {
  Globe, Plus, Upload, Play, Trash2, RotateCw, Zap, Shield,
} from "lucide-react";
import { useProxies } from "@/hooks/useApi";
import { proxies as proxiesApi } from "@/lib/api";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ProxyItem } from "@/lib/api";

/* ── types + mock data ── */

interface Proxy {
  id: string;
  host: string;
  port: number;
  user: string;
  type: "HTTP" | "SOCKS5";
  latency: number;
  status: "ok" | "slow" | "down" | "unchecked";
  accounts: number;
}

const mockProxies: Proxy[] = [
  { id: "1", host: "proxy-br-01.net", port: 8080, user: "usr_br01", type: "HTTP", latency: 24, status: "ok", accounts: 4 },
  { id: "2", host: "socks.datacenter.io", port: 1080, user: "dc_user", type: "SOCKS5", latency: 38, status: "ok", accounts: 6 },
  { id: "3", host: "res-proxy.mobile.br", port: 3128, user: "mob_01", type: "HTTP", latency: 87, status: "slow", accounts: 3 },
  { id: "4", host: "192.168.50.12", port: 9050, user: "local", type: "SOCKS5", latency: 12, status: "ok", accounts: 5 },
  { id: "5", host: "us-east.proxy.sh", port: 8888, user: "east_1", type: "HTTP", latency: 156, status: "slow", accounts: 2 },
  { id: "6", host: "eu-west.rotating.io", port: 4145, user: "rot_eu", type: "SOCKS5", latency: 210, status: "slow", accounts: 1 },
  { id: "7", host: "br-sp.residential.net", port: 8080, user: "sp_res", type: "HTTP", latency: 45, status: "ok", accounts: 7 },
  { id: "8", host: "failover.proxy.br", port: 3128, user: "fail_1", type: "HTTP", latency: 0, status: "down", accounts: 0 },
  { id: "9", host: "socks5.premium.io", port: 1080, user: "prem_s5", type: "SOCKS5", latency: 31, status: "ok", accounts: 4 },
  { id: "10", host: "new-proxy.test.br", port: 8080, user: "", type: "HTTP", latency: 0, status: "unchecked", accounts: 0 },
];

function mapApiProxy(p: Record<string, unknown>): Proxy {
  const latency = p.responseTimeMs ?? p.latency ?? 0;
  const lastChecked = p.lastCheckedAt ?? p.lastChecked;
  let status: Proxy["status"] = "unchecked";
  if (lastChecked) {
    status = !p.isHealthy ? "down" : latency > 200 ? "slow" : latency > 0 ? "ok" : "unchecked";
  }
  return {
    id: p.id,
    host: p.host,
    port: p.port,
    user: p.username ?? "",
    type: (p.protocol?.toUpperCase() === "SOCKS5" ? "SOCKS5" : "HTTP") as "HTTP" | "SOCKS5",
    latency,
    status,
    accounts: p._count?.assignedAccounts ?? 0,
  };
}

const statusDot: Record<string, string> = {
  ok: "dot-ok",
  slow: "dot-warn",
  down: "dot-err",
  unchecked: "dot-off",
};

/* ── page ── */

export default function ProxiesPage() {
  const { data: apiProxies, loading, refetch } = useProxies();

  const isLive = apiProxies !== null;
  const proxies: Proxy[] = apiProxies ? apiProxies.map(mapApiProxy) : mockProxies;

  const [showBulk, setShowBulk] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState({ current: 0, total: 0 });

  const healthy = proxies.filter((p) => p.status === "ok").length;
  const slow = proxies.filter((p) => p.status === "slow").length;
  const down = proxies.filter((p) => p.status === "down").length;
  const totalAccounts = proxies.reduce((s, p) => s + p.accounts, 0);

  // Parse proxy URL like: http://user:pass@host:port or socks5://user:pass@host:port
  const parseProxyUrl = (url: string) => {
    try {
      // Handle format: protocol://user:pass@host:port
      const match = url.match(/^(https?|socks[45]):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/i);
      if (match) {
        return {
          protocol: match[1].toUpperCase() as "HTTP" | "HTTPS" | "SOCKS4" | "SOCKS5",
          username: match[2] || undefined,
          password: match[3] || undefined,
          host: match[4],
          port: parseInt(match[5], 10),
        };
      }
      // Handle format: host:port:user:pass
      const parts = url.split(":");
      if (parts.length >= 2) {
        return {
          protocol: "HTTP" as const,
          host: parts[0],
          port: parseInt(parts[1], 10),
          username: parts[2] || undefined,
          password: parts[3] || undefined,
        };
      }
    } catch {}
    return null;
  };

  const handleAdd = useCallback(async () => {
    if (!addUrl.trim()) return;
    setAddSaving(true);
    const parsed = parseProxyUrl(addUrl.trim());
    if (!parsed) {
      setAddSaving(false);
      return;
    }
    const result = await proxiesApi.add(parsed);
    if (result) {
      refetch();
      setAddUrl("");
      setShowAdd(false);
    }
    setAddSaving(false);
  }, [addUrl, refetch]);

  const handleBulkImport = useCallback(async () => {
    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;

    const result = await proxiesApi.bulkImport(lines);
    if (result) {
      refetch();
    }
    setBulkText("");
    setShowBulk(false);
  }, [bulkText, refetch]);

  const handleDelete = useCallback(async (id: string) => {
    const result = await proxiesApi.delete(id);
    if (result?.success) {
      refetch();
    }
  }, [refetch]);

  const handleTestAll = useCallback(async () => {
    setTesting(true);
    setTestProgress({ current: 0, total: proxies.length });

    const result = await proxiesApi.testAll();
    if (result) {
      // API returns immediately with "checking" status - we simulate progress then refetch
      let i = 0;
      const interval = setInterval(() => {
        i++;
        setTestProgress({ current: i, total: proxies.length });
        if (i >= proxies.length) {
          clearInterval(interval);
          setTesting(false);
          refetch();
        }
      }, 300);
    } else {
      // Fallback mock test behavior
      let i = 0;
      const interval = setInterval(() => {
        i++;
        setTestProgress({ current: i, total: proxies.length });
        if (i >= proxies.length) {
          clearInterval(interval);
          setTesting(false);
        }
      }, 300);
    }
  }, [proxies.length, refetch]);

  const latencyColor = (ms: number) => {
    if (ms === 0) return "text-muted-foreground";
    if (ms < 50) return "text-primary";
    if (ms <= 200) return "text-yellow-400";
    return "text-red-400";
  };

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

      {/* Stats */}
      <div className="grid grid-cols-5 gap-px bg-border rounded overflow-hidden">
        <StatCell icon={Globe} label="TOTAL" value={String(proxies.length)} />
        <StatCell icon={Shield} label="SAUDAVEIS" value={String(healthy)} accent />
        <StatCell icon={Zap} label="LENTOS" value={String(slow)} warn />
        <StatCell icon={Trash2} label="FORA" value={String(down)} danger />
        <StatCell label="ATRIBUIDOS" value={String(totalAccounts)} />
      </div>

      {/* Add proxy form */}
      {showAdd && (
        <div className="border border-border rounded p-3 space-y-2">
          <div className="term-label">cole a URL do proxy</div>
          <div className="font-mono text-[9px] text-muted-foreground">
            formatos aceitos: http://user:pass@host:port | socks5://user:pass@host:port | host:port:user:pass
          </div>
          <input
            value={addUrl}
            onChange={e => setAddUrl(e.target.value)}
            placeholder="http://geonode_user-type-residential:pass@proxy.geonode.io:9000"
            className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          />
          {addUrl && parseProxyUrl(addUrl) && (
            <div className="font-mono text-[10px] text-muted-foreground border border-border rounded p-2 space-y-0.5">
              <div>protocolo: <span className="text-foreground">{parseProxyUrl(addUrl)?.protocol}</span></div>
              <div>host: <span className="text-foreground">{parseProxyUrl(addUrl)?.host}</span></div>
              <div>porta: <span className="text-foreground">{parseProxyUrl(addUrl)?.port}</span></div>
              <div>usuario: <span className="text-foreground">{parseProxyUrl(addUrl)?.username || "nenhum"}</span></div>
            </div>
          )}
          {addUrl && !parseProxyUrl(addUrl) && (
            <div className="font-mono text-[10px] text-red-400">formato invalido</div>
          )}
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={addSaving || !parseProxyUrl(addUrl)}
              className="font-mono text-[10px] px-3 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-50">{addSaving ? "salvando..." : "[salvar]"}</button>
            <button onClick={() => { setShowAdd(false); setAddUrl(""); }}
              className="font-mono text-[10px] px-3 py-1 rounded border border-border text-muted-foreground hover:text-foreground">[cancelar]</button>
          </div>
        </div>
      )}

      {/* Actions bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="font-mono text-xs px-2 py-0.5 rounded text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
        >
          <Plus size={11} />
          [+ adicionar]
        </button>
        <button
          onClick={() => setShowBulk(true)}
          className="font-mono text-xs px-2 py-0.5 rounded text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
        >
          <Upload size={11} />
          [importar em massa]
        </button>
        <button
          onClick={handleTestAll}
          disabled={testing}
          className="font-mono text-xs px-2 py-0.5 rounded text-primary hover:bg-primary/10 transition-colors flex items-center gap-1 disabled:opacity-40"
        >
          <Play size={11} />
          [testar todos]
        </button>
        {testing && (
          <span className="font-mono text-[10px] text-muted-foreground">
            testando {testProgress.current}/{testProgress.total}...
          </span>
        )}
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-muted-foreground">
          latencia media: {proxies.filter((p) => p.latency > 0).length > 0
            ? Math.round(
                proxies.filter((p) => p.latency > 0).reduce((s, p) => s + p.latency, 0) /
                  proxies.filter((p) => p.latency > 0).length
              )
            : 0}ms
        </span>
      </div>

      {/* Proxy table */}
      <div>
        <div className="section-line">pool de proxies</div>
        <div className="border border-border rounded overflow-hidden">
          {/* Header */}
          <div className="term-row text-muted-foreground text-[10px] uppercase tracking-widest bg-secondary/50">
            <span className="w-4" />
            <span className="flex-1">host:port</span>
            <span className="w-14 text-center">tipo</span>
            <span className="w-16 text-right">latencia</span>
            <span className="w-16 text-right">contas</span>
            <span className="w-20 text-right">acoes</span>
          </div>
          {/* Rows */}
          {proxies.map((p) => (
            <div key={p.id} className="term-row group">
              <div className={`dot ${statusDot[p.status]}`} />
              <span className="flex-1 font-mono text-xs">
                {p.host}:{p.port}
                {p.user && (
                  <span className="text-muted-foreground ml-2">@{p.user}</span>
                )}
              </span>
              <span
                className={`w-14 text-center font-mono text-xs ${
                  p.type === "SOCKS5" ? "text-primary" : "text-foreground"
                }`}
              >
                {p.type}
              </span>
              <span className={`w-16 text-right font-mono text-xs ${latencyColor(p.latency)}`}>
                {p.latency > 0 ? `${p.latency}ms` : "--"}
              </span>
              <span className="w-16 text-right font-mono text-xs text-muted-foreground">
                {p.accounts > 0 ? p.accounts : "--"}
              </span>
              <span className="w-20 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="text-muted-foreground hover:text-primary transition-colors p-0.5"
                  title="Retestar"
                >
                  <RotateCw size={11} />
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="text-muted-foreground hover:text-red-400 transition-colors p-0.5"
                  title="Remover"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bulk import overlay */}
      {showBulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-background border border-border rounded w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="font-mono text-xs text-primary">importar proxies em massa</span>
              <button
                onClick={() => setShowBulk(false)}
                className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                [x]
              </button>
            </div>
            <div className="p-3 space-y-3">
              <div className="font-mono text-[10px] text-muted-foreground">
                cole um proxy por linha &mdash; formato: host:port:user:pass
              </div>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="w-full h-[180px] bg-secondary/50 border border-border rounded p-2 font-mono text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                placeholder={"proxy1.example.com:8080:user1:pass1\nproxy2.example.com:3128:user2:pass2\n192.168.1.100:1080"}
                spellCheck={false}
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {bulkText.split("\n").filter((l) => l.trim()).length} linhas detectadas
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowBulk(false)}
                    className="font-mono text-xs px-2 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    [cancelar]
                  </button>
                  <button
                    onClick={handleBulkImport}
                    className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    [importar]
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── helpers ── */

function StatCell({
  icon: Icon,
  label,
  value,
  accent,
  warn,
  danger,
}: {
  icon?: React.ComponentType<Record<string, unknown>>;
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="bg-background px-3 py-2.5">
      <div className="flex items-center gap-1 term-label">
        {Icon && <Icon size={10} />}
        {label}
      </div>
      <div
        className={`font-mono text-lg font-semibold tabular-nums ${
          danger ? "text-red-400" : warn ? "text-yellow-400" : accent ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
