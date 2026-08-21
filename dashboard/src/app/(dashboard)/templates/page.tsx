"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useTemplates } from "@/hooks/useApi";
import { templates as templatesApi, type TemplateItem } from "@/lib/api";

interface Template {
  id: string;
  name: string;
  category: string;
  body: {
    greeting: string;
    body: string;
    cta: string;
    signature: string;
  };
}

/* ── mock templates ── */

const mockTemplates: Template[] = [
  {
    id: "t1",
    name: "initial_contact",
    category: "warmup",
    body: {
      greeting: "{Oi|Ola|E ai|Fala}",
      body: "{tudo bem|como vai|tudo certo|beleza}? {Vi seu perfil|Te encontrei|Achei seu contato} e {queria trocar uma ideia|gostaria de conversar|queria bater um papo}.",
      cta: "{Podemos conversar|Bora trocar ideia|Vamos bater papo}?",
      signature: "{Abraco|Valeu|Falou|Ate mais}",
    },
  },
  {
    id: "t2",
    name: "follow_up",
    category: "warmup",
    body: {
      greeting: "{Oi|Ola|E ai} de novo",
      body: "{Mandei mensagem antes|Te mandei msg|Falei contigo} e {queria saber se viu|queria ver se recebeu|to esperando retorno}.",
      cta: "{Me da um toque|Responde quando puder|Fica a vontade pra responder}.",
      signature: "{Abraco|Valeu|Tmj}",
    },
  },
  {
    id: "t3",
    name: "group_invite",
    category: "engagement",
    body: {
      greeting: "{Fala|E ai|Oi}",
      body: "{Tenho um grupo|Participo de um grupo|Criei um grupo} sobre {negocios|empreendedorismo|marketing digital} que {ta bombando|ta crescendo|tem muito conteudo bom}.",
      cta: "{Quer participar|Bora entrar|Te adiciono}?",
      signature: "{Abraco|Falou|Valeu}",
    },
  },
  {
    id: "t4",
    name: "reactivation",
    category: "recovery",
    body: {
      greeting: "{Oi|Ola|Fala}",
      body: "{Faz tempo que nao conversamos|Sumiu hein|Quanto tempo}! {Como andam as coisas|Tudo bem por ai|Como ta}?",
      cta: "{Vamos marcar algo|Bora conversar|Me conta as novidades}.",
      signature: "{Saudades|Abraco|Ate mais}",
    },
  },
  {
    id: "t5",
    name: "broadcast_casual",
    category: "broadcast",
    body: {
      greeting: "{E ai|Fala|Opa} {pessoal|galera|turma}",
      body: "{Passando pra avisar|Queria compartilhar|To mandando} {uma novidade|algo legal|uma info importante}: {temos evento|lancamos algo novo|tem conteudo novo} {essa semana|em breve|hoje}.",
      cta: "{Quem ta dentro|Bora|Conta comigo}?",
      signature: "{Tmj|Valeu|Abraco}",
    },
  },
  {
    id: "t6",
    name: "reply_trigger",
    category: "warmup",
    body: {
      greeting: "{Oi|Ola}",
      body: "{Voce prefere|Me diz}: {cafe ou cha|praia ou montanha|gato ou cachorro}? {To curioso|Quero saber|Me conta}!",
      cta: "{Responde ai|Me fala|Manda ver}!",
      signature: "{haha|risos|kk}",
    },
  },
];

/* ── helpers ── */

function resolveSpintax(text: string): string {
  return text.replace(/\{([^}]+)\}/g, (_, options: string) => {
    const parts = options.split("|");
    return parts[Math.floor(Math.random() * parts.length)];
  });
}

function generateVariation(tpl: Template): string {
  const { greeting, body, cta, signature } = tpl.body;
  return `${resolveSpintax(greeting)}, ${resolveSpintax(body)} ${resolveSpintax(cta)} ${resolveSpintax(signature)}`;
}

