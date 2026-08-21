"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Flame, BarChart3,
  Globe, FileText, Terminal, Settings, LogOut, MessageCircle, Send, UserCircle, UsersRound, Wifi, Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MaturixLogo } from "@/components/brand/MaturixLogo";
import { useSocket } from "@/lib/socket";

const nav = [
  { href: "/overview",    key: "ovw", icon: LayoutDashboard, label: "visao geral" },
  { href: "/accounts",    key: "acc", icon: Users,            label: "contas" },
  { href: "/warmup",      key: "wrm", icon: Flame,            label: "aquecimento" },
  { href: "/metrics",     key: "mtr", icon: BarChart3,        label: "metricas" },
  { href: "/proxies",     key: "prx", icon: Globe,            label: "proxies" },
  { href: "/chats",       key: "cht", icon: MessageCircle,    label: "conversas" },
  { href: "/grupos",      key: "grp", icon: UsersRound,       label: "grupos" },
  { href: "/envios",      key: "snd", icon: Send,             label: "envios" },
  { href: "/descobrir",   key: "dsc", icon: Search,           label: "descobrir" },
  { href: "/aquecimento", key: "aqc", icon: Wifi,             label: "aqc grupos" },
  { href: "/perfil",      key: "prf", icon: UserCircle,       label: "identidade" },
  { href: "/templates",   key: "tpl", icon: FileText,         label: "modelos" },
  { href: "/logs",        key: "log", icon: Terminal,         label: "logs" },
  { href: "/settings",    key: "cfg", icon: Settings,         label: "configuracoes" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  const router = useRouter();
  const { connected } = useSocket();

  const handleLogout = () => {
    localStorage.removeItem("maturador_token");
    localStorage.removeItem("maturador_user");
    router.push("/login");
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-[180px] border-r border-border shrink-0">

        {/* Logo */}
        <div className="flex items-center gap-2.5 h-12 px-3 border-b border-border">
          <MaturixLogo variant="compact" />
          <span className="font-mono text-[10px] text-muted-foreground ml-auto opacity-60">v1.0</span>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {nav.map(({ href, key, icon: Icon, label }) => {
            const on = p === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 font-mono text-xs transition-colors",
                  on
                    ? "text-primary bg-primary/8 border-r-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="text-muted-foreground/50 w-6 text-[10px]">{key}</span>
                <Icon size={12} strokeWidth={on ? 2 : 1.5} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-2.5 border-t border-border font-mono text-[10px] text-muted-foreground space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className={cn("dot", connected ? "dot-ok" : "dot-off")} />
            {connected ? "sistema online" : "desconectado"}
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-red-400 transition-colors w-full"
          >
            <LogOut size={10} />
            sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between h-10 px-4 border-b border-border shrink-0">
          <div className="font-mono text-xs text-muted-foreground">
            <span className="text-primary">›</span>{" "}
            <span style={{ background: "linear-gradient(90deg,#2B7FFF,#00D4E7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", fontWeight: 600 }}>
              maturix
            </span>{" "}
            <span className="text-foreground">/{nav.find(n => n.href === p)?.label ?? "~"}</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <div className={cn("dot", connected ? "dot-ok" : "dot-off")} />
              {connected ? "operacional" : "offline"}
            </span>
            <span>uptime 14d</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
