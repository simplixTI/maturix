"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search, FileText, FolderOpen, RefreshCw, Loader2, Check, X,
  AlertTriangle, ExternalLink, Plus, Trash2, CheckCircle2,
  ChevronDown, Link2, Hash, Users, Filter,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/* ── Types ── */

interface SearchResult {
  inviteCode: string;
  inviteLink: string;
  title?: string;
  snippet?: string;
  groupName?: string;
  category?: string;
  memberCount?: number;
  niche: string;
  source: string;
}

interface DiscoveredGroup {
  id: string;
  inviteCode: string;
  inviteLink: string;
  groupName: string | null;
  description: string | null;
  memberCount: number | null;
  niche: string;
  source: string;
  isActive: boolean;
  lastChecked: string | null;
  createdAt: string;
}

interface NicheInfo {
  key: string;
  label: string;
  count: number;
}

interface ValidationResult {
  inviteCode: string;
  isActive: boolean;
  groupName?: string;
  description?: string;
  memberCount?: number;
  niche?: string;
}

/* ── Constants ── */

const NICHE_OPTIONS = [
  { value: "", label: "todos os nichos" },
  { value: "marketing_digital", label: "marketing digital" },
  { value: "vendas", label: "vendas" },
  { value: "crypto", label: "crypto" },
  { value: "fitness", label: "fitness" },
  { value: "ecommerce", label: "e-commerce" },
  { value: "emprego", label: "emprego" },
  { value: "educacao", label: "educacao" },
  { value: "culinaria", label: "culinaria" },
  { value: "religiao", label: "religiao" },
  { value: "investimentos", label: "investimentos" },
  { value: "tecnologia", label: "tecnologia" },
  { value: "saude", label: "saude" },
  { value: "moda", label: "moda" },
  { value: "musica", label: "musica" },
  { value: "esportes", label: "esportes" },
  { value: "geral", label: "geral" },
];

const SOURCE_OPTIONS = [
  { value: "free", label: "Todos (gratis)" },
  { value: "whatsgrouplink", label: "WhatsGroupLink" },
  { value: "appgrouplink", label: "AppGroupLink" },
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "bing", label: "Bing" },
  { value: "directory", label: "Diretorio BR" },
  { value: "google", label: "Google API (chave)" },
];

/* ── Component ── */

