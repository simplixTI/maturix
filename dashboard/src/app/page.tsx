"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { Shield, Zap, BarChart3, Globe, Clock, ChevronRight, ArrowRight, Check, Lock, Cpu, MessageSquare, Users, Flame } from "lucide-react";
import { MaturixLogo } from "@/components/brand/MaturixLogo";

/* ── Data ── */
const features = [
  { icon: Shield, title: "Anti-Ban 5 Camadas", desc: "SafeZoneGuard, simulacao comportamental, jitter gaussiano, stealth connect e deteccao automatica.", tag: "SECURITY" },
  { icon: Zap, title: "100% Automatico", desc: "Conversas naturais com Spintax, typing indicators, read receipts e reacoes emoji entre seus numeros.", tag: "AUTOMATION" },
  { icon: BarChart3, title: "Real-time Dashboard", desc: "Metricas ao vivo: reply rate, block rate, warmup progress. Alertas instantaneos via WebSocket.", tag: "MONITORING" },
  { icon: Globe, title: "Proxy Isolado", desc: "Cada numero com proxy residencial/mobile proprio. Rotacao automatica com health check.", tag: "NETWORK" },
  { icon: Clock, title: "Ritmo Circadiano", desc: "Simula horarios humanos reais. Mais ativo de manha, menos a noite. 14 dias progressivos.", tag: "BEHAVIOR" },
  { icon: Cpu, title: "Escala Enterprise", desc: "100+ numeros simultaneos. PostgreSQL, filas em memoria, reconexao automatica, graceful shutdown.", tag: "SCALE" },
];

const plans = [
  { name: "Starter", price: "97", accounts: "10", features: ["10 contas simultaneas", "Warmup automatico", "Dashboard basico", "Suporte email"] },
  { name: "Pro", price: "197", accounts: "50", popular: true, features: ["50 contas simultaneas", "Proxy rotation", "Alertas webhook", "Templates ilimitados", "Suporte prioritario"] },
  { name: "Enterprise", price: "497", accounts: "200+", features: ["200+ contas", "API dedicada", "Proxy pool proprio", "SLA 99.9%", "Suporte dedicado", "Setup assistido"] },
];

const timelineSteps = [
  { day: "Dia 1-3", phase: "FOUNDATION", title: "Construindo confianca", desc: "15-27 msg/dia. Texto e reacoes. Contatos limitados.", pct: 20, color: "text-blue-400", bg: "bg-blue-400" },
  { day: "Dia 4-5", phase: "EXPANSION", title: "Expandindo atividade", desc: "37-49 msg/dia. Imagens, stickers e grupos liberados.", pct: 40, color: "text-cyan-400", bg: "bg-cyan-400" },
  { day: "Dia 6-7", phase: "SCALING", title: "Escalando volume", desc: "67-90 msg/dia. Audio e status automaticos.", pct: 60, color: "text-primary", bg: "bg-primary" },
  { day: "Dia 8-10", phase: "ACCELERATION", title: "Acelerando", desc: "122-221 msg/dia. Todas funcionalidades ativas.", pct: 80, color: "text-yellow-400", bg: "bg-yellow-400" },
  { day: "Dia 11-14", phase: "MATURE", title: "Capacidade maxima", desc: "298-400 msg/dia. Pronto para operacao comercial.", pct: 100, color: "text-primary", bg: "bg-primary" },
];

/* ── Typing animation hook ── */
function useTypingEffect(lines: string[], speed = 35, lineDelay = 400) {
  const [displayed, setDisplayed] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState(0);
  const [currentChar, setCurrentChar] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) return;
    if (currentLine >= lines.length) { setDone(true); return; }

    const line = lines[currentLine];
    if (currentChar < line.length) {
      const t = setTimeout(() => {
        setDisplayed(prev => {
          const next = [...prev];
          next[currentLine] = (next[currentLine] || "") + line[currentChar];
          return next;
        });
        setCurrentChar(c => c + 1);
      }, speed + Math.random() * 20);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => { setCurrentLine(l => l + 1); setCurrentChar(0); }, lineDelay);
      return () => clearTimeout(t);
    }
  }, [currentLine, currentChar, lines, speed, lineDelay, done]);

  return { displayed, done };
}

