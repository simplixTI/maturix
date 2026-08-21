"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  UserCircle, Loader2, CheckCircle2,
  AlertTriangle, Upload, Phone,
} from "lucide-react";
import { useAccounts } from "@/hooks/useApi";
import { profile as profileApi, type ProfileInfo } from "@/lib/api";

type SaveState = "idle" | "saving" | "saved" | "error";

interface FieldState {
  value: string;
  saveState: SaveState;
  error: string;
}

function mapStatus(s: string): string {
  if (s === "CONNECTED") return "conectado";
  if (s === "PAUSED") return "pausado";
  if (s === "BANNED") return "banido";
  return "aquecendo";
}

function statusDot(s: string): string {
  const mapped = mapStatus(s);
  if (mapped === "conectado") return "dot-ok";
  if (mapped === "aquecendo") return "dot-warn";
  if (mapped === "pausado") return "dot-off";
  if (mapped === "banido") return "dot-err";
  return "dot-off";
}

export default function PerfilPage() {
  const { data: apiAccounts, loading: accountsLoading } = useAccounts();
  const accounts = apiAccounts ?? [];
  const connectedAccounts = accounts.filter(
    (a) => a.status === "CONNECTED" || a.status === "WARMING"
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<ProfileInfo | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Field states
  const [nameField, setNameField] = useState<FieldState>({ value: "", saveState: "idle", error: "" });
  const [bioField, setBioField] = useState<FieldState>({ value: "", saveState: "idle", error: "" });
  const [pictureState, setPictureState] = useState<SaveState>("idle");
  const [pictureError, setPictureError] = useState("");
  const [picturePreview, setPicturePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Cooldown: 30s per field after each save
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const cooldownTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const startCooldown = useCallback((field: string) => {
    setCooldowns(prev => ({ ...prev, [field]: 30 }));
    if (cooldownTimers.current[field]) clearInterval(cooldownTimers.current[field]);
    cooldownTimers.current[field] = setInterval(() => {
      setCooldowns(prev => {
        const val = (prev[field] ?? 0) - 1;
        if (val <= 0) {
          clearInterval(cooldownTimers.current[field]);
          const next = { ...prev };
          delete next[field];
          return next;
        }
        return { ...prev, [field]: val };
      });
    }, 1000);
  }, []);

  const getCooldown = (field: string) => cooldowns[field] ?? 0;

  // Auto-select first connected account
  useEffect(() => {
    if (!selectedId && connectedAccounts.length > 0) {
      setSelectedId(connectedAccounts[0].id);
    }
  }, [connectedAccounts, selectedId]);

  // Fetch profile when account selected
  const fetchProfile = useCallback(async (accountId: string) => {
    setProfileLoading(true);
    setProfileError(null);
    setProfileData(null);
    setPicturePreview(null);
    try {
      const data = await profileApi.get(accountId);
      if (data) {
        setProfileData(data);
        setNameField({ value: data.name ?? "", saveState: "idle", error: "" });
        setBioField({ value: data.bio ?? "", saveState: "idle", error: "" });
      } else {
        setProfileError("Falha ao carregar identidade. A sessao pode nao estar conectada.");
      }
    } catch {
      setProfileError("Erro de rede ao carregar identidade.");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchProfile(selectedId);
    }
  }, [selectedId, fetchProfile]);

  // Save handlers
  const handleSaveName = useCallback(async () => {
    if (!selectedId || getCooldown("name") > 0) return;
    setNameField((prev) => ({ ...prev, saveState: "saving", error: "" }));
    try {
      const result = await profileApi.updateName(selectedId, nameField.value);
      if (result?.success) {
        setNameField((prev) => ({ ...prev, saveState: "saved" }));
        startCooldown("name");
        setTimeout(() => setNameField((prev) => ({ ...prev, saveState: "idle" })), 2500);
      } else {
        setNameField((prev) => ({ ...prev, saveState: "error", error: "Falha ao atualizar nome" }));
      }
    } catch {
      setNameField((prev) => ({ ...prev, saveState: "error", error: "Erro de rede" }));
    }
  }, [selectedId, nameField.value, startCooldown]);

  const handleSaveBio = useCallback(async () => {
    if (!selectedId || getCooldown("bio") > 0) return;
    setBioField((prev) => ({ ...prev, saveState: "saving", error: "" }));
    try {
      const result = await profileApi.updateBio(selectedId, bioField.value);
      if (result?.success) {
        setBioField((prev) => ({ ...prev, saveState: "saved" }));
        startCooldown("bio");
        setTimeout(() => setBioField((prev) => ({ ...prev, saveState: "idle" })), 2500);
      } else {
        setBioField((prev) => ({ ...prev, saveState: "error", error: "Falha ao atualizar bio" }));
      }
    } catch {
      setBioField((prev) => ({ ...prev, saveState: "error", error: "Erro de rede" }));
    }
  }, [selectedId, bioField.value, startCooldown]);

  const processImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setPictureError("O arquivo deve ser uma imagem (jpeg, png, webp)");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPictureError("A imagem deve ter menos de 5MB");
      return;
    }
    setPictureError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPicturePreview(dataUrl);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processImageFile(file);
    },
    [processImageFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processImageFile(file);
    },
    [processImageFile]
  );

  const handleUploadPicture = useCallback(async () => {
    if (!selectedId || !picturePreview || getCooldown("picture") > 0) return;
    setPictureState("saving");
    setPictureError("");
    try {
      const result = await profileApi.updatePicture(selectedId, picturePreview);
      if (result?.success) {
        setPictureState("saved");
        startCooldown("picture");
        setTimeout(() => {
          setPictureState("idle");
          fetchProfile(selectedId);
        }, 2500);
      } else {
        setPictureState("error");
        setPictureError("Falha ao enviar foto");
      }
    } catch {
      setPictureState("error");
      setPictureError("Erro de rede ao enviar foto");
    }
  }, [selectedId, picturePreview, fetchProfile, startCooldown]);

  const selectedAccount = accounts.find((a) => a.id === selectedId);
  const isLive = apiAccounts !== null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className={`dot ${isLive ? "dot-ok" : "dot-off"}`} />
        <span className="font-mono text-[10px] text-muted-foreground">
          {isLive ? "ao vivo" : "offline"}
        </span>
        {accountsLoading && (
          <span className="font-mono text-[10px] text-muted-foreground animate-pulse">
            carregando...
          </span>
        )}
      </div>

      <div className="flex gap-0 min-h-[calc(100dvh-140px)]">
        {/* Left panel — account list */}
        <div className="w-64 border border-border rounded-l overflow-hidden shrink-0 flex flex-col">
          <div className="section-line !mb-0 !border-b border-border bg-secondary/50 px-3 py-1.5">
            contas ({connectedAccounts.length} online)
          </div>
          <div className="flex-1 overflow-y-auto">
            {accounts.length === 0 && !accountsLoading && (
              <div className="p-4 text-center font-mono text-xs text-muted-foreground">
                nenhuma conta registrada
              </div>
            )}
            {accounts.map((a) => {
              const isSelected = a.id === selectedId;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`w-full text-left px-3 py-2 border-b border-border transition-colors ${
                    isSelected
                      ? "bg-primary/5 border-r-2 border-r-primary"
                      : "hover:bg-secondary/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`dot ${statusDot(a.status)}`} />
                    <span className="font-mono text-xs truncate">
                      {a.phoneNumber}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 ml-5">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {mapStatus(a.status)}
                    </span>
                    {a.displayName && (
                      <span className="font-mono text-[10px] text-muted-foreground truncate">
                        / {a.displayName}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right panel — profile editor */}
        <div className="flex-1 border border-l-0 border-border rounded-r overflow-y-auto">
          {!selectedId ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <UserCircle
                  size={32}
                  strokeWidth={1}
                  className="text-muted-foreground mx-auto"
                />
                <div className="font-mono text-xs text-muted-foreground">
                  selecione uma conta para gerenciar identidade
                </div>
              </div>
            </div>
          ) : profileLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <Loader2
                  size={20}
                  className="text-primary mx-auto animate-spin"
                />
                <div className="font-mono text-xs text-muted-foreground">
                  carregando identidade...
                </div>
              </div>
            </div>
          ) : profileError ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <AlertTriangle
                  size={20}
                  className="text-yellow-400 mx-auto"
                />
                <div className="font-mono text-xs text-muted-foreground">
                  {profileError}
                </div>
                <button
                  onClick={() => selectedId && fetchProfile(selectedId)}
                  className="font-mono text-[10px] text-primary hover:text-primary/80 transition-colors"
                >
                  [tentar novamente]
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-5">
              {/* Account header */}
              <div className="flex items-center gap-3">
                <Phone size={13} className="text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">
                  {selectedAccount?.phoneNumber}
                </span>
                <div className={`dot ${statusDot(selectedAccount?.status ?? "")}`} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {mapStatus(selectedAccount?.status ?? "")}
                </span>
              </div>

              {/* Profile picture section */}
              <div>
                <div className="section-line">foto de perfil</div>
                <div className="border border-border rounded overflow-hidden">
                  <div className="p-4 flex gap-5">
                    {/* Current / preview photo */}
                    <div className="shrink-0">
                      <div className="w-24 h-24 rounded border border-border bg-secondary flex items-center justify-center overflow-hidden">
                        {picturePreview ? (
                          <img
                            src={picturePreview}
                            alt="preview"
                            className="w-full h-full object-cover"
                          />
                        ) : profileData?.pictureUrl ? (
                          <img
                            src={profileData.pictureUrl}
                            alt="profile"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <UserCircle
                            size={40}
                            strokeWidth={1}
                            className="text-muted-foreground"
                          />
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground text-center mt-1.5">
                        {picturePreview ? "pre-visualizacao" : "atual"}
                      </div>
                    </div>

                    {/* Upload area */}
                    <div className="flex-1 space-y-3">
                      <div
                        ref={dropZoneRef}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border border-dashed rounded p-4 text-center cursor-pointer transition-colors ${
                          dragOver
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-primary/5"
                        }`}
                      >
                        <Upload
                          size={16}
                          strokeWidth={1.5}
                          className="text-muted-foreground mx-auto mb-1.5"
                        />
                        <div className="font-mono text-[11px] text-muted-foreground">
                          arraste imagem aqui ou clique para selecionar
                        </div>
                        <div className="font-mono text-[9px] text-muted-foreground mt-1">
                          jpeg, png, webp / max 5MB
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                      </div>

                      {picturePreview && (
                        <div className="flex items-center gap-2">
                          <SaveButton
                            state={pictureState}
                            onClick={handleUploadPicture}
                            label="enviar foto"
                            cooldown={getCooldown("picture")}
                          />
                          <button
                            onClick={() => {
                              setPicturePreview(null);
                              setPictureState("idle");
                              setPictureError("");
                            }}
                            className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            [cancelar]
                          </button>
                        </div>
                      )}

                      {pictureError && (
                        <div className="font-mono text-[10px] text-red-400 flex items-center gap-1">
                          <AlertTriangle size={10} />
                          {pictureError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Display name section */}
              <div>
                <div className="section-line">nome de exibicao</div>
                <div className="border border-border rounded overflow-hidden">
                  <div className="p-3 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={nameField.value}
                        onChange={(e) =>
                          setNameField((prev) => ({
                            ...prev,
                            value: e.target.value,
                            saveState: "idle",
                            error: "",
                          }))
                        }
                        maxLength={25}
                        placeholder="nome de exibicao"
                        className="flex-1 bg-secondary border-none font-mono text-xs px-3 py-2 rounded-sm focus:ring-1 focus:ring-primary focus:outline-none text-foreground placeholder:text-muted-foreground/50"
                      />
                      <SaveButton
                        state={nameField.saveState}
                        onClick={handleSaveName}
                        label="salvar"
                        cooldown={getCooldown("name")}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {nameField.value.length}/25 caracteres
                      </span>
                      {nameField.error && (
                        <span className="font-mono text-[10px] text-red-400">
                          {nameField.error}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bio / status section */}
              <div>
                <div className="section-line">bio / recado</div>
                <div className="border border-border rounded overflow-hidden">
                  <div className="p-3 space-y-2">
                    <textarea
                      value={bioField.value}
                      onChange={(e) =>
                        setBioField((prev) => ({
                          ...prev,
                          value: e.target.value,
                          saveState: "idle",
                          error: "",
                        }))
                      }
                      maxLength={139}
                      rows={3}
                      placeholder="bio / texto sobre"
                      className="w-full bg-secondary border-none font-mono text-xs px-3 py-2 rounded-sm focus:ring-1 focus:ring-primary focus:outline-none text-foreground placeholder:text-muted-foreground/50 resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {bioField.value.length}/139 caracteres
                      </span>
                      <div className="flex items-center gap-2">
                        {bioField.error && (
                          <span className="font-mono text-[10px] text-red-400">
                            {bioField.error}
                          </span>
                        )}
                        <SaveButton
                          state={bioField.saveState}
                          onClick={handleSaveBio}
                          label="salvar"
                          cooldown={getCooldown("bio")}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Profile info (read-only) */}
              {profileData && (
                <div>
                  <div className="section-line">info da sessao</div>
                  <div className="border border-border rounded overflow-hidden">
                    <div className="term-row justify-between">
                      <span className="term-label">jid</span>
                      <span className="font-mono text-xs text-muted-foreground truncate max-w-[300px]">
                        {profileData.jid}
                      </span>
                    </div>
                    <div className="term-row justify-between">
                      <span className="term-label">id da conta</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {profileData.accountId}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Anti-ban warning */}
              <div className="border border-yellow-500/20 bg-yellow-500/5 rounded p-3 flex gap-2">
                <AlertTriangle
                  size={14}
                  className="text-yellow-400 shrink-0 mt-0.5"
                />
                <div className="font-mono text-[10px] text-muted-foreground space-y-1">
                  <div className="text-yellow-400">aviso anti-ban</div>
                  <div>
                    Alteracoes de perfil sao limitadas a 1 por 30 segundos por campo.
                    Evite mudancas frequentes para reduzir risco de deteccao.
                    Mudancas de nome nos primeiros dias de aquecimento podem atrair atencao.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveButton({
  state,
  onClick,
  label,
  cooldown = 0,
}: {
  state: SaveState;
  onClick: () => void;
  label: string;
  cooldown?: number;
}) {
  const disabled = state === "saving" || cooldown > 0;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-mono text-[10px] px-3 py-1.5 rounded-sm border transition-all flex items-center gap-1.5 ${
        cooldown > 0
          ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-400 cursor-not-allowed"
          : state === "saved"
          ? "border-primary/30 bg-primary/10 text-primary"
          : state === "error"
          ? "border-red-500/30 bg-red-500/10 text-red-400"
          : state === "saving"
          ? "border-border bg-secondary text-muted-foreground"
          : "border-border hover:border-primary/30 hover:bg-primary/5 text-muted-foreground hover:text-primary"
      }`}
    >
      {state === "saving" && <Loader2 size={10} className="animate-spin" />}
      {state === "saved" && cooldown === 0 && <CheckCircle2 size={10} />}
      {state === "error" && <AlertTriangle size={10} />}
      {cooldown > 0
        ? `aguarde ${cooldown}s`
        : state === "saving"
        ? "salvando..."
        : state === "saved"
        ? "salvo"
        : state === "error"
        ? "erro"
        : `[${label}]`}
    </button>
  );
}
