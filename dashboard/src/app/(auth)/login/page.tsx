"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { MaturixLogo } from "@/components/brand/MaturixLogo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erro ao autenticar");
        setLoading(false);
        return;
      }

      localStorage.setItem("maturador_token", data.token);
      localStorage.setItem("maturador_user", JSON.stringify(data.user));
      router.push("/overview");
    } catch {
      setError("Servidor indisponivel");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="flex justify-center mb-10">
        <MaturixLogo variant="full" />
      </div>

      <div className="section-line mb-6">acesso</div>

      {error && (
        <div className="flex items-center gap-2 mb-4 font-mono text-xs text-red-400 bg-red-400/5 border border-red-400/20 px-3 py-2 rounded-sm">
          <div className="dot dot-err" /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
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
        <div>
          <label className="term-label block mb-1.5">senha</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-secondary font-mono text-sm px-3 py-2 rounded-sm border-none outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
            placeholder="••••••••"
            required
          />
        </div>
        <div className="flex items-center justify-between">
          <Link href="/forgot-password" className="font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors">
            esqueceu a senha?
          </Link>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full font-mono text-xs text-white py-2.5 rounded-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(95deg, #1B6FD8, #00C4D4)" }}
        >
          {loading
            ? <><Loader2 size={12} className="animate-spin" /> autenticando...</>
            : "entrar"}
        </button>
      </form>

      <div className="mt-6 text-center">
        <span className="font-mono text-[11px] text-muted-foreground">
          sem conta?{" "}
          <Link href="/register" className="text-primary hover:opacity-80 transition-opacity">
            criar acesso
          </Link>
        </span>
      </div>
    </div>
  );
}
