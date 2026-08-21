"use client";

import { useState, useEffect } from "react";
import { Send, X, Image, Mic, MapPin, Users, BarChart3, FileText, Loader2, Check, AlertTriangle, Upload, Link2, FolderOpen, Clock, History } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

interface ConnectedAccount {
  id: string;
  phoneNumber: string;
  warmupDay: number;
  msgsSentToday: number;
}

type MsgType = "text" | "image" | "audio" | "location" | "contact" | "poll";

interface SendResult {
  target: string;
  status: string;
  error?: string;
}

interface SavedSend {
  id: string;
  name: string;
  msgType: MsgType;
  content: string;
  caption: string;
  mediaUrl: string;
  targets: string;
  delay: number;
  pollQuestion: string;
  pollOptions: string;
  locLat: string;
  locLng: string;
  locName: string;
  vcardName: string;
  vcardPhone: string;
  createdAt: string;
}

interface SendHistoryEntry {
  id: string;
  fromPhone: string;
  target: string;
  message: string;
  msgType: string;
  status: "sent" | "failed";
  error?: string;
  sentAt: string;
}

const STORAGE_KEY = "maturador_saved_sends";
const HISTORY_KEY = "maturador_send_history";

function loadHistory(): SendHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}

function addToHistory(entries: SendHistoryEntry[]) {
  const existing = loadHistory();
  const updated = [...entries, ...existing].slice(0, 500);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

function loadSavedSends(): SavedSend[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

function persistSavedSends(sends: SavedSend[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sends));
}

function formatPhone(p: string): string {
  if (p.length >= 12) return `+${p.slice(0,2)} ${p.slice(2,4)} ${p.slice(4,9)}-${p.slice(9)}`;
  return p;
}

export default function EnviosPage() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [msgType, setMsgType] = useState<MsgType>("text");
  const [content, setContent] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [targets, setTargets] = useState("");
  const [delay, setDelay] = useState(5);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(";;");
  const [locLat, setLocLat] = useState("-23.5505");
  const [locLng, setLocLng] = useState("-46.6333");
  const [locName, setLocName] = useState("Sao Paulo");
  const [vcardName, setVcardName] = useState("");
  const [vcardPhone, setVcardPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [error, setError] = useState("");

  const token = typeof window !== "undefined" ? localStorage.getItem("maturador_token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  useEffect(() => {
    fetch(`${API_URL}/api/send/accounts`, { headers })
      .then(r => r.ok ? r.json() : [])
      .then(setAccounts)
      .catch(() => {});
  }, []);

  const targetList = targets.split("\n").map(t => t.trim().replace(/\D/g, "")).filter(t => t.length >= 10);

  const toggleAccount = (id: string) => {
    setSelectedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllAccounts = () => setSelectedAccounts(new Set(accounts.map(a => a.id)));

  const handleSend = async () => {
    if (selectedAccounts.size === 0 || targetList.length === 0) {
      setError("selecione numeros de origem e adicione destinatarios");
      return;
    }
    setError("");
    setSending(true);
    setResults(null);

    const allResults: SendResult[] = [];

    for (const fromId of selectedAccounts) {
      const body: Record<string, unknown> = {
        fromAccountId: fromId,
        targets: targetList,
        messageType: msgType,
        delay,
      };

    if (msgType === "text") body.content = content;
    if (msgType === "image") { body.mediaUrl = mediaUrl; body.caption = caption; }
    if (msgType === "audio") body.mediaUrl = mediaUrl;
    if (msgType === "location") body.location = { lat: parseFloat(locLat), lng: parseFloat(locLng), name: locName };
    if (msgType === "contact") body.vcard = { name: vcardName, phone: vcardPhone };
    if (msgType === "poll") body.poll = { question: pollQuestion, options: pollOptions.split(";").map(o => o.trim()).filter(Boolean) };

      try {
        const res = await fetch(`${API_URL}/api/send`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.ok && data.results) {
          const acc = accounts.find(a => a.id === fromId);
          allResults.push(...data.results.map((r: SendResult) => ({ ...r, from: acc?.phoneNumber || fromId })));
        }
      } catch {}
    }

    setResults(allResults);
    // Save to history
    const now = new Date().toISOString();
    const histEntries: SendHistoryEntry[] = allResults.map(r => ({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      fromPhone: (r as SendResult & { from?: string }).from || "",
      target: r.target,
      message: msgType === "text" ? content.slice(0, 200) : `[${msgType}]`,
      msgType,
      status: r.status === "sent" ? "sent" : "failed",
      error: r.error,
      sentAt: now,
    }));
    setHistory(addToHistory(histEntries));
    setSending(false);
  };

  // Saved sends
  const [savedSends, setSavedSends] = useState<SavedSend[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [history, setHistory] = useState<SendHistoryEntry[]>([]);

  useEffect(() => { setSavedSends(loadSavedSends()); setHistory(loadHistory()); }, []);

  const handleSaveSend = () => {
    if (!saveName.trim()) return;
    const newSend: SavedSend = {
      id: Date.now().toString(),
      name: saveName.trim(),
      msgType, content, caption, mediaUrl, targets, delay,
      pollQuestion, pollOptions, locLat, locLng, locName, vcardName, vcardPhone,
      createdAt: new Date().toISOString(),
    };
    const updated = [newSend, ...savedSends];
    setSavedSends(updated);
    persistSavedSends(updated);
    setSaveName("");
    setShowSaveModal(false);
  };

  const handleLoadSend = (s: SavedSend) => {
    setMsgType(s.msgType);
    setContent(s.content);
    setCaption(s.caption);
    setMediaUrl(s.mediaUrl);
    setTargets(s.targets);
    setDelay(s.delay);
    setPollQuestion(s.pollQuestion);
    setPollOptions(s.pollOptions);
    setLocLat(s.locLat);
    setLocLng(s.locLng);
    setLocName(s.locName);
    setVcardName(s.vcardName);
    setVcardPhone(s.vcardPhone);
    setShowLoadModal(false);
  };

  const handleDeleteSend = (id: string) => {
    const updated = savedSends.filter(s => s.id !== id);
    setSavedSends(updated);
    persistSavedSends(updated);
  };

  // TXT import mode: NUMERO:MENSAGEM per line
  const [txtMode, setTxtMode] = useState(false);
  const [txtLines, setTxtLines] = useState<Array<{ phone: string; message: string }>>([]);

  const handleTxtUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const parsed: Array<{ phone: string; message: string }> = [];
      for (const line of lines) {
        const sepIdx = line.indexOf(":");
        if (sepIdx === -1) continue;
        const phone = line.slice(0, sepIdx).replace(/\D/g, "");
        const message = line.slice(sepIdx + 1).trim();
        if (phone.length >= 10 && message) parsed.push({ phone, message });
      }
      setTxtLines(parsed);
      setTxtMode(true);
      setTargets(parsed.map(p => p.phone).join("\n"));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSendTxt = async () => {
    if (selectedAccounts.size === 0 || txtLines.length === 0) {
      setError("selecione contas e importe o arquivo .txt");
      return;
    }
    setError("");
    setSending(true);
    setResults(null);
    const allResults: SendResult[] = [];
    const fromIds = Array.from(selectedAccounts);
    const delayMs = Math.max(delay, 3) * 1000;

    for (let i = 0; i < txtLines.length; i++) {
      const { phone, message } = txtLines[i];
      const fromId = fromIds[i % fromIds.length];
      try {
        const res = await fetch(`${API_URL}/api/send`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            fromAccountId: fromId,
            targets: [phone],
            messageType: "text",
            content: message,
            delay,
          }),
        });
        const data = await res.json();
        if (res.ok && data.results) {
          allResults.push(...data.results);
        } else {
          allResults.push({ target: phone, status: "failed", error: data.error });
        }
      } catch {
        allResults.push({ target: phone, status: "failed", error: "network" });
      }
      if (i < txtLines.length - 1) {
        await new Promise(r => setTimeout(r, delayMs + Math.random() * 2000));
      }
    }
    setResults(allResults);
    const now = new Date().toISOString();
    const histEntries: SendHistoryEntry[] = allResults.map((r, idx) => ({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      fromPhone: accounts.find(a => a.id === fromIds[idx % fromIds.length])?.phoneNumber || "",
      target: r.target,
      message: txtLines[idx]?.message?.slice(0, 200) || "[txt]",
      msgType: "text",
      status: r.status === "sent" ? "sent" : "failed",
      error: r.error,
      sentAt: now,
    }));
    setHistory(addToHistory(histEntries));
    setSending(false);
  };

  const [mediaTab, setMediaTab] = useState<"file" | "url" | "gallery">("file");
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    // Read as base64
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string;

      // Preview for images
      if (file.type.startsWith("image/")) {
        setFilePreview(base64);
      } else {
        setFilePreview(null);
      }

      // Upload to server
      setUploading(true);
      try {
        const res = await fetch(`${API_URL}/api/send/upload`, {
          method: "POST",
          headers,
          body: JSON.stringify({ data: base64, filename: file.name, type: file.type }),
        });
        const data = await res.json();
        if (res.ok && data.path) {
          setMediaUrl(data.path);
        } else {
          setError("erro no upload: " + (data.error || ""));
        }
      } catch {
        setError("erro ao fazer upload");
      }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const msgTypes: { type: MsgType; icon: React.ElementType; label: string }[] = [
    { type: "text", icon: FileText, label: "texto" },
    { type: "image", icon: Image, label: "imagem" },
    { type: "audio", icon: Mic, label: "audio" },
    { type: "location", icon: MapPin, label: "localizacao" },
    { type: "contact", icon: Users, label: "contato" },
    { type: "poll", icon: BarChart3, label: "enquete" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="dot dot-ok" />
          <span className="font-mono text-[10px] text-muted-foreground">{accounts.length} contas conectadas</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowHistoryModal(true)}
            className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded-sm transition-colors">
            <History size={10} /> historico ({history.length})
          </button>
          <button type="button" onClick={() => setShowLoadModal(true)}
            className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded-sm transition-colors">
            <FolderOpen size={10} /> carregar ({savedSends.length})
          </button>
          <button type="button" onClick={() => { setSaveName(""); setShowSaveModal(true); }}
            className="flex items-center gap-1 font-mono text-[10px] text-primary hover:text-primary/80 px-2 py-1 border border-primary/30 rounded-sm transition-colors">
            <Check size={10} /> salvar envio
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: compose */}
        <div className="space-y-4">
          <div className="section-line">compor mensagem</div>

          {/* From account */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="term-label">enviar de ({selectedAccounts.size}/{accounts.length})</div>
              <button type="button" onClick={selectAllAccounts} className="font-mono text-[10px] text-primary hover:text-primary/80">[todos]</button>
            </div>
            <div className="border border-border rounded overflow-hidden">
              {accounts.length === 0 ? (
                <div className="px-3 py-2 font-mono text-xs text-muted-foreground">nenhuma conta conectada</div>
              ) : (
                accounts.map(acc => (
                  <button key={acc.id} type="button"
                    onClick={() => toggleAccount(acc.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 font-mono text-xs transition-colors border-b border-border/50 last:border-b-0 ${
                      selectedAccounts.has(acc.id) ? "bg-primary/5 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}>
                    <div className={`w-3 h-3 rounded-sm border transition-colors ${selectedAccounts.has(acc.id) ? "bg-primary border-primary" : "border-border"}`} />
                    <div className="dot dot-ok" />
                    <span>{formatPhone(acc.phoneNumber)}</span>
                    <span className="ml-auto text-[10px]">dia {acc.warmupDay} | {acc.msgsSentToday} enviados</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Message type */}
          <div>
            <div className="term-label mb-1.5">tipo</div>
            <div className="flex flex-wrap gap-1">
              {msgTypes.map(({ type, icon: Icon, label }) => (
                <button key={type} type="button" onClick={() => setMsgType(type)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] rounded border transition-colors ${
                    msgType === type ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  }`}>
                  <Icon size={11} />{label}
                </button>
              ))}
            </div>
          </div>

          {/* Content based on type */}
          <div>
            <div className="term-label mb-1.5">conteudo</div>

            {msgType === "text" && (
              <div className="space-y-2">
                <textarea value={content} onChange={e => setContent(e.target.value)} rows={8}
                  placeholder={"cole ou digite sua mensagem aqui...\n\nsuporta:\n- quebras de linha (enter)\n- emojis 🔴✅💸\n- {opcao1|opcao2} para variacoes\n- formatacao whatsapp: *negrito* _italico_ ~riscado~ ```codigo```"}
                  className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40 resize-y min-h-[120px]"
                  style={{ whiteSpace: "pre-wrap" }} />
                {content && (
                  <div className="border border-border rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="term-label">preview</span>
                      <span className="font-mono text-[9px] text-muted-foreground">{content.length} chars | {content.split("\n").length} linhas</span>
                    </div>
                    <div className="bg-secondary/50 rounded p-2.5 font-mono text-[11px] whitespace-pre-wrap break-words leading-relaxed">
                      {content}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(msgType === "image" || msgType === "audio") && (
              <div className="space-y-3">
                {/* Source tabs */}
                <div className="flex gap-0 border border-border rounded overflow-hidden">
                  <button type="button" onClick={() => setMediaTab("file")}
                    className={`flex items-center gap-1 px-3 py-1.5 font-mono text-[10px] flex-1 justify-center transition-colors ${mediaTab === "file" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    <Upload size={10} />arquivo
                  </button>
                  <button type="button" onClick={() => setMediaTab("url")}
                    className={`flex items-center gap-1 px-3 py-1.5 font-mono text-[10px] flex-1 justify-center border-l border-border transition-colors ${mediaTab === "url" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    <Link2 size={10} />url / caminho
                  </button>
                  <button type="button" onClick={() => setMediaTab("gallery")}
                    className={`flex items-center gap-1 px-3 py-1.5 font-mono text-[10px] flex-1 justify-center border-l border-border transition-colors ${mediaTab === "gallery" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    <FolderOpen size={10} />galeria
                  </button>
                </div>

                {/* File upload */}
                {mediaTab === "file" && (
                  <label className="flex flex-col items-center justify-center border border-dashed border-border rounded p-6 cursor-pointer hover:border-primary/30 hover:bg-primary/[0.02] transition-colors">
                    <input type="file" className="hidden" accept={msgType === "image" ? "image/*" : "audio/*,.ogg,.mp3,.m4a"} onChange={handleFileSelect} />
                    {uploading ? (
                      <div className="text-center space-y-1">
                        <Loader2 size={20} className="text-primary mx-auto animate-spin" />
                        <span className="font-mono text-[10px] text-muted-foreground">enviando para servidor...</span>
                      </div>
                    ) : filePreview ? (
                      <div className="space-y-2 text-center">
                        <img src={filePreview} alt="preview" className="max-h-32 rounded mx-auto" />
                        <span className="font-mono text-[10px] text-primary">{fileName}</span>
                        {mediaUrl && <span className="font-mono text-[9px] text-muted-foreground block">salvo: {mediaUrl}</span>}
                        <span className="font-mono text-[9px] text-muted-foreground block">clique para trocar</span>
                      </div>
                    ) : fileName ? (
                      <div className="text-center space-y-1">
                        <Mic size={20} className="text-primary mx-auto" />
                        <span className="font-mono text-[10px] text-primary">{fileName}</span>
                        {mediaUrl && <span className="font-mono text-[9px] text-muted-foreground block">salvo: {mediaUrl}</span>}
                        <span className="font-mono text-[9px] text-muted-foreground block">clique para trocar</span>
                      </div>
                    ) : (
                      <div className="text-center space-y-1">
                        <Upload size={20} className="text-muted-foreground mx-auto" />
                        <span className="font-mono text-[10px] text-muted-foreground">arraste ou clique para selecionar</span>
                        <span className="font-mono text-[9px] text-muted-foreground">{msgType === "image" ? "JPG, PNG, WebP" : "OGG, MP3, M4A"}</span>
                      </div>
                    )}
                  </label>
                )}

                {/* URL / Path */}
                {mediaTab === "url" && (
                  <div className="space-y-2">
                    <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                      placeholder={msgType === "image" ? "https://exemplo.com/foto.jpg ou D:\\media\\foto.jpg" : "https://exemplo.com/audio.ogg ou D:\\media\\audio.ogg"}
                      className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40" />
                    {mediaUrl && mediaUrl.match(/\.(jpg|jpeg|png|webp|gif)/i) && (
                      <div className="border border-border rounded p-2">
                        <img src={mediaUrl} alt="preview" className="max-h-32 rounded mx-auto" onError={e => (e.target as HTMLImageElement).style.display = "none"} />
                      </div>
                    )}
                  </div>
                )}

                {/* Gallery - show media pool */}
                {mediaTab === "gallery" && (
                  <div className="border border-border rounded p-3">
                    <div className="font-mono text-[9px] text-muted-foreground mb-2">media pool do servidor (media/images/)</div>
                    <div className="grid grid-cols-5 gap-1">
                      {Array.from({length: 15}, (_, i) => (
                        <button key={i} type="button"
                          onClick={() => setMediaUrl(`media/images/photo_${String(i+1).padStart(2,"0")}.jpg`)}
                          className={`aspect-square rounded border text-center font-mono text-[8px] text-muted-foreground hover:border-primary/30 transition-colors ${mediaUrl === `media/images/photo_${String(i+1).padStart(2,"0")}.jpg` ? "border-primary bg-primary/5" : "border-border"}`}>
                          {String(i+1).padStart(2,"0")}
                        </button>
                      ))}
                    </div>
                    <div className="font-mono text-[9px] text-muted-foreground mt-2">
                      selecionado: {mediaUrl || "nenhum"}
                    </div>
                  </div>
                )}

                {/* Caption (for image/video) */}
                {msgType === "image" && (
                  <div className="space-y-2">
                    <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={4}
                      placeholder={"legenda (opcional)\n\nsuporta quebras de linha, emojis e {spintax|variacao}"}
                      className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40 resize-y min-h-[80px]"
                      style={{ whiteSpace: "pre-wrap" }} />
                    {caption && (
                      <div className="bg-secondary/50 rounded p-2 font-mono text-[10px] whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
                        {caption}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {msgType === "location" && (
              <div className="grid grid-cols-3 gap-2">
                <input value={locLat} onChange={e => setLocLat(e.target.value)} placeholder="latitude"
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40" />
                <input value={locLng} onChange={e => setLocLng(e.target.value)} placeholder="longitude"
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40" />
                <input value={locName} onChange={e => setLocName(e.target.value)} placeholder="nome do local"
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40" />
              </div>
            )}

            {msgType === "contact" && (
              <div className="grid grid-cols-2 gap-2">
                <input value={vcardName} onChange={e => setVcardName(e.target.value)} placeholder="nome do contato"
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40" />
                <input value={vcardPhone} onChange={e => setVcardPhone(e.target.value)} placeholder="telefone"
                  className="bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40" />
              </div>
            )}

            {msgType === "poll" && (
              <div className="space-y-2">
                <input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="pergunta da enquete"
                  className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40" />
                <input value={pollOptions} onChange={e => setPollOptions(e.target.value)} placeholder="opcoes separadas por ; (ex: sim;nao;talvez)"
                  className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40" />
              </div>
            )}
          </div>

          {/* Delay */}
          <div>
            <div className="term-label mb-1.5">delay entre envios (segundos)</div>
            <input type="number" value={delay} onChange={e => setDelay(parseInt(e.target.value) || 5)} min={3} max={120}
              className="w-24 bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>

        {/* Right: targets + send */}
        <div className="space-y-4">
          <div className="section-line">destinatarios</div>

          {/* Mode tabs */}
          <div className="flex gap-0 border border-border rounded overflow-hidden">
            <button type="button" onClick={() => setTxtMode(false)}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 font-mono text-[10px] transition-colors ${!txtMode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              <FileText size={10} /> manual
            </button>
            <label className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 font-mono text-[10px] border-l border-border cursor-pointer transition-colors ${txtMode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              <Upload size={10} /> importar .txt
              <input type="file" accept=".txt" className="hidden" onChange={handleTxtUpload} />
            </label>
          </div>

          {!txtMode ? (
            <>
              {/* Manual target numbers */}
              <div>
                <div className="term-label mb-1.5">numeros (um por linha, com DDD)</div>
                <textarea value={targets} onChange={e => setTargets(e.target.value)} rows={10}
                  placeholder={"5511999999999\n5521988888888\n5531977777777\n\ncole os numeros aqui..."}
                  className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40 resize-none" />
                <div className="font-mono text-[10px] text-muted-foreground mt-1">
                  {targetList.length} numero{targetList.length !== 1 ? "s" : ""} valido{targetList.length !== 1 ? "s" : ""}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* TXT imported lines */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="term-label">{txtLines.length} linhas importadas (NUMERO:MENSAGEM)</div>
                  <button type="button" onClick={() => { setTxtMode(false); setTxtLines([]); }}
                    className="font-mono text-[10px] text-red-400 hover:text-red-300">[limpar]</button>
                </div>
                <div className="border border-border rounded overflow-hidden max-h-[300px] overflow-y-auto">
                  {txtLines.length === 0 ? (
                    <div className="p-4 text-center font-mono text-xs text-muted-foreground">
                      formato: NUMERO:MENSAGEM (um por linha)
                    </div>
                  ) : (
                    txtLines.map((line, i) => (
                      <div key={i} className={`flex items-start gap-2 px-3 py-2 font-mono text-[11px] border-b border-border/50 last:border-b-0 ${i % 2 ? "bg-secondary/10" : ""}`}>
                        <span className="text-[9px] text-muted-foreground w-5 shrink-0 pt-0.5">{i+1}</span>
                        <span className="text-primary shrink-0">{formatPhone(line.phone)}</span>
                        <span className="text-muted-foreground">:</span>
                        <span className="text-foreground break-all">{line.message.length > 80 ? line.message.slice(0, 80) + "..." : line.message}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="font-mono text-[9px] text-muted-foreground mt-1.5 space-y-0.5">
                  <div>cada linha envia uma mensagem personalizada para cada numero</div>
                  <div>as contas selecionadas sao usadas em rodizio</div>
                </div>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 font-mono text-xs text-red-400 bg-red-400/5 border border-red-400/20 px-3 py-2 rounded-sm">
              <AlertTriangle size={12} /> {error}
            </div>
          )}

          {/* Send button */}
          {txtMode ? (
            <button type="button" onClick={handleSendTxt} disabled={sending || selectedAccounts.size === 0 || txtLines.length === 0}
              className="w-full flex items-center justify-center gap-2 font-mono text-xs bg-primary text-primary-foreground py-3 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer">
              {sending ? (
                <><Loader2 size={12} className="animate-spin" /> enviando...</>
              ) : (
                <><Send size={12} /> [enviar {txtLines.length} mensagens personalizadas de {selectedAccounts.size} conta{selectedAccounts.size !== 1 ? "s" : ""}]</>
              )}
            </button>
          ) : (
            <button type="button" onClick={handleSend} disabled={sending || selectedAccounts.size === 0 || targetList.length === 0}
              className="w-full flex items-center justify-center gap-2 font-mono text-xs bg-primary text-primary-foreground py-3 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer">
              {sending ? (
                <><Loader2 size={12} className="animate-spin" /> enviando...</>
              ) : (
                <><Send size={12} /> [enviar de {selectedAccounts.size} conta{selectedAccounts.size !== 1 ? "s" : ""} para {targetList.length} numero{targetList.length !== 1 ? "s" : ""}]</>
              )}
            </button>
          )}

          {/* Results */}
          {results && (
            <div>
              <div className="section-line">resultado</div>
              <div className="border border-border rounded overflow-hidden">
                <div className="term-row bg-secondary/30 text-[10px] text-muted-foreground uppercase tracking-widest">
                  <span className="w-5" /><span className="flex-1">numero</span><span className="w-16 text-right">status</span>
                </div>
                {results.map((r, i) => (
                  <div key={i} className="term-row">
                    <div className={`dot ${r.status === "sent" ? "dot-ok" : "dot-err"}`} />
                    <span className="flex-1 font-mono text-xs">{formatPhone(r.target)}</span>
                    <span className={`w-16 text-right font-mono text-[10px] ${r.status === "sent" ? "text-primary" : "text-red-400"}`}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-2 font-mono text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><Check size={10} className="text-primary" /> {results.filter(r => r.status === "sent").length} enviados</span>
                <span className="flex items-center gap-1"><X size={10} className="text-red-400" /> {results.filter(r => r.status === "failed").length} falhas</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Salvar Envio */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSaveModal(false)}>
          <div className="bg-background border border-border rounded w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-mono text-xs font-semibold">salvar configuracao de envio</span>
              <button type="button" onClick={() => setShowSaveModal(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <div className="term-label mb-1.5">nome do envio</div>
                <input value={saveName} onChange={e => setSaveName(e.target.value)}
                  placeholder="ex: campanha black friday, follow-up leads..."
                  className="w-full bg-secondary font-mono text-xs px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter") handleSaveSend(); }} />
              </div>
              <div className="border border-border rounded p-3 space-y-1 font-mono text-[10px] text-muted-foreground">
                <div>tipo: <span className="text-foreground">{msgType}</span></div>
                {msgType === "text" && <div>mensagem: <span className="text-foreground">{content.slice(0, 80)}{content.length > 80 ? "..." : ""}</span></div>}
                {(msgType === "image" || msgType === "audio") && <div>media: <span className="text-foreground">{mediaUrl || "nenhuma"}</span></div>}
                {msgType === "poll" && <div>enquete: <span className="text-foreground">{pollQuestion}</span></div>}
                {msgType === "location" && <div>local: <span className="text-foreground">{locName} ({locLat}, {locLng})</span></div>}
                {msgType === "contact" && <div>contato: <span className="text-foreground">{vcardName} - {vcardPhone}</span></div>}
                <div>destinatarios: <span className="text-foreground">{targetList.length} numero{targetList.length !== 1 ? "s" : ""}</span></div>
                <div>delay: <span className="text-foreground">{delay}s</span></div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
              <button type="button" onClick={() => setShowSaveModal(false)}
                className="font-mono text-[10px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border rounded-sm transition-colors">
                cancelar
              </button>
              <button type="button" onClick={handleSaveSend} disabled={!saveName.trim()}
                className="font-mono text-[10px] text-primary-foreground bg-primary hover:bg-primary/90 px-4 py-1.5 rounded-sm transition-colors disabled:opacity-50">
                [salvar]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Carregar Envio */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowLoadModal(false)}>
          <div className="bg-background border border-border rounded w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-mono text-xs font-semibold">envios salvos ({savedSends.length})</span>
              <button type="button" onClick={() => setShowLoadModal(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {savedSends.length === 0 ? (
                <div className="p-8 text-center font-mono text-xs text-muted-foreground">
                  nenhum envio salvo ainda
                </div>
              ) : (
                savedSends.map(s => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-secondary/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs truncate">{s.name}</div>
                      <div className="flex items-center gap-2 mt-1 font-mono text-[10px] text-muted-foreground">
                        <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded">{s.msgType}</span>
                        <span>{s.targets.split("\n").filter(t => t.trim()).length} destinos</span>
                        <span>{s.delay}s delay</span>
                        <span>{new Date(s.createdAt).toLocaleDateString("pt-BR")}</span>
                      </div>
                      {s.msgType === "text" && s.content && (
                        <div className="font-mono text-[10px] text-muted-foreground mt-1 truncate">
                          {s.content.slice(0, 60)}{s.content.length > 60 ? "..." : ""}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => handleLoadSend(s)}
                        className="font-mono text-[10px] text-primary hover:bg-primary/10 px-2 py-1 border border-primary/30 rounded-sm transition-colors">
                        carregar
                      </button>
                      <button type="button" onClick={() => handleDeleteSend(s.id)}
                        className="text-red-400/50 hover:text-red-400 p-1 transition-colors">
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-border">
              <button type="button" onClick={() => setShowLoadModal(false)}
                className="font-mono text-[10px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border rounded-sm transition-colors">
                fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Historico de Envios */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowHistoryModal(false)}>
          <div className="bg-background border border-border rounded w-full max-w-4xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs font-semibold">historico de envios</span>
                <span className="font-mono text-[10px] text-muted-foreground">{history.length} registros</span>
              </div>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button type="button" onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]); }}
                    className="font-mono text-[10px] text-red-400/60 hover:text-red-400 transition-colors">[limpar tudo]</button>
                )}
                <button type="button" onClick={() => setShowHistoryModal(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
              </div>
            </div>

            {/* Stats bar */}
            {history.length > 0 && (
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50 bg-secondary/20">
                <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                  <Check size={9} className="text-green-400" /> {history.filter(h => h.status === "sent").length} enviados
                </span>
                <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                  <X size={9} className="text-red-400" /> {history.filter(h => h.status === "failed").length} falhas
                </span>
                <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock size={9} /> ultimo: {history[0] ? new Date(history[0].sentAt).toLocaleString("pt-BR") : "--"}
                </span>
              </div>
            )}

            <div className="max-h-[450px] overflow-y-auto">
              {history.length === 0 ? (
                <div className="p-8 text-center font-mono text-xs text-muted-foreground">
                  nenhum envio registrado ainda
                </div>
              ) : (
                <div>
                  {/* Header */}
                  <div className="grid grid-cols-[80px_130px_130px_1fr_50px] gap-2 bg-secondary/30 border-b border-border px-3 py-1.5">
                    <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">hora</span>
                    <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">de (origem)</span>
                    <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">para (destino)</span>
                    <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">mensagem</span>
                    <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest text-right">status</span>
                  </div>
                  {/* Rows */}
                  {history.map((h, i) => (
                    <div key={h.id} className={`grid grid-cols-[80px_130px_130px_1fr_50px] gap-2 px-3 py-2 border-b border-border/30 last:border-b-0 ${i % 2 ? "bg-secondary/10" : ""}`}>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(h.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className="font-mono text-[10px] text-primary">
                        {h.fromPhone ? formatPhone(h.fromPhone) : "--"}
                      </span>
                      <span className="font-mono text-[10px] text-foreground">
                        {formatPhone(h.target)}
                      </span>
                      <div className="min-w-0">
                        <span className="font-mono text-[10px] text-muted-foreground truncate block" title={h.message}>
                          {h.message}
                        </span>
                        {h.error && (
                          <span className="font-mono text-[9px] text-red-400 truncate block">{h.error}</span>
                        )}
                      </div>
                      <div className="flex justify-end">
                        {h.status === "sent" ? (
                          <span className="flex items-center gap-0.5 font-mono text-[9px] text-green-400">
                            <Check size={9} /> ok
                          </span>
                        ) : (
                          <span className="flex items-center gap-0.5 font-mono text-[9px] text-red-400">
                            <X size={9} /> erro
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-border">
              <button type="button" onClick={() => setShowHistoryModal(false)}
                className="font-mono text-[10px] text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border rounded-sm transition-colors">
                fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
