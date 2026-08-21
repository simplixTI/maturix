"use client";

import { useState, useCallback, useEffect } from "react";
import { useSettings } from "@/hooks/useApi";

interface FieldDef {
  key: string;
  label: string;
  value: string;
  type?: "text" | "number";
  suffix?: string;
}

interface SectionDef {
  id: string;
  title: string;
  fields: FieldDef[];
}

const mockCircadianCurve = [
  2, 1, 1, 1, 1, 2, 5, 12, 25, 40, 55, 70,
  80, 85, 90, 95, 100, 95, 85, 70, 50, 30, 15, 5,
];

const mockSections: SectionDef[] = [
  {
    id: "warmup",
    title: "aquecimento / crescimento",
    fields: [
      { key: "growth_factor", label: "fator de crescimento", value: "1.35", type: "number" },
      { key: "day1_limit", label: "limite dia 1", value: "5", type: "number" },
      { key: "max_daily", label: "max msgs diarias", value: "120", type: "number" },
      { key: "warmup_days", label: "duracao aquecimento (dias)", value: "14", type: "number" },
      { key: "ramp_curve", label: "curva de rampa", value: "exponential", type: "text" },
    ],
  },
  {
    id: "safezones",
    title: "zonas seguras / limites",
    fields: [
      { key: "msgs_per_hour", label: "msgs / hora", value: "15", type: "number" },
      { key: "reply_rate_min", label: "taxa resposta min %", value: "30", type: "number" },
      { key: "block_rate_max", label: "taxa bloqueio max %", value: "5", type: "number" },
      { key: "spam_score_max", label: "score spam max", value: "0.3", type: "number" },
      { key: "daily_convos_max", label: "max conversas diarias", value: "60", type: "number" },
    ],
  },
  {
    id: "timing",
    title: "tempo / atrasos",
    fields: [
      { key: "min_delay", label: "atraso min (ms)", value: "3000", type: "number" },
      { key: "max_delay", label: "atraso max (ms)", value: "12000", type: "number" },
      { key: "typing_duration", label: "indicador digitacao (ms)", value: "2500", type: "number" },
      { key: "read_delay", label: "atraso confirmacao leitura (ms)", value: "1500", type: "number" },
      { key: "session_gap", label: "intervalo sessao (min)", value: "45", type: "number" },
    ],
  },
  {
    id: "alerts",
    title: "alertas / webhooks",
    fields: [
      { key: "webhook_url", label: "url webhook", value: "https://hooks.slack.com/services/T00/B00/xxx", type: "text" },
      { key: "alert_on_ban", label: "alertar ao banir", value: "true", type: "text" },
      { key: "alert_on_low_reply", label: "alertar taxa resposta baixa", value: "true", type: "text" },
      { key: "alert_threshold", label: "intervalo alertas (min)", value: "30", type: "number" },
      { key: "notify_email", label: "email notificacao", value: "admin@maturador.io", type: "text" },
    ],
  },
];