export default function DescobrirPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"buscar" | "colar" | "diretorio">("buscar");

  // Search tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchNiche, setSearchNiche] = useState("");
  const [searchSource, setSearchSource] = useState("free");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedProxy, setSelectedProxy] = useState("");
  const [proxies, setProxies] = useState<Array<{ id: string; host: string; port: number; protocol: string; username?: string; password?: string }>>([]);

  // Load proxies
  useEffect(() => {
    fetch(`${API_URL}/api/proxies`, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setProxies(data || []))
      .catch(() => {});
  }, []);

  // Paste tab state
  const [pasteText, setPasteText] = useState("");
  const [extractedLinks, setExtractedLinks] = useState<Array<{ inviteCode: string; inviteLink: string }>>([]);
  const [extracting, setExtracting] = useState(false);

  // Directory tab state
  const [dirCategory, setDirCategory] = useState("");
  const [dirPage, setDirPage] = useState(1);
  const [dirResults, setDirResults] = useState<SearchResult[]>([]);
  const [dirHasMore, setDirHasMore] = useState(false);
  const [dirLoading, setDirLoading] = useState(false);

  // Validation state
  const [validating, setValidating] = useState<Set<string>>(new Set());
  const [validationResults, setValidationResults] = useState<Map<string, ValidationResult>>(new Map());

  // Discovered groups table
  const [discoveredGroups, setDiscoveredGroups] = useState<DiscoveredGroup[]>([]);
  const [groupsTotal, setGroupsTotal] = useState(0);
  const [groupsPage, setGroupsPage] = useState(1);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsFilter, setGroupsFilter] = useState("");
  const [groupsActiveFilter, setGroupsActiveFilter] = useState<string>("");

  // Niches
  const [niches, setNiches] = useState<NicheInfo[]>([]);
  const [nicheStats, setNicheStats] = useState({ totalActive: 0, totalAll: 0 });

  // Bulk operations
  const [bulkValidating, setBulkValidating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Adding to warming
  const [addingToWarming, setAddingToWarming] = useState<Set<string>>(new Set());
  const [addedToWarming, setAddedToWarming] = useState<Set<string>>(new Set());

  const getHeaders = useCallback(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("maturador_token") : null;
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }, []);

  /* ── Fetch niches + discovered groups on mount ── */

  const fetchNiches = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/discovery/niches`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setNiches(data.niches || []);
        setNicheStats({ totalActive: data.totalActive || 0, totalAll: data.totalAll || 0 });
      }
    } catch {}
  }, [getHeaders]);

  const fetchGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", groupsPage.toString());
      params.set("limit", "30");
      if (groupsFilter) params.set("niche", groupsFilter);
      if (groupsActiveFilter) params.set("active", groupsActiveFilter);

      const res = await fetch(`${API_URL}/api/discovery/groups?${params}`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setDiscoveredGroups(data.groups || []);
        setGroupsTotal(data.total || 0);
      }
    } catch {}
    setGroupsLoading(false);
  }, [getHeaders, groupsPage, groupsFilter, groupsActiveFilter]);

  useEffect(() => { fetchNiches(); }, [fetchNiches]);
  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  /* ── Search tab ── */

  const handleSearch = async () => {
    if (!searchQuery.trim() && searchSource !== "directory") return;
    setSearching(true);
    setSearchError("");
    setSearchResults([]);

    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      params.set("source", searchSource);
      if (searchNiche) params.set("niche", searchNiche);
      if (selectedProxy) params.set("proxy", selectedProxy);

      const res = await fetch(`${API_URL}/api/discovery/search?${params}`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setSearchError(data.error || "erro na busca");
      }
    } catch {
      setSearchError("erro de conexao");
    }
    setSearching(false);
  };

  /* ── Paste tab ── */

  const handleExtract = async () => {
    if (!pasteText.trim()) return;
    setExtracting(true);
    setExtractedLinks([]);

    try {
      const res = await fetch(`${API_URL}/api/discovery/extract`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ text: pasteText }),
      });
      if (res.ok) {
        const data = await res.json();
        setExtractedLinks(data.links || []);
        fetchGroups();
        fetchNiches();
      }
    } catch {}
    setExtracting(false);
  };

  /* ── Directory tab ── */

  const handleDirSearch = async (resetPage = true) => {
    setDirLoading(true);
    const page = resetPage ? 1 : dirPage;
    if (resetPage) setDirPage(1);

    try {
      const params = new URLSearchParams();
      params.set("source", "directory");
      params.set("page", page.toString());
      if (dirCategory) params.set("niche", dirCategory);

      const res = await fetch(`${API_URL}/api/discovery/search?${params}`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (resetPage) {
          setDirResults(data.results || []);
        } else {
          setDirResults((prev) => [...prev, ...(data.results || [])]);
        }
        setDirHasMore(data.hasMore ?? false);
      }
    } catch {}
    setDirLoading(false);
  };

  const handleDirLoadMore = () => {
    setDirPage((p) => p + 1);
  };

  useEffect(() => {
    if (dirPage > 1) handleDirSearch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirPage]);

  /* ── Validation ── */

  const handleValidate = async (code: string) => {
    setValidating((prev) => new Set(prev).add(code));

    try {
      const res = await fetch(`${API_URL}/api/discovery/validate`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ links: [`https://chat.whatsapp.com/${code}`] }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results?.[0]) {
          setValidationResults((prev) => new Map(prev).set(code, data.results[0]));
        }
        fetchGroups();
        fetchNiches();
      }
    } catch {}

    setValidating((prev) => {
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
  };

  const handleSaveOne = async (link: string) => {
    try {
      const res = await fetch(`${API_URL}/api/discovery/save-validated`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ links: [link] }),
      });
      if (res.ok) {
        const data = await res.json();
        for (const r of (data.results || [])) {
          setValidationResults(prev => new Map(prev).set(r.inviteCode, r));
        }
      }
      fetchGroups();
      fetchNiches();
    } catch {}
  };

  const handleBulkValidate = async () => {
    if (discoveredGroups.length === 0) return;
    setBulkValidating(true);

    const links = discoveredGroups.map((g) => g.inviteLink);
    const batchSize = 10;

    for (let i = 0; i < links.length; i += batchSize) {
      const batch = links.slice(i, i + batchSize);
      try {
        await fetch(`${API_URL}/api/discovery/save-validated`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ links: batch }),
        });
      } catch {}
    }

    fetchGroups();
    fetchNiches();
    setBulkValidating(false);
  };

  // Save + validate: only saves groups that are ACTIVE (validated via Baileys)
  const handleSaveAndValidateAll = async () => {
    if (searchResults.length === 0) return;
    setSaving(true);
    setSaveProgress({ done: 0, total: searchResults.length, active: 0, dead: 0 });

    const allLinks = searchResults.map(r => r.inviteLink);
    const batchSize = 10;

    let totalActive = 0;
    let totalDead = 0;

    for (let i = 0; i < allLinks.length; i += batchSize) {
      const batch = allLinks.slice(i, i + batchSize);
      try {
        const res = await fetch(`${API_URL}/api/discovery/save-validated`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ links: batch }),
        });
        if (res.ok) {
          const data = await res.json();
          totalActive += data.active || 0;
          totalDead += data.dead || 0;
          // Update validation results inline
          for (const r of (data.results || [])) {
            setValidationResults(prev => new Map(prev).set(r.inviteCode, r));
          }
        }
      } catch {}
      setSaveProgress({ done: Math.min(i + batchSize, allLinks.length), total: allLinks.length, active: totalActive, dead: totalDead });
    }

    fetchGroups();
    fetchNiches();
    setSaving(false);
    setSaveProgress(null);
  };

  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number; active: number; dead: number } | null>(null);

  /* ── Add to warming ── */

  const handleAddToWarming = async (id: string) => {
    setAddingToWarming((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`${API_URL}/api/discovery/groups/${id}/add-to-warming`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setAddedToWarming((prev) => new Set(prev).add(id));
      }
    } catch {}
    setAddingToWarming((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleBulkAddToWarming = async () => {
    const ids = selectedIds.size > 0
      ? Array.from(selectedIds)
      : discoveredGroups.filter((g) => g.isActive).map((g) => g.id);

    for (const id of ids) {
      await handleAddToWarming(id);
    }
    setSelectedIds(new Set());
  };

  /* ── Remove ── */

  const handleRemove = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/discovery/groups/${id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      fetchGroups();
      fetchNiches();
    } catch {}
  };

  /* ── Delete all ── */

  const [deletingAll, setDeletingAll] = useState(false);

  const handleDeleteAll = async () => {
    if (!confirm("tem certeza que deseja deletar TODOS os grupos descobertos?")) return;
    setDeletingAll(true);
    try {
      await fetch(`${API_URL}/api/discovery/groups/all`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      fetchGroups();
      fetchNiches();
    } catch {}
    setDeletingAll(false);
  };

  /* ── Selection ── */

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === discoveredGroups.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(discoveredGroups.map((g) => g.id)));
    }
  };

  /* ── Helpers ── */

  const nicheLabel = (key: string) => NICHE_OPTIONS.find((n) => n.value === key)?.label || key;

  const formatDate = (d: string | null) => {
    if (!d) return "--";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  const getValidationStatus = (code: string) => {
    const r = validationResults.get(code);
    if (!r) return null;
    return r.isActive;
  };

  /* ── Render ── */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-primary" />
          <span className="font-mono text-xs font-semibold">descobrir grupos</span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[10px] text-muted-foreground">
          <span>{nicheStats.totalActive} ativos</span>
          <span>{nicheStats.totalAll} total</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border border-border rounded overflow-hidden">
        {([
          { key: "buscar" as const, label: "buscar", icon: Search },
          { key: "colar" as const, label: "colar texto", icon: FileText },
          { key: "diretorio" as const, label: "diretorio", icon: FolderOpen },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 font-mono text-xs transition-colors flex-1 justify-center border-r border-border last:border-r-0 ${
              activeTab === key
                ? "bg-primary/10 text-primary"
                : "bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="border border-border rounded p-4 min-h-[300px]">
        {/* ── Tab: Buscar ── */}
        {activeTab === "buscar" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              {/* Niche selector */}
              <div>
                <div className="term-label mb-1.5">nicho</div>
                <select
                  value={searchNiche}
                  onChange={(e) => setSearchNiche(e.target.value)}
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border border-border outline-none focus:ring-1 focus:ring-primary min-w-[160px]"
                >
                  {NICHE_OPTIONS.map((n) => (
                    <option key={n.value} value={n.value}>{n.label}</option>
                  ))}
                </select>
              </div>

              {/* Search input */}
              <div className="flex-1 min-w-[200px]">
                <div className="term-label mb-1.5">palavras-chave</div>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ex: marketing digital, vendas online..."
                  className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border border-border outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                />
              </div>

              {/* Source */}
              <div>
                <div className="term-label mb-1.5">fonte</div>
                <select
                  value={searchSource}
                  onChange={(e) => setSearchSource(e.target.value)}
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border border-border outline-none focus:ring-1 focus:ring-primary"
                >
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              {/* Proxy */}
              <div>
                <div className="term-label mb-1.5">proxy</div>
                <select
                  value={selectedProxy}
                  onChange={(e) => setSelectedProxy(e.target.value)}
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border border-border outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">sem proxy</option>
                  {proxies.map((p) => (
                    <option key={p.id} value={`${p.protocol.toLowerCase()}://${p.username ? `${p.username}:${p.password}@` : ''}${p.host}:${p.port}`}>
                      {p.host}:{p.port} ({p.protocol})
                    </option>
                  ))}
                </select>
              </div>

              {/* Search button */}
              <button
                onClick={handleSearch}
                disabled={searching}
                className="flex items-center gap-1.5 font-mono text-xs bg-primary text-primary-foreground px-5 py-2 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                buscar
              </button>
            </div>

            {searchError && (
              <div className="flex items-center gap-2 font-mono text-xs text-red-400 bg-red-400/5 border border-red-400/20 px-3 py-2 rounded-sm">
                <AlertTriangle size={12} /> {searchError}
              </div>
            )}

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                    {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""} | {Array.from(validationResults.values()).filter(v => v.isActive).length} ativos | {Array.from(validationResults.values()).filter(v => !v.isActive).length} mortos
                  </div>
                  <div className="flex gap-1.5 items-center">
                    {saveProgress && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {saveProgress.done}/{saveProgress.total} -- {saveProgress.active} ativos, {saveProgress.dead} mortos
                      </span>
                    )}
                    <button onClick={handleSaveAndValidateAll} disabled={saving}
                      className="font-mono text-[10px] px-2 py-0.5 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50">
                      {saving ? "[validando e salvando...]" : "[validar e salvar ativos]"}
                    </button>
                  </div>
                </div>
                <div className="border border-border rounded overflow-hidden max-h-[400px] overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <div
                      key={r.inviteCode}
                      className={`flex items-center gap-3 px-3 py-2.5 ${i % 2 === 0 ? "" : "bg-secondary/20"} border-b border-border/50 last:border-b-0`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[11px] truncate">
                          {validationResults.get(r.inviteCode)?.groupName || r.title || r.groupName || r.inviteCode}
                        </div>
                        {validationResults.get(r.inviteCode)?.description && (
                          <div className="font-mono text-[10px] text-muted-foreground truncate mt-0.5">
                            {validationResults.get(r.inviteCode)?.description}
                          </div>
                        )}
                        {!validationResults.get(r.inviteCode)?.description && r.snippet && (
                          <div className="font-mono text-[10px] text-muted-foreground truncate mt-0.5">
                            {r.snippet}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                            {validationResults.get(r.inviteCode)?.niche ? nicheLabel(validationResults.get(r.inviteCode)!.niche!) : nicheLabel(r.niche)}
                          </span>
                          {(validationResults.get(r.inviteCode)?.memberCount || r.memberCount) && (
                            <span className="font-mono text-[9px] text-muted-foreground flex items-center gap-0.5">
                              <Users size={8} /> {validationResults.get(r.inviteCode)?.memberCount || r.memberCount}
                            </span>
                          )}
                          <span className="font-mono text-[9px] text-muted-foreground">{r.source}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {validating.has(r.inviteCode) ? (
                          <Loader2 size={11} className="text-muted-foreground animate-spin" />
                        ) : getValidationStatus(r.inviteCode) === true ? (
                          <span className="flex items-center gap-0.5 font-mono text-[9px] text-green-400">
                            <CheckCircle2 size={11} /> salvo
                          </span>
                        ) : getValidationStatus(r.inviteCode) === false ? (
                          <span className="flex items-center gap-0.5 font-mono text-[9px] text-red-400">
                            <X size={11} /> morto
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSaveOne(r.inviteLink)}
                            className="font-mono text-[10px] text-primary hover:bg-primary/10 px-2 py-1 border border-primary/30 rounded-sm transition-colors"
                            title="validar e salvar"
                          >
                            salvar
                          </button>
                        )}
                        <a
                          href={r.inviteLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="abrir link"
                        >
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Colar texto ── */}
        {activeTab === "colar" && (
          <div className="space-y-4">
            <div>
              <div className="term-label mb-1.5">cole qualquer texto contendo links de grupos do whatsapp</div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"Cole aqui textos, emails, mensagens, posts...\nTodos os links chat.whatsapp.com serao extraidos automaticamente."}
                rows={8}
                className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border border-border outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40 resize-none"
              />
            </div>

            <button
              onClick={handleExtract}
              disabled={extracting || !pasteText.trim()}
              className="flex items-center gap-1.5 font-mono text-xs bg-primary text-primary-foreground px-5 py-2 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {extracting ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              extrair links
            </button>

            {extractedLinks.length > 0 && (
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                  {extractedLinks.length} link{extractedLinks.length !== 1 ? "s" : ""} extraido{extractedLinks.length !== 1 ? "s" : ""}
                </div>
                <div className="border border-border rounded overflow-hidden max-h-60 overflow-y-auto">
                  {extractedLinks.map((link, i) => (
                    <div
                      key={link.inviteCode}
                      className={`flex items-center justify-between gap-3 px-3 py-2 ${i % 2 === 0 ? "" : "bg-secondary/20"} border-b border-border/50 last:border-b-0`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Link2 size={10} className="text-muted-foreground shrink-0" />
                        <span className="font-mono text-[11px] truncate">{link.inviteLink}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {validating.has(link.inviteCode) ? (
                          <Loader2 size={11} className="text-muted-foreground animate-spin" />
                        ) : getValidationStatus(link.inviteCode) === true ? (
                          <CheckCircle2 size={11} className="text-green-400" />
                        ) : getValidationStatus(link.inviteCode) === false ? (
                          <X size={11} className="text-red-400" />
                        ) : null}
                        <button
                          onClick={() => handleValidate(link.inviteCode)}
                          disabled={validating.has(link.inviteCode)}
                          className="font-mono text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded-sm transition-colors"
                        >
                          validar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Diretorio ── */}
        {activeTab === "diretorio" && (
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div>
                <div className="term-label mb-1.5">categoria</div>
                <select
                  value={dirCategory}
                  onChange={(e) => setDirCategory(e.target.value)}
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border border-border outline-none focus:ring-1 focus:ring-primary min-w-[180px]"
                >
                  {NICHE_OPTIONS.map((n) => (
                    <option key={n.value} value={n.value}>{n.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => handleDirSearch(true)}
                disabled={dirLoading}
                className="flex items-center gap-1.5 font-mono text-xs bg-primary text-primary-foreground px-5 py-2 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {dirLoading ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
                buscar no diretorio
              </button>
            </div>

            {dirResults.length > 0 && (
              <div className="space-y-2">
                <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                  {dirResults.length} grupo{dirResults.length !== 1 ? "s" : ""}
                </div>
                <div className="border border-border rounded overflow-hidden max-h-[400px] overflow-y-auto">
                  {dirResults.map((r, i) => (
                    <div
                      key={`${r.inviteCode}-${i}`}
                      className={`flex items-center gap-3 px-3 py-2.5 ${i % 2 === 0 ? "" : "bg-secondary/20"} border-b border-border/50 last:border-b-0`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[11px] truncate">
                          {r.groupName || r.inviteCode}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                            {nicheLabel(r.niche)}
                          </span>
                          {r.memberCount && (
                            <span className="font-mono text-[9px] text-muted-foreground flex items-center gap-0.5">
                              <Users size={8} /> {r.memberCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {validating.has(r.inviteCode) ? (
                          <Loader2 size={11} className="text-muted-foreground animate-spin" />
                        ) : getValidationStatus(r.inviteCode) === true ? (
                          <CheckCircle2 size={11} className="text-green-400" />
                        ) : getValidationStatus(r.inviteCode) === false ? (
                          <X size={11} className="text-red-400" />
                        ) : null}
                        <button
                          onClick={() => handleValidate(r.inviteCode)}
                          disabled={validating.has(r.inviteCode)}
                          className="font-mono text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded-sm transition-colors"
                        >
                          validar
                        </button>
                        <a
                          href={r.inviteLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>

                {dirHasMore && (
                  <button
                    onClick={handleDirLoadMore}
                    disabled={dirLoading}
                    className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground px-4 py-2 border border-border rounded-sm transition-colors w-full justify-center"
                  >
                    {dirLoading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
                    carregar mais
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Discovered Groups Table ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Hash size={12} className="text-primary" />
            <span className="font-mono text-xs font-semibold">grupos descobertos</span>
            <span className="font-mono text-[10px] text-muted-foreground">({groupsTotal})</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Niche filter */}
            <div className="flex items-center gap-1.5">
              <Filter size={10} className="text-muted-foreground" />
              <select
                value={groupsFilter}
                onChange={(e) => { setGroupsFilter(e.target.value); setGroupsPage(1); }}
                className="bg-secondary font-mono text-[10px] px-2 py-1 rounded-sm border border-border outline-none"
              >
                {NICHE_OPTIONS.map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </select>
            </div>

            {/* Active filter */}
            <select
              value={groupsActiveFilter}
              onChange={(e) => { setGroupsActiveFilter(e.target.value); setGroupsPage(1); }}
              className="bg-secondary font-mono text-[10px] px-2 py-1 rounded-sm border border-border outline-none"
            >
              <option value="">todos status</option>
              <option value="true">ativos</option>
              <option value="false">inativos</option>
            </select>

            {/* Bulk actions */}
            <button
              onClick={handleBulkValidate}
              disabled={bulkValidating || discoveredGroups.length === 0}
              className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded-sm transition-colors disabled:opacity-50"
            >
              {bulkValidating ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
              validar todos
            </button>

            <button
              onClick={handleBulkAddToWarming}
              disabled={discoveredGroups.filter((g) => g.isActive).length === 0}
              className="flex items-center gap-1 font-mono text-[10px] text-primary hover:text-primary/80 px-2 py-1 border border-primary/20 rounded-sm transition-colors disabled:opacity-50"
            >
              <Plus size={10} />
              adicionar ativos ao aquecimento
            </button>

            <button
              onClick={handleDeleteAll}
              disabled={deletingAll || groupsTotal === 0}
              className="flex items-center gap-1 font-mono text-[10px] text-red-400/70 hover:text-red-400 px-2 py-1 border border-red-400/20 hover:border-red-400/40 rounded-sm transition-colors disabled:opacity-50"
            >
              {deletingAll ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
              deletar todos
            </button>

            <button
              onClick={fetchGroups}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw size={11} className={groupsLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Niche stats bar */}
        {niches.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {niches.filter((n) => n.count > 0).map((n) => (
              <button
                key={n.key}
                onClick={() => { setGroupsFilter(n.key); setGroupsPage(1); }}
                className={`font-mono text-[9px] px-2 py-0.5 rounded border transition-colors ${
                  groupsFilter === n.key
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {n.label} ({n.count})
              </button>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="border border-border rounded overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[32px_1fr_100px_70px_80px_80px_100px] gap-0 bg-secondary/50 border-b border-border text-muted-foreground">
            <div className="flex items-center justify-center px-2 py-2">
              <input
                type="checkbox"
                checked={selectedIds.size === discoveredGroups.length && discoveredGroups.length > 0}
                onChange={toggleSelectAll}
                className="w-3 h-3 accent-primary"
              />
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest px-3 py-2">grupo</div>
            <div className="font-mono text-[10px] uppercase tracking-widest px-2 py-2">nicho</div>
            <div className="font-mono text-[10px] uppercase tracking-widest px-2 py-2">membros</div>
            <div className="font-mono text-[10px] uppercase tracking-widest px-2 py-2">fonte</div>
            <div className="font-mono text-[10px] uppercase tracking-widest px-2 py-2">status</div>
            <div className="font-mono text-[10px] uppercase tracking-widest px-2 py-2">acoes</div>
          </div>

          {/* Rows */}
          {groupsLoading ? (
            <div className="px-4 py-8 text-center font-mono text-xs text-muted-foreground animate-pulse">
              carregando...
            </div>
          ) : discoveredGroups.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono text-xs text-muted-foreground">
              nenhum grupo descoberto ainda
            </div>
          ) : (
            discoveredGroups.map((g, i) => (
              <div
                key={g.id}
                className={`grid grid-cols-[32px_1fr_100px_70px_80px_80px_100px] gap-0 border-b border-border/50 last:border-b-0 ${
                  i % 2 === 0 ? "" : "bg-secondary/10"
                } hover:bg-secondary/20 transition-colors`}
              >
                <div className="flex items-center justify-center px-2 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(g.id)}
                    onChange={() => toggleSelect(g.id)}
                    className="w-3 h-3 accent-primary"
                  />
                </div>
                <div className="flex items-center gap-2 px-3 py-2 min-w-0">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] truncate" title={g.groupName || g.inviteCode}>
                      {g.groupName || g.inviteCode}
                    </div>
                    <div className="font-mono text-[9px] text-muted-foreground truncate">
                      {formatDate(g.createdAt)}
                      {g.lastChecked && ` -- checado ${formatDate(g.lastChecked)}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center px-2 py-2">
                  <span className="font-mono text-[9px] px-1.5 py-0.5 bg-primary/10 text-primary rounded truncate">
                    {nicheLabel(g.niche)}
                  </span>
                </div>
                <div className="flex items-center px-2 py-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {g.memberCount ?? "--"}
                  </span>
                </div>
                <div className="flex items-center px-2 py-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {g.source}
                  </span>
                </div>
                <div className="flex items-center px-2 py-2">
                  {g.isActive ? (
                    <span className="flex items-center gap-1 font-mono text-[10px] text-green-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400" /> ativo
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 font-mono text-[10px] text-red-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400" /> morto
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 px-2 py-2">
                  <button
                    onClick={() => handleValidate(g.inviteCode)}
                    disabled={validating.has(g.inviteCode)}
                    className="font-mono text-[9px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 border border-border rounded transition-colors"
                    title="validar"
                  >
                    {validating.has(g.inviteCode) ? (
                      <Loader2 size={9} className="animate-spin" />
                    ) : (
                      <Check size={9} />
                    )}
                  </button>
                  {g.isActive && !addedToWarming.has(g.id) && (
                    <button
                      onClick={() => handleAddToWarming(g.id)}
                      disabled={addingToWarming.has(g.id)}
                      className="font-mono text-[9px] text-primary hover:text-primary/80 px-1.5 py-0.5 border border-primary/20 rounded transition-colors"
                      title="adicionar ao aquecimento"
                    >
                      {addingToWarming.has(g.id) ? (
                        <Loader2 size={9} className="animate-spin" />
                      ) : (
                        <Plus size={9} />
                      )}
                    </button>
                  )}
                  {addedToWarming.has(g.id) && (
                    <CheckCircle2 size={10} className="text-green-400" />
                  )}
                  <button
                    onClick={() => handleRemove(g.id)}
                    className="font-mono text-[9px] text-red-400/50 hover:text-red-400 px-1.5 py-0.5 border border-red-400/10 hover:border-red-400/30 rounded transition-colors"
                    title="remover"
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {groupsTotal > 30 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setGroupsPage((p) => Math.max(1, p - 1))}
              disabled={groupsPage === 1}
              className="font-mono text-[10px] text-muted-foreground hover:text-foreground px-3 py-1 border border-border rounded-sm transition-colors disabled:opacity-30"
            >
              anterior
            </button>
            <span className="font-mono text-[10px] text-muted-foreground">
              pagina {groupsPage} de {Math.ceil(groupsTotal / 30)}
            </span>
            <button
              onClick={() => setGroupsPage((p) => p + 1)}
              disabled={groupsPage >= Math.ceil(groupsTotal / 30)}
              className="font-mono text-[10px] text-muted-foreground hover:text-foreground px-3 py-1 border border-border rounded-sm transition-colors disabled:opacity-30"
            >
              proxima
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