/** Map API TemplateItem to our local Template shape */
function mapApiTemplate(item: TemplateItem): Template {
  // messages field from API can be an object with greeting/body/cta/signature,
  // or an array of message objects, or a raw spintax string
  const msgs = item.messages as Record<string, unknown> | unknown[];

  if (msgs && typeof msgs === "object" && !Array.isArray(msgs)) {
    // Object shape: { greeting, body, cta, signature }
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      body: {
        greeting: String((msgs as Record<string, unknown>).greeting ?? ""),
        body: String((msgs as Record<string, unknown>).body ?? ""),
        cta: String((msgs as Record<string, unknown>).cta ?? ""),
        signature: String((msgs as Record<string, unknown>).signature ?? ""),
      },
    };
  }

  if (Array.isArray(msgs) && msgs.length > 0) {
    // Array shape: use first message entry
    const first = msgs[0] as Record<string, unknown>;
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      body: {
        greeting: String(first.greeting ?? first.text ?? ""),
        body: String(first.body ?? first.content ?? ""),
        cta: String(first.cta ?? ""),
        signature: String(first.signature ?? ""),
      },
    };
  }

  // Fallback: empty body
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    body: { greeting: "", body: String(msgs ?? ""), cta: "", signature: "" },
  };
}

function JsonHighlight({ data }: { data: object }) {
  const json = JSON.stringify(data, null, 2);
  const lines = json.split("\n");

  return (
    <pre className="font-mono text-xs leading-relaxed">
      {lines.map((line, i) => {
        const parts: React.ReactNode[] = [];
        let remaining = line;
        // Match JSON key
        const keyMatch = remaining.match(/^(\s*)"([^"]+)"(\s*:\s*)/);
        if (keyMatch) {
          parts.push(<span key={`sp-${i}`}>{keyMatch[1]}</span>);
          parts.push(<span key={`k-${i}`} className="text-primary">&quot;{keyMatch[2]}&quot;</span>);
          parts.push(<span key={`c-${i}`} className="text-muted-foreground">{keyMatch[3]}</span>);
          remaining = remaining.slice(keyMatch[0].length);
        }

        // Match string value
        const strMatch = remaining.match(/^"([^"]*)"(,?)$/);
        if (strMatch) {
          parts.push(<span key={`v-${i}`} className="text-foreground">&quot;{strMatch[1]}&quot;</span>);
          if (strMatch[2]) parts.push(<span key={`cm-${i}`} className="text-muted-foreground">,</span>);
        } else {
          // Brackets and other chars
          const bracketHighlighted = remaining.replace(/([{}\[\]])/g, "%%BRACKET%%$1%%END%%");
          const segs = bracketHighlighted.split(/%%BRACKET%%|%%END%%/);
          segs.forEach((seg, si) => {
            if (/^[{}\[\]]$/.test(seg)) {
              parts.push(<span key={`b-${i}-${si}`} className="text-muted-foreground">{seg}</span>);
            } else if (seg) {
              parts.push(<span key={`t-${i}-${si}`} className="text-foreground">{seg}</span>);
            }
          });
        }

        return (
          <div key={i}>
            {parts.length > 0 ? parts : <span>{line}</span>}
          </div>
        );
      })}
    </pre>
  );
}