export default function SettingsPage() {
  const { data: apiSettings, loading } = useSettings();
  const isLive = apiSettings !== null;

  const circadianCurve = apiSettings?.circadianCurve ?? mockCircadianCurve;

  const [sections, setSections] = useState<SectionDef[]>(mockSections);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [apiLoaded, setApiLoaded] = useState(false);

  // When API settings arrive, merge them into the sections
  useEffect(() => {
    if (apiSettings && !apiLoaded) {
      // Build sections from API data, preserving structure
      const safeZones = apiSettings.safeZones ?? {};
      const timing = apiSettings.timing ?? {};
      const warmup = apiSettings.warmup ?? {};

      const merged: SectionDef[] = mockSections.map((section) => {
        if (section.id === "warmup" && warmup && typeof warmup === "object") {
          const w = warmup as Record<string, unknown>;
          return {
            ...section,
            fields: section.fields.map((f) => {
              if (f.key === "growth_factor" && w.growthFactor !== undefined) return { ...f, value: String(w.growthFactor) };
              if (f.key === "day1_limit" && w.day1Limit !== undefined) return { ...f, value: String(w.day1Limit) };
              if (f.key === "max_daily" && w.maxDaily !== undefined) return { ...f, value: String(w.maxDaily) };
              if (f.key === "warmup_days" && w.warmupDays !== undefined) return { ...f, value: String(w.warmupDays) };
              if (f.key === "ramp_curve" && w.rampCurve !== undefined) return { ...f, value: String(w.rampCurve) };
              return f;
            }),
          };
        }
        if (section.id === "safezones" && safeZones && typeof safeZones === "object") {
          const sz = safeZones as Record<string, unknown>;
          return {
            ...section,
            fields: section.fields.map((f) => {
              if (f.key === "msgs_per_hour" && sz.msgsPerHour !== undefined) return { ...f, value: String(sz.msgsPerHour) };
              if (f.key === "reply_rate_min" && sz.replyRateMin !== undefined) return { ...f, value: String(sz.replyRateMin) };
              if (f.key === "block_rate_max" && sz.blockRateMax !== undefined) return { ...f, value: String(sz.blockRateMax) };
              if (f.key === "spam_score_max" && sz.spamScoreMax !== undefined) return { ...f, value: String(sz.spamScoreMax) };
              if (f.key === "daily_convos_max" && sz.dailyConvosMax !== undefined) return { ...f, value: String(sz.dailyConvosMax) };
              return f;
            }),
          };
        }
        if (section.id === "timing" && timing && typeof timing === "object") {
          const t = timing as Record<string, unknown>;
          return {
            ...section,
            fields: section.fields.map((f) => {
              if (f.key === "min_delay" && t.minDelay !== undefined) return { ...f, value: String(t.minDelay) };
              if (f.key === "max_delay" && t.maxDelay !== undefined) return { ...f, value: String(t.maxDelay) };
              if (f.key === "typing_duration" && t.typingDuration !== undefined) return { ...f, value: String(t.typingDuration) };
              if (f.key === "read_delay" && t.readDelay !== undefined) return { ...f, value: String(t.readDelay) };
              if (f.key === "session_gap" && t.sessionGap !== undefined) return { ...f, value: String(t.sessionGap) };
              return f;
            }),
          };
        }
        return section;
      });

      setSections(merged);
      setApiLoaded(true);
    }
  }, [apiSettings, apiLoaded]);

  const updateField = useCallback((sectionId: string, fieldKey: string, newValue: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.key === fieldKey ? { ...f, value: newValue } : f
              ),
            }
          : s
      )
    );
  }, []);

  const handleSave = useCallback((sectionId: string) => {
    setSaved((prev) => ({ ...prev, [sectionId]: true }));
    setTimeout(() => {
      setSaved((prev) => ({ ...prev, [sectionId]: false }));
    }, 2000);
  }, []);

  return (
    <div className="space-y-6">
      {/* Data source indicator */}
      <div className="flex items-center gap-2">
        <div className={`dot ${isLive ? "dot-ok" : "dot-off"}`} />
        <span className="font-mono text-[10px] text-muted-foreground">
          {isLive ? "dados ao vivo" : "dados offline"}
        </span>
        {loading && <span className="font-mono text-[10px] text-muted-foreground animate-pulse">carregando...</span>}
      </div>

      {/* Circadian display */}
      <div>
        <div className="section-line">curva de atividade circadiana (24h)</div>
        <div className="border border-border rounded overflow-hidden p-3">
          <div className="flex items-end gap-px h-16">
            {circadianCurve.map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex justify-center">
                  <div
                    className="w-full max-w-[14px] bg-primary rounded-sm transition-all"
                    style={{
                      height: `${(val / 100) * 56}px`,
                      opacity: Math.max(0.15, val / 100),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-px mt-1.5">
            {circadianCurve.map((_, i) => (
              <div key={i} className="flex-1 text-center font-mono text-[8px] text-muted-foreground">
                {i % 3 === 0 ? String(i).padStart(2, "0") : ""}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
            <span className="font-mono text-[10px] text-muted-foreground">
              pico: 16:00-17:00 (100%)
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              silencio: 01:00-05:00 (&lt;2%)
            </span>
          </div>
        </div>
      </div>

      {/* Setting sections */}
      {sections.map((section) => (
        <div key={section.id}>
          <div className="section-line">{section.title}</div>
          <div className="border border-border rounded overflow-hidden">
            {section.fields.map((field) => (
              <div
                key={field.key}
                className="term-row justify-between"
              >
                <span className="term-label w-48 shrink-0">{field.label}</span>
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => updateField(section.id, field.key, e.target.value)}
                  className="bg-secondary border-none font-mono text-xs px-2 py-1 rounded-sm focus:ring-1 focus:ring-primary focus:outline-none text-foreground flex-1 max-w-sm text-right"
                />
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/30">
              <span className="font-mono text-[10px] text-muted-foreground">
                {section.fields.length} parametros
              </span>
              <button
                onClick={() => handleSave(section.id)}
                className={`font-mono text-[10px] px-2 py-0.5 rounded-sm transition-all ${
                  saved[section.id]
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-primary hover:bg-primary/5"
                }`}
              >
                {saved[section.id] ? "[salvo]" : "[salvar]"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
