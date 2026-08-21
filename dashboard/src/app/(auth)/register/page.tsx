"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Terminal, Loader2, ArrowLeft, Check } from "lucide-react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("pro");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"form" | "success">("form");
  const router = useRouter();

  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${apiUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erro ao criar conta");
        setLoading(false);
        return;
      }

      localStorage.setItem("maturador_token", data.token);
      localStorage.setItem("maturador_user", JSON.stringify(data.user));
      setStep("success");
    } catch {
      setError("Servidor indisponivel");
    }
    setLoading(false);
  };

  if (step === "success") {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Check size={20} className="text-primary" />
        </div>
        <h2 className="text-lg font-semibold">Conta criada</h2>
        <p className="text-sm text-muted-foreground mt-2">Sua conta foi criada com sucesso. Voce ja pode acessar o painel.</p>
        <div className="border border-border rounded p-3 mt-5 text-left font-mono text-xs space-y-1.5">
          <div className="flex items-center gap-2"><div className="dot dot-ok" /> conta ativa</div>
          <div className="flex items-center gap-2"><div className="dot dot-ok" /> plano {plan} configurado</div>
          <div className="flex items-center gap-2"><div className="dot dot-warn" /> aguardando primeiro numero</div>
        </div>
        <button
          onClick={() => router.push("/overview")}
          className="mt-5 w-full font-mono text-xs bg-primary text-primary-foreground py-2.5 rounded-sm hover:bg-primary/90 transition-colors"
        >
          [ir para o painel]
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs font-mono mb-8 transition-colors">
        <ArrowLeft size={12} /> voltar
      </Link>

      <div className="flex items-center gap-2 mb-8">
        <Terminal size={16} className="text-primary" />
        <span className="font-mono text-sm font-semibold tracking-tight">maturador</span>
      </div>

      <div className="section-line mb-6">criar conta</div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="term-label block mb-1.5">nome</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-secondary font-mono text-sm px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
            placeholder="seu nome"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="term-label block mb-1.5">email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-secondary font-mono text-sm px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
            placeholder="seu@email.com"
            required
          />
        </div>
        <div>
          <label className="term-label block mb-1.5">senha</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-secondary font-mono text-sm px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
            placeholder="minimo 8 caracteres"
            required
            minLength={8}
          />
        </div>

        {/* Plan selector */}
        <div>
          <label className="term-label block mb-2">plano</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "starter", label: "Starter", price: "R$97" },
              { id: "pro", label: "Pro", price: "R$197" },
              { id: "enterprise", label: "Enterprise", price: "R$497" },
            ].map(p => (
              <button key={p.id} type="button" onClick={() => setPlan(p.id)}
                className={`font-mono text-xs py-2 rounded-sm border transition-colors ${
                  plan === p.id ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                <div>{p.label}</div>
                <div className="text-[10px] mt-0.5">{p.price}/m</div>
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full font-mono text-xs bg-primary text-primary-foreground py-2.5 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <><Loader2 size={12} className="animate-spin" /> criando conta...</> : "[criar conta]"}
        </button>
      </form>

      <div className="mt-6 text-center">
        <span className="font-mono text-[11px] text-muted-foreground">
          ja tem conta?{" "}
          <Link href="/login" className="text-primary hover:text-primary/80 transition-colors">entrar</Link>
        </span>
      </div>
    </div>
  );
}
