"use client";

import { useState } from "react";
import Link from "next/link";
import { Terminal, Loader2, ArrowLeft, Check } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 1500));
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="w-full max-w-sm">
      <Link href="/login" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs font-mono mb-8 transition-colors">
        <ArrowLeft size={12} /> voltar ao login
      </Link>

      <div className="flex items-center gap-2 mb-8">
        <Terminal size={16} className="text-primary" />
        <span className="font-mono text-sm font-semibold tracking-tight">maturador</span>
      </div>

      <div className="section-line mb-6">recuperar senha</div>

      {sent ? (
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Check size={20} className="text-primary" />
          </div>
          <h2 className="text-sm font-semibold">Email enviado</h2>
          <p className="text-xs text-muted-foreground mt-2">
            Verifique sua caixa de entrada em <span className="text-foreground">{email}</span>
          </p>
          <Link href="/login" className="inline-block mt-5 font-mono text-xs text-primary hover:text-primary/80 transition-colors">
            [voltar ao login]
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Digite seu email e enviaremos um link para redefinir sua senha.
          </p>
          <div>
            <label className="term-label block mb-1.5">email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-secondary font-mono text-sm px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
              placeholder="seu@email.com"
              required
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full font-mono text-xs bg-primary text-primary-foreground py-2.5 rounded-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 size={12} className="animate-spin" /> enviando...</> : "[enviar link]"}
          </button>
        </form>
      )}
    </div>
  );
}