/* ── Counter animation hook ── */
function useCountUp(target: number, duration = 2000, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setValue(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return value;
}

/* ── Scroll visibility hook ── */
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* ── Page ── */
export default function LandingPage() {
  const terminalLines = [
    "$ maturix init --accounts 47",
    "> connecting to whatsapp websocket...",
    "> 47 sessions established",
    "> warmup engine started (14-day cycle)",
    "> anti-ban: 5 layers active",
    "> proxy pool: 12 residential IPs assigned",
    "> circadian rhythm: enabled",
    "> status: all systems operational",
    "> messages today: 3,104 | reply rate: 67%",
  ];
  const { displayed, done } = useTypingEffect(terminalLines, 25, 300);
  const statsView = useInView(0.3);
  const featuresView = useInView(0.1);

  const c1 = useCountUp(2147000, 2500, statsView.visible);
  const c2 = useCountUp(14, 1500, statsView.visible);
  const c3 = useCountUp(992, 2000, statsView.visible);
  const c4 = useCountUp(5, 1000, statsView.visible);

  return (
    <div className="min-h-dvh bg-background overflow-x-hidden">
      {/* Grid background */}
      <div className="fixed inset-0 z-0 opacity-[0.03]" style={{
        backgroundImage: `linear-gradient(hsl(214 90% 58% / 0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(214 90% 58% / 0.3) 1px, transparent 1px)`,
        backgroundSize: "60px 60px",
      }} />

      {/* Radial glow behind hero */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] z-0 opacity-20 pointer-events-none"
        style={{ background: "radial-gradient(ellipse, hsl(214 90% 58% / 0.15), transparent 70%)" }} />

      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14 px-4 md:px-6">
          <MaturixLogo variant="compact" />
          <div className="hidden md:flex items-center gap-8 font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
            <a href="#como-funciona" className="hover:text-primary transition-colors">processo</a>
            <a href="#features" className="hover:text-primary transition-colors">features</a>
            <a href="#pricing" className="hover:text-primary transition-colors">planos</a>
            <a href="#faq" className="hover:text-primary transition-colors">faq</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:block">login</Link>
            <Link href="/register" className="font-mono text-xs text-white px-4 py-2 rounded-sm transition-all hover:opacity-90 hover:shadow-[0_0_20px_hsl(214_90%_58%_/_0.3)]"
              style={{ background: "linear-gradient(95deg,#1B6FD8,#00C4D4)" }}>
              iniciar gratis
            </Link>
          </div>
        </div>
      </nav>

      {/* ══════ HERO ══════ */}
      <section className="relative z-10 pt-32 pb-8 px-4 md:px-6">
        <div className="max-w-5xl mx-auto">
          {/* Badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2.5 font-mono text-[10px] text-primary bg-primary/5 border border-primary/20 px-4 py-1.5 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_6px_hsl(142_72%_45%)]" />
              sistema operacional &mdash; 116 templates &mdash; 5 camadas anti-ban
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-center text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
            Aqueça seus chips<br />
            <span className="relative">
              <span className="text-primary">WhatsApp</span>
              <svg className="absolute -bottom-2 left-0 w-full h-3 text-primary/30" viewBox="0 0 200 8" fill="none" preserveAspectRatio="none">
                <path d="M0 7 Q50 0 100 4 Q150 8 200 1" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            </span>
            {" "}em escala.
          </h1>

          <p className="text-center mt-6 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            O unico sistema de maturacao que simula <span className="text-foreground font-medium">comportamento humano real</span> em
            100+ numeros simultaneos. Warmup progressivo de 14 dias com taxa de bloqueio inferior a 0.5%.
          </p>

          {/* CTA buttons */}
          <div className="flex items-center justify-center gap-3 mt-8">
            <Link href="/register"
              className="group font-mono text-sm text-white px-7 py-3 rounded-sm transition-all hover:opacity-90 hover:shadow-[0_0_30px_hsl(214_90%_58%_/_0.3)] flex items-center gap-2"
              style={{ background: "linear-gradient(95deg,#1B6FD8,#00C4D4)" }}>
              comecar agora <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link href="#como-funciona"
              className="font-mono text-sm text-muted-foreground border border-border px-7 py-3 rounded-sm hover:text-foreground hover:border-primary/30 transition-all">
              como funciona
            </Link>
          </div>

          {/* Animated terminal */}
          <div className="max-w-3xl mx-auto mt-16">
            <div className="border border-border/60 rounded-lg overflow-hidden shadow-[0_0_60px_hsl(142_72%_45%_/_0.04)]">
              <div className="flex items-center gap-2 px-4 py-2 bg-secondary/30 border-b border-border/60">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground ml-2">maturix &mdash; session</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="font-mono text-[10px] text-primary">live</span>
                </div>
              </div>
              <div className="p-5 font-mono text-[13px] leading-6 min-h-[260px]">
                {displayed.map((line, i) => (
                  <div key={i} className={`${i === 0 ? "text-foreground" : line.startsWith(">") ? (line.includes("operational") || line.includes("established") || line.includes("enabled") || line.includes("active") ? "text-primary" : "text-muted-foreground") : "text-foreground"}`}>
                    {line}
                  </div>
                ))}
                {!done && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />}
                {done && (
                  <div className="mt-3 text-muted-foreground">
                    $ <span className="text-primary">_</span><span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════ STATS ══════ */}
      <section ref={statsView.ref} className="relative z-10 border-y border-border/50 mt-16">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4">
          {[
            { value: c1 > 1000000 ? `${(c1/1000000).toFixed(1)}M` : `${c1}`, suffix: "+", label: "mensagens enviadas" },
            { value: `${c2}`, suffix: "d", label: "warmup completo" },
            { value: `${(c3/10).toFixed(1)}`, suffix: "%", label: "taxa de entrega" },
            { value: `<0.${c4}`, suffix: "%", label: "taxa de bloqueio" },
          ].map((s, i) => (
            <div key={i} className={`px-6 py-10 text-center ${i > 0 ? "border-l border-border/50" : ""} group hover:bg-primary/[0.02] transition-colors`}>
              <div className="font-mono text-3xl md:text-4xl font-bold text-primary tabular-nums">{s.value}<span className="text-primary/60">{s.suffix}</span></div>
              <div className="font-mono text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════ TIMELINE ══════ */}
      <section id="como-funciona" className="relative z-10 py-24 px-4 md:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <div className="font-mono text-[10px] text-primary uppercase tracking-[0.2em] mb-3">PROCESSO</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">14 dias para maturacao completa</h2>
            <p className="text-muted-foreground mt-3 text-sm max-w-lg mx-auto">Cada numero passa por 5 fases de aquecimento progressivo, simulando uso organico real.</p>
          </div>
          <Timeline />
        </div>
      </section>

      {/* ══════ FEATURES ══════ */}
      <section id="features" ref={featuresView.ref} className="relative z-10 py-24 px-4 md:px-6 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="font-mono text-[10px] text-primary uppercase tracking-[0.2em] mb-3">FEATURES</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Tudo que voce precisa</h2>
            <p className="text-muted-foreground mt-3 text-sm">Sistema completo de maturacao enterprise</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border/50 rounded-lg overflow-hidden">
            {features.map((f, i) => (
              <div key={i}
                className={`bg-background p-6 group hover:bg-primary/[0.02] transition-all duration-300 ${featuresView.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
                style={{ transitionDelay: `${i * 100}ms` }}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded bg-primary/5 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                    <f.icon size={15} className="text-primary" strokeWidth={1.5} />
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.15em]">{f.tag}</span>
                </div>
                <h3 className="text-sm font-semibold mb-2">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ SOCIAL PROOF ══════ */}
      <section className="relative z-10 py-16 px-4 md:px-6 border-y border-border/50">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Lock, stat: "AES-256", label: "Criptografia de sessao" },
              { icon: MessageSquare, stat: "116+", label: "Templates PT-BR" },
              { icon: Users, stat: "5 camadas", label: "Anti-ban ativas" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 px-4">
                <div className="w-10 h-10 rounded bg-primary/5 flex items-center justify-center shrink-0">
                  <item.icon size={16} className="text-primary" strokeWidth={1.5} />
                </div>
                <div>
                  <div className="font-mono text-sm font-bold">{item.stat}</div>
                  <div className="text-[11px] text-muted-foreground">{item.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ PRICING ══════ */}
      <section id="pricing" className="relative z-10 py-24 px-4 md:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="font-mono text-[10px] text-primary uppercase tracking-[0.2em] mb-3">PLANOS</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Escale conforme cresce</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((p) => (
              <div key={p.name} className={`border rounded-lg p-7 transition-all duration-300 hover:-translate-y-1 ${p.popular ? "border-primary/40 bg-primary/[0.02] shadow-[0_0_40px_hsl(142_72%_45%_/_0.06)] relative" : "border-border hover:border-primary/20"}`}>
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[10px] text-primary-foreground bg-primary px-3 py-0.5 rounded-full uppercase tracking-widest">
                    popular
                  </div>
                )}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-mono text-4xl font-bold">R${p.price}</span>
                  <span className="text-xs text-muted-foreground">/mes</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground mt-1">{p.accounts} contas simultaneas</div>
                <div className="border-t border-border/50 my-5" />
                <ul className="space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs">
                      <Check size={13} className="text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/register"
                  className={`mt-7 block text-center font-mono text-xs py-3 rounded-sm transition-all ${p.popular ? "text-white hover:opacity-90 hover:shadow-[0_0_20px_hsl(214_90%_58%_/_0.3)]" : "border border-border hover:border-primary/30 text-foreground"}`}
                  style={p.popular ? { background: "linear-gradient(95deg,#1B6FD8,#00C4D4)" } : {}}>
                  {p.popular ? "comecar agora" : "escolher plano"}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════ FAQ ══════ */}
      <section id="faq" className="relative z-10 py-24 px-4 md:px-6 border-t border-border/50">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14">
            <div className="font-mono text-[10px] text-primary uppercase tracking-[0.2em] mb-3">FAQ</div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Perguntas frequentes</h2>
          </div>
          <div className="border border-border/50 rounded-lg overflow-hidden">
            <FaqItem q="Quanto tempo leva para maturar um numero?" a="O warmup progressivo leva 14 dias para chegar a capacidade maxima. Nos primeiros 3 dias o sistema envia poucas mensagens, aumentando gradualmente com fator de 1.35x por dia." />
            <FaqItem q="Meu numero pode ser bloqueado?" a="O sistema possui 5 camadas de anti-ban (SafeZoneGuard, simulacao comportamental, ritmo circadiano, stealth connect, deteccao automatica). A taxa de bloqueio e inferior a 0.5%." />
            <FaqItem q="Quantos numeros posso maturar?" a="Depende do plano. Starter suporta 10, Pro suporta 50 e Enterprise suporta 200+ numeros simultaneos." />
            <FaqItem q="Preciso de proxies?" a="Recomendado. O sistema suporta proxies residenciais e mobile com rotacao automatica. Cada conta pode ter seu proprio proxy isolado." />
            <FaqItem q="Como funciona o sistema de conversas?" a="O sistema pareia seus numeros e simula conversas naturais usando 116+ templates em portugues com variacao Spintax. Inclui typing indicators, read receipts e reacoes." />
          </div>
        </div>
      </section>

      {/* ══════ CTA ══════ */}
      <section className="relative z-10 py-24 px-4 md:px-6 border-t border-border/50">
        <div className="max-w-2xl mx-auto text-center">
          <Flame size={28} className="text-primary mx-auto mb-5" />
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Pronto para comecar?</h2>
          <p className="text-muted-foreground mt-3 text-sm">Configure em 2 minutos. Warmup completo em 14 dias. Sem cartao de credito.</p>
          <Link href="/register"
            className="group inline-flex items-center gap-2 mt-8 font-mono text-sm text-white px-10 py-3.5 rounded-sm transition-all hover:opacity-90 hover:shadow-[0_0_40px_hsl(214_90%_58%_/_0.3)]"
            style={{ background: "linear-gradient(95deg,#1B6FD8,#00C4D4)" }}>
            criar conta gratis <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <div className="mt-4 font-mono text-[10px] text-muted-foreground">
            Teste 7 dias gratis &mdash; cancele quando quiser
          </div>
        </div>
      </section>

      {/* ══════ FOOTER ══════ */}
      <footer className="relative z-10 border-t border-border/50 py-8 px-4 md:px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <MaturixLogo variant="compact" className="opacity-50" />
          <div className="flex items-center gap-6 font-mono text-[11px] text-muted-foreground">
            <Link href="/login" className="hover:text-foreground transition-colors">login</Link>
            <Link href="/register" className="hover:text-foreground transition-colors">registro</Link>
            <a href="#features" className="hover:text-foreground transition-colors">features</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">planos</a>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">2026</div>
        </div>
      </footer>
    </div>
  );
}

/* ── Timeline Component ── */
function Timeline() {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => { entries.forEach((entry) => { const idx = Number(entry.target.getAttribute("data-idx")); if (entry.isIntersecting) setVisibleItems((prev) => new Set(prev).add(idx)); }); },
      { threshold: 0.3, rootMargin: "0px 0px -50px 0px" }
    );
    itemRefs.current.forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative">
      <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border/50" />
      <div className="absolute left-[19px] top-0 w-px bg-primary transition-all duration-1000 ease-out"
        style={{ height: `${(Math.max(...Array.from(visibleItems), -1) + 1) / timelineSteps.length * 100}%` }} />

      {timelineSteps.map((step, i) => {
        const visible = visibleItems.has(i);
        return (
          <div key={i} ref={(el) => { itemRefs.current[i] = el; }} data-idx={i}
            className={`relative pl-12 pb-8 transition-all duration-700 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
            style={{ transitionDelay: `${i * 100}ms` }}>
            <div className={`absolute left-3 top-1.5 w-3 h-3 rounded-full border-2 border-background ${step.bg} transition-all duration-500 ${visible ? "shadow-[0_0_8px_currentColor]" : ""}`} />
            <div className="flex items-center gap-3 mb-1.5">
              <span className={`font-mono text-xs font-bold ${step.color}`}>{step.day}</span>
              <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.15em]">{step.phase}</span>
            </div>
            <h3 className="text-sm font-semibold mb-1">{step.title}</h3>
            <p className="text-xs text-muted-foreground">{step.desc}</p>
            <div className="mt-3 h-1 bg-border/30 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${step.bg} transition-all duration-1000 ease-out`}
                style={{ width: visible ? `${step.pct}%` : "0%" }} />
            </div>
          </div>
        );
      })}

      <div className="relative pl-12 mt-2">
        <div className={`absolute left-3 top-0.5 w-3 h-3 rounded-full bg-primary ${visibleItems.has(4) ? "shadow-[0_0_12px_hsl(214,90%,58%)] animate-pulse" : ""}`} />
        <div className="font-mono text-xs text-primary font-bold uppercase tracking-wider">pronto para uso</div>
        <div className="font-mono text-[10px] text-muted-foreground mt-0.5">capacidade maxima &mdash; monitoramento continuo</div>
      </div>
    </div>
  );
}

/* ── FAQ Component ── */
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-primary/[0.02] transition-colors">
        <span className="text-sm font-medium pr-4">{q}</span>
        <ChevronRight size={14} className={`text-muted-foreground transition-transform duration-200 shrink-0 ${open ? "rotate-90" : ""}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${open ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="px-5 pb-4 text-xs text-muted-foreground leading-relaxed">{a}</div>
      </div>
    </div>
  );
}
