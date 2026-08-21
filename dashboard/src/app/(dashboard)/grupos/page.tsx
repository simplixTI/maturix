"use client";

import { useState, useEffect, useCallback } from "react";
import {
  UsersRound, RefreshCw, Copy, Check, LogOut as LeaveIcon,
  Send, Plus, Link2, Loader2, AlertTriangle, Shield, ShieldCheck,
  User, X, ChevronRight,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface GroupInfo {
  jid: string;
  subject: string;
  owner: string;
  desc: string;
  participantCount: number;
  creation: number;
  myRole: string;
}

interface GroupMeta {
  jid: string;
  subject: string;
  owner: string;
  desc: string;
  participants: { jid: string; admin: string | null }[];
  creation: number;
}

interface Account {
  id: string;
  phoneNumber: string;
  status: string;
}

function formatPhone(p: string): string {
  const clean = p.replace(/:.*@.*/, "").replace(/@.*/, "");
  if (clean.length >= 12) return `+${clean.slice(0, 2)} ${clean.slice(2, 4)} ${clean.slice(4, 9)}-${clean.slice(9)}`;
  return clean || p;
}

export default function GruposPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<GroupInfo | null>(null);
  const [groupMeta, setGroupMeta] = useState<GroupMeta | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinResult, setJoinResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [createName, setCreateName] = useState("");
  const [createParticipants, setCreateParticipants] = useState("");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const getHeaders = useCallback(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("maturador_token") : null;
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }, []);

  // Fetch connected accounts
  useEffect(() => {
    fetch(`${API_URL}/api/send/accounts`, { headers: getHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then((data: Account[]) => {
        setAccounts(data);
        if (data.length > 0 && !selectedAccountId) setSelectedAccountId(data[0].id);
      })
      .catch(() => {});
  }, [getHeaders, selectedAccountId]);

  // Fetch groups when account changes
  const fetchGroups = useCallback(async () => {
    if (!selectedAccountId) return;
    setLoading(true);
    setError("");
    setSelectedGroup(null);
    setGroupMeta(null);
    setInviteLink("");

    try {
      const res = await fetch(`${API_URL}/api/groups/${selectedAccountId}`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "erro ao buscar grupos");
        setGroups([]);
      }
    } catch {
      setError("erro de conexao");
      setGroups([]);
    }
    setLoading(false);
  }, [selectedAccountId, getHeaders]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // Fetch group metadata
  const fetchMeta = async (group: GroupInfo) => {
    setSelectedGroup(group);
    setGroupMeta(null);
    setInviteLink("");
    setCopied(false);
    setSendResult(null);
    setMetaLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/groups/${selectedAccountId}/${encodeURIComponent(group.jid)}`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setGroupMeta(data);
      }
    } catch {}
    setMetaLoading(false);
  };

  // Fetch invite link
  const fetchInvite = async () => {
    if (!selectedGroup) return;
    setInviteLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/groups/${selectedAccountId}/${encodeURIComponent(selectedGroup.jid)}/invite`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setInviteLink(data.link || "");
      }
    } catch {}
    setInviteLoading(false);
  };

  // Copy invite link
  const copyInvite = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Send message to group
  const handleSend = async () => {
    if (!selectedGroup || !msgText.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`${API_URL}/api/groups/${selectedAccountId}/send`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ groupJid: selectedGroup.jid, content: msgText, messageType: "text" }),
      });
      if (res.ok) {
        setSendResult("enviado");
        setMsgText("");
      } else {
        const data = await res.json().catch(() => ({}));
        setSendResult(data.error || "erro ao enviar");
      }
    } catch {
      setSendResult("erro de conexao");
    }
    setSending(false);
    setTimeout(() => setSendResult(null), 3000);
  };

  // Leave group
  const handleLeave = async () => {
    if (!selectedGroup) return;
    setLeaving(true);
    try {
      const res = await fetch(`${API_URL}/api/groups/${selectedAccountId}/leave`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ groupJid: selectedGroup.jid }),
      });
      if (res.ok) {
        setSelectedGroup(null);
        setGroupMeta(null);
        fetchGroups();
      }
    } catch {}
    setLeaving(false);
  };

  // Join via invite
  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinResult(null);
    try {
      const res = await fetch(`${API_URL}/api/groups/${selectedAccountId}/join`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ code: joinCode }),
      });
      const data = await res.json();
      if (res.ok) {
        setJoinResult({ ok: true, msg: "entrou no grupo" });
        setJoinCode("");
        fetchGroups();
      } else {
        setJoinResult({ ok: false, msg: data.error || "erro ao entrar" });
      }
    } catch {
      setJoinResult({ ok: false, msg: "erro de conexao" });
    }
    setJoining(false);
    setTimeout(() => setJoinResult(null), 4000);
  };

  // Create group
  const handleCreate = async () => {
    if (!createName.trim() || !createParticipants.trim()) return;
    setCreating(true);
    setCreateResult(null);
    const parts = createParticipants.split("\n").map(p => p.trim().replace(/\D/g, "")).filter(p => p.length >= 10);
    try {
      const res = await fetch(`${API_URL}/api/groups/${selectedAccountId}/create`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name: createName, participants: parts }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreateResult({ ok: true, msg: "grupo criado" });
        setCreateName("");
        setCreateParticipants("");
        setShowCreate(false);
        fetchGroups();
      } else {
        setCreateResult({ ok: false, msg: data.error || "erro ao criar" });
      }
    } catch {
      setCreateResult({ ok: false, msg: "erro de conexao" });
    }
    setCreating(false);
    setTimeout(() => setCreateResult(null), 4000);
  };

  const filteredGroups = searchQuery
    ? groups.filter(g => g.subject.toLowerCase().includes(searchQuery.toLowerCase()))
    : groups;

  const roleIcon = (role: string) => {
    if (role === "superadmin") return <ShieldCheck size={10} className="text-primary" />;
    if (role === "admin") return <Shield size={10} className="text-amber-400" />;
    return <User size={10} className="text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      {/* Account selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="term-label">conta</div>
        <select
          value={selectedAccountId}
          onChange={e => setSelectedAccountId(e.target.value)}
          className="bg-secondary font-mono text-xs px-3 py-1.5 rounded-sm border border-border outline-none focus:ring-1 focus:ring-primary"
        >
          {accounts.length === 0 && <option value="">nenhuma conta conectada</option>}
          {accounts.map(acc => (
            <option key={acc.id} value={acc.id}>{formatPhone(acc.phoneNumber)}</option>
          ))}
        </select>
        <button onClick={fetchGroups} className="text-muted-foreground hover:text-foreground transition-colors" title="recarregar">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="font-mono text-[10px] text-muted-foreground">{groups.length} grupo{groups.length !== 1 ? "s" : ""}</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 font-mono text-xs text-red-400 bg-red-400/5 border border-red-400/20 px-3 py-2 rounded-sm">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      <div className="flex h-[calc(100vh-12rem)] gap-0 border border-border rounded overflow-hidden">
        {/* Left panel - group list */}
        <div className="w-72 border-r border-border flex flex-col shrink-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">grupos</span>
            <span className="font-mono text-[9px] text-muted-foreground">{filteredGroups.length}</span>
          </div>

          {/* Search */}
          <div className="px-2 py-1.5 border-b border-border">
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="buscar grupo..."
              className="w-full bg-secondary font-mono text-[11px] px-2 py-1 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center font-mono text-xs text-muted-foreground animate-pulse">carregando...</div>
            ) : filteredGroups.length === 0 ? (
              <div className="p-4 text-center space-y-2">
                <UsersRound size={20} className="text-muted-foreground mx-auto opacity-30" />
                <div className="font-mono text-xs text-muted-foreground">
                  {groups.length === 0 ? "nenhum grupo encontrado" : "sem resultados"}
                </div>
              </div>
            ) : (
              filteredGroups.map(group => {
                const isSelected = selectedGroup?.jid === group.jid;
                return (
                  <button
                    key={group.jid}
                    onClick={() => fetchMeta(group)}
                    className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-secondary/50"}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <UsersRound size={11} className="text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[11px] truncate">{group.subject}</span>
                          {roleIcon(group.myRole)}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {group.participantCount} membros
                          </span>
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {group.myRole === "member" ? "membro" : group.myRole}
                          </span>
                        </div>
                      </div>
                      {isSelected && <ChevronRight size={10} className="text-primary shrink-0" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel - group details */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedGroup ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3">
                <UsersRound size={32} className="text-muted-foreground mx-auto opacity-20" />
                <div className="font-mono text-xs text-muted-foreground">selecione um grupo</div>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/30 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <UsersRound size={13} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-xs truncate">{selectedGroup.subject}</div>
                    <div className="font-mono text-[9px] text-muted-foreground">
                      {selectedGroup.participantCount} membros -- {selectedGroup.myRole}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {metaLoading && <Loader2 size={11} className="text-muted-foreground animate-spin" />}
                  <button
                    onClick={handleLeave}
                    disabled={leaving}
                    className="flex items-center gap-1 font-mono text-[10px] text-red-400/70 hover:text-red-400 transition-colors px-2 py-1 rounded border border-red-400/20 hover:border-red-400/40"
                    title="sair do grupo"
                  >
                    {leaving ? <Loader2 size={10} className="animate-spin" /> : <LeaveIcon size={10} />}
                    sair
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-4">
                  {/* Description */}
                  {(groupMeta?.desc || selectedGroup.desc) && (
                    <div>
                      <div className="section-line">descricao</div>
                      <div className="font-mono text-[11px] text-muted-foreground mt-2 whitespace-pre-wrap break-words bg-secondary/30 rounded p-3 border border-border">
                        {groupMeta?.desc || selectedGroup.desc}
                      </div>
                    </div>
                  )}

                  {/* Invite link */}
                  <div>
                    <div className="section-line">link de convite</div>
                    <div className="flex items-center gap-2 mt-2">
                      {inviteLink ? (
                        <>
                          <div className="flex-1 bg-secondary font-mono text-[11px] px-3 py-1.5 rounded-sm border border-border truncate">
                            {inviteLink}
                          </div>
                          <button
                            onClick={copyInvite}
                            className="flex items-center gap-1 font-mono text-[10px] text-primary hover:text-primary/80 px-2 py-1.5 border border-primary/20 rounded-sm transition-colors"
                          >
                            {copied ? <Check size={10} /> : <Copy size={10} />}
                            {copied ? "copiado" : "copiar"}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={fetchInvite}
                          disabled={inviteLoading}
                          className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border rounded-sm transition-colors"
                        >
                          {inviteLoading ? <Loader2 size={10} className="animate-spin" /> : <Link2 size={10} />}
                          obter link
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Participants */}
                  {groupMeta && (
                    <div>
                      <div className="section-line">participantes ({groupMeta.participants.length})</div>
                      <div className="mt-2 border border-border rounded overflow-hidden max-h-48 overflow-y-auto">
                        {groupMeta.participants.map((p, i) => (
                          <div key={p.jid} className={`term-row ${i % 2 === 0 ? "" : "bg-secondary/20"}`}>
                            {p.admin === "superadmin" ? (
                              <ShieldCheck size={10} className="text-primary shrink-0" />
                            ) : p.admin === "admin" ? (
                              <Shield size={10} className="text-amber-400 shrink-0" />
                            ) : (
                              <User size={10} className="text-muted-foreground shrink-0" />
                            )}
                            <span className="font-mono text-[11px] flex-1 truncate">{formatPhone(p.jid)}</span>
                            <span className="font-mono text-[9px] text-muted-foreground shrink-0">
                              {p.admin || "membro"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Message composer */}
                  <div>
                    <div className="section-line">enviar mensagem</div>
                    <div className="flex items-end gap-2 mt-2">
                      <textarea
                        value={msgText}
                        onChange={e => setMsgText(e.target.value)}
                        placeholder="mensagem para o grupo..."
                        rows={3}
                        className="flex-1 bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40 resize-none"
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      />
                      <button
                        onClick={handleSend}
                        disabled={sending || !msgText.trim()}
                        className="flex items-center gap-1.5 font-mono text-[11px] bg-primary text-primary-foreground px-4 py-2 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                        enviar
                      </button>
                    </div>
                    {sendResult && (
                      <div className={`font-mono text-[10px] mt-1.5 ${sendResult === "enviado" ? "text-primary" : "text-red-400"}`}>
                        {sendResult}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom section: Join + Create */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Join group */}
        <div className="border border-border rounded p-4 space-y-3">
          <div className="section-line">entrar em grupo</div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <div className="term-label mb-1.5">codigo ou link de convite</div>
              <input
                value={joinCode}
                onChange={e => setJoinCode(e.target.value)}
                placeholder="https://chat.whatsapp.com/ABC... ou ABC..."
                className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
                onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
              />
            </div>
            <button
              onClick={handleJoin}
              disabled={joining || !joinCode.trim() || !selectedAccountId}
              className="flex items-center gap-1.5 font-mono text-[11px] bg-primary text-primary-foreground px-4 py-2 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {joining ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
              entrar
            </button>
          </div>
          {joinResult && (
            <div className={`flex items-center gap-1.5 font-mono text-[10px] ${joinResult.ok ? "text-primary" : "text-red-400"}`}>
              {joinResult.ok ? <Check size={10} /> : <AlertTriangle size={10} />} {joinResult.msg}
            </div>
          )}
        </div>

        {/* Create group */}
        <div className="border border-border rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="section-line">criar grupo</div>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="font-mono text-[10px] text-primary hover:text-primary/80 flex items-center gap-1"
            >
              {showCreate ? <X size={10} /> : <Plus size={10} />}
              {showCreate ? "cancelar" : "novo grupo"}
            </button>
          </div>

          {showCreate && (
            <div className="space-y-3">
              <div>
                <div className="term-label mb-1.5">nome do grupo</div>
                <input
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="nome do grupo"
                  className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
                />
              </div>
              <div>
                <div className="term-label mb-1.5">participantes (um numero por linha)</div>
                <textarea
                  value={createParticipants}
                  onChange={e => setCreateParticipants(e.target.value)}
                  placeholder={"5511999999999\n5521988888888"}
                  rows={4}
                  className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40 resize-none"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || !createName.trim() || !createParticipants.trim() || !selectedAccountId}
                className="w-full flex items-center justify-center gap-1.5 font-mono text-[11px] bg-primary text-primary-foreground px-4 py-2.5 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                criar grupo
              </button>
              {createResult && (
                <div className={`flex items-center gap-1.5 font-mono text-[10px] ${createResult.ok ? "text-primary" : "text-red-400"}`}>
                  {createResult.ok ? <Check size={10} /> : <AlertTriangle size={10} />} {createResult.msg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
