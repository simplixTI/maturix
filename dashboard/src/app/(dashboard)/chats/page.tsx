"use client";

import { useState, useEffect, useRef } from "react";
import { MessageCircle, Phone, RefreshCw } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

interface Thread {
  participants: string[];
  phones: string[];
  lastMessage: string;
  lastAt: string;
  messageCount: number;
}

interface Account {
  id: string;
  phoneNumber: string;
  status: string;
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  messageType: string;
  spintaxOutput: string | null;
  direction: string;
  status: string;
  createdAt: string;
  sender: { id: string; phoneNumber: string };
  receiver: { id: string; phoneNumber: string };
}

function formatPhone(phone: string): string {
  if (phone.length === 13) return `+${phone.slice(0,2)} ${phone.slice(2,4)} ${phone.slice(4,9)}-${phone.slice(9)}`;
  if (phone.length === 12) return `+${phone.slice(0,2)} ${phone.slice(2,4)} ${phone.slice(4,8)}-${phone.slice(8)}`;
  return phone;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ChatsPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const getHeaders = () => {
    const t = typeof window !== "undefined" ? localStorage.getItem("maturador_token") : null;
    const h: Record<string, string> = {};
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  };

  // Fetch threads
  const fetchThreads = async () => {
    try {
      const res = await fetch(`${API_URL}/api/conversations/threads`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
        setAccounts(data.accounts || []);
      }
    } catch {}
    setLoading(false);
  };

  // Fetch messages for a thread
  const fetchMessages = async (accountId: string) => {
    setMsgsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/conversations/messages?accountId=${accountId}&limit=200`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setMessages(data || []);
      }
    } catch {}
    setMsgsLoading(false);
  };

  useEffect(() => { fetchThreads(); }, []);

  // Auto-refresh messages every 5s
  useEffect(() => {
    if (!selectedThread) return;
    const interval = setInterval(() => {
      fetchMessages(selectedThread.participants[0]);
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedThread]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectThread = (thread: Thread) => {
    setSelectedThread(thread);
    setMessages([]);
    fetchMessages(thread.participants[0]);
  };

  // Filter messages for selected thread only
  const threadMessages = selectedThread
    ? messages.filter(m =>
        selectedThread.participants.includes(m.senderId) &&
        selectedThread.participants.includes(m.receiverId)
      )
    : [];

  return (
    <div className="flex h-[calc(100vh-7rem)] -m-4 md:-m-5 border border-border rounded overflow-hidden">
      {/* Thread list */}
      <div className="w-72 border-r border-border flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">conversas</span>
          <button onClick={fetchThreads} className="text-muted-foreground hover:text-foreground transition-colors active:text-primary">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center font-mono text-xs text-muted-foreground animate-pulse">carregando...</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-center space-y-2">
              <MessageCircle size={20} className="text-muted-foreground mx-auto opacity-30" />
              <div className="font-mono text-xs text-muted-foreground">nenhuma conversa ainda</div>
              <div className="font-mono text-[10px] text-muted-foreground">o motor de aquecimento vai iniciar<br/>conversas automaticamente</div>
            </div>
          ) : (
            threads.map((thread, i) => {
              const isSelected = selectedThread?.participants.join() === thread.participants.join();
              return (
                <button key={i} onClick={() => selectThread(thread)}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-secondary/50"}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Phone size={11} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] truncate">{formatPhone(thread.phones[0])}</span>
                        <span className="font-mono text-[9px] text-muted-foreground shrink-0 ml-1">{timeAgo(thread.lastAt)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="font-mono text-[10px] text-muted-foreground truncate">{thread.lastMessage.slice(0, 40)}</span>
                        <span className="font-mono text-[9px] text-muted-foreground bg-secondary rounded-full px-1.5 shrink-0 ml-1">{thread.messageCount}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}

          {/* Show all accounts even without threads */}
          {!loading && accounts.length > 0 && (
            <div className="px-3 py-2 border-t border-border">
              <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest mb-1.5">dispositivos conectados</div>
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center gap-2 py-1">
                  <div className={`dot ${acc.status === "CONNECTED" ? "dot-ok" : "dot-off"}`} />
                  <span className="font-mono text-[10px] text-muted-foreground">{formatPhone(acc.phoneNumber)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {!selectedThread ? (
          /* No thread selected */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <MessageCircle size={32} className="text-muted-foreground mx-auto opacity-20" />
              <div className="font-mono text-xs text-muted-foreground">selecione uma conversa</div>
              <div className="font-mono text-[10px] text-muted-foreground">ou aguarde o motor de aquecimento<br/>gerar conversas entre seus numeros</div>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-secondary/30 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                  <Phone size={11} className="text-muted-foreground" />
                </div>
                <div>
                  <div className="font-mono text-xs">{formatPhone(selectedThread.phones[0])}</div>
                  <div className="font-mono text-[9px] text-muted-foreground">
                    {formatPhone(selectedThread.phones[1])} &mdash; {threadMessages.length} mensagens
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {msgsLoading && <span className="font-mono text-[9px] text-muted-foreground animate-pulse">sincronizando...</span>}
                <button onClick={() => fetchMessages(selectedThread.participants[0])}
                  className="text-muted-foreground hover:text-foreground transition-colors">
                  <RefreshCw size={11} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
              {threadMessages.length === 0 && !msgsLoading && (
                <div className="flex items-center justify-center h-full">
                  <div className="font-mono text-xs text-muted-foreground">nenhuma mensagem nesta conversa</div>
                </div>
              )}

              {threadMessages.map((msg, i) => {
                const isFirstParticipant = msg.senderId === selectedThread.participants[0];
                const showDate = i === 0 || new Date(msg.createdAt).toDateString() !== new Date(threadMessages[i-1].createdAt).toDateString();

                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="flex justify-center my-3">
                        <span className="font-mono text-[9px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                          {new Date(msg.createdAt).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${isFirstParticipant ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] px-3 py-1.5 rounded-lg ${
                        isFirstParticipant
                          ? "bg-primary/10 border border-primary/20 rounded-tr-none"
                          : "bg-secondary border border-border rounded-tl-none"
                      }`}>
                        {/* Sender phone */}
                        <div className={`font-mono text-[9px] mb-0.5 ${isFirstParticipant ? "text-primary" : "text-muted-foreground"}`}>
                          {formatPhone(msg.sender.phoneNumber)}
                        </div>
                        {/* Message content */}
                        {msg.messageType === "REACTION" ? (
                          <div className="text-lg">{msg.spintaxOutput || msg.reactionEmoji}</div>
                        ) : msg.messageType === "STATUS_POST" ? (
                          <div className="font-mono text-[11px] text-muted-foreground italic">[atualizacao de status]</div>
                        ) : (
                          <div className="font-mono text-[11px] leading-relaxed break-words">
                            {msg.spintaxOutput || `[${msg.messageType.toLowerCase()}]`}
                          </div>
                        )}
                        {/* Time + status */}
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span className="font-mono text-[8px] text-muted-foreground">{formatTime(msg.createdAt)}</span>
                          {isFirstParticipant && (
                            <span className={`font-mono text-[8px] ${msg.status === "READ" ? "text-primary" : msg.status === "DELIVERED" ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                              {msg.status === "READ" ? "R" : msg.status === "DELIVERED" ? "D" : msg.status === "SENT" ? "S" : "Q"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Footer info */}
            <div className="px-4 py-2 border-t border-border flex items-center gap-2 shrink-0">
              <div className="dot dot-ok" />
              <span className="font-mono text-[9px] text-muted-foreground">
                motor de aquecimento ativo &mdash; mensagens sao geradas automaticamente
              </span>
              <span className="font-mono text-[9px] text-muted-foreground ml-auto">
                atualizacao automatica 5s
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