export default function TemplatesPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [variations, setVariations] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [apiVariations, setApiVariations] = useState<string[] | null>(null);

  const { data: apiTemplates, loading } = useTemplates();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Map API templates to local shape, fall back to mock
  const isLive = apiTemplates !== null && apiTemplates.length > 0;
  const templates: Template[] = useMemo(() => {
    if (apiTemplates && apiTemplates.length > 0) {
      return apiTemplates.map(mapApiTemplate);
    }
    return mockTemplates;
  }, [apiTemplates]);

  // Set initial activeId when templates are available
  useEffect(() => {
    if (templates.length > 0 && (activeId === null || !templates.find((t) => t.id === activeId))) {
      setActiveId(templates[0].id);
      setVariations(Array.from({ length: 5 }, () => generateVariation(templates[0])));
    }
  }, [templates, activeId]);

  const active = templates.find((t) => t.id === activeId) ?? templates[0];

  const reroll = useCallback(async () => {
    if (!active) return;
    // Try API spintax preview first
    const fullText = `${active.body.greeting}, ${active.body.body} ${active.body.cta} ${active.body.signature}`;
    if (isLive) {
      const result = await templatesApi.previewSpintax(fullText, 5);
      if (result && result.variations && result.variations.length > 0) {
        setApiVariations(result.variations);
        setVariations(result.variations);
        return;
      }
    }
    // Fallback: local spintax resolution
    setApiVariations(null);
    setVariations(Array.from({ length: 5 }, () => generateVariation(active)));
  }, [active, isLive]);

  const selectTemplate = useCallback((id: string) => {
    setActiveId(id);
    setApiVariations(null);
    const tpl = templates.find((t) => t.id === id);
    if (tpl) {
      setVariations(Array.from({ length: 5 }, () => generateVariation(tpl)));
    }
  }, [templates]);

  if (!mounted) return <div className="font-mono text-xs text-muted-foreground p-4">carregando modelos...</div>;

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
        nenhum modelo disponivel
      </div>
    );
  }

  return (
    <div className="flex h-full -m-4 md:-m-5">
      {/* Left panel: template list */}
      <div className="w-64 border-r border-border shrink-0 overflow-y-auto">
        <div className="section-line mx-3 mt-3 flex items-center justify-between">
          <span>modelos ({templates.length})</span>
          <span className="flex items-center gap-1.5">
            <span className={`dot ${isLive ? "dot-ok" : "dot-off"}`} />
            <span className="font-mono text-[9px] text-muted-foreground">
              {isLive ? "ao vivo" : "offline"}
            </span>
          </span>
        </div>
        {loading && templates.length === 0 && (
          <div className="px-3 py-2 font-mono text-[10px] text-muted-foreground animate-pulse">carregando...</div>
        )}
        {templates.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => selectTemplate(tpl.id)}
            className={`w-full text-left px-3 py-1.5 font-mono text-xs flex items-center justify-between transition-colors ${
              tpl.id === activeId
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}
            style={{ borderBottom: "1px solid hsl(0 0% 8%)" }}
          >
            <span className="truncate">{tpl.name}</span>
            <span className="term-label ml-2 shrink-0">{tpl.category}</span>
          </button>
        ))}
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="px-4 pt-3 pb-2 border-b border-border flex items-center justify-between">
          <div>
            <span className="font-mono text-xs text-primary">{active.name}</span>
            <span className="font-mono text-[10px] text-muted-foreground ml-3">{active.category}</span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">id: {active.id}</span>
        </div>

        {/* JSON display */}
        <div className="px-4 py-3 border-b border-border">
          <div className="section-line">bruto / json</div>
          <div className="bg-secondary/30 border border-border rounded overflow-hidden px-3 py-2 overflow-x-auto">
            <JsonHighlight data={active.body} />
          </div>
        </div>

        {/* Preview */}
        <div className="px-4 py-3">
          <div className="section-line flex items-center justify-between">
            <span>
              pre-visualizacao spintax ({variations.length} variacoes)
              {apiVariations !== null && (
                <span className="text-primary ml-2 text-[9px]">via API</span>
              )}
            </span>
            <button
              onClick={reroll}
              className="font-mono text-[10px] text-primary hover:text-primary/80 transition-colors uppercase tracking-wider"
            >
              [gerar]
            </button>
          </div>
          {variations.length === 0 ? (
            <div className="border border-border rounded p-4 font-mono text-xs text-muted-foreground text-center">
              clique em [gerar] para pre-visualizar variacoes spintax
            </div>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              {variations.map((v, i) => (
                <div key={i} className="term-row">
                  <span className="text-muted-foreground font-mono text-[10px] w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-mono text-xs text-foreground">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
