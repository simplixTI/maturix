import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSocket } from '../lib/socket';
import { get } from '../lib/api';
import type { AlertStats } from '../lib/types';
import {
  IconGauge, IconPhone, IconFlame, IconSend, IconServer, IconChat,
  IconTemplate, IconUsers, IconSearch, IconBell, IconTerminal,
  IconSettings, IconCompass, IconLogout, IconUserCircle, IconInbox, IconLink, IconSun, IconMoon,
} from './Icons';

interface NavDef {
  to: string;
  label: string;
  icon: ReactNode;
}
interface NavSection {
  title: string;
  items: NavDef[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Operação',
    items: [
      { to: '/', label: 'Visão geral', icon: <IconGauge className="nav-icon" /> },
      { to: '/contas', label: 'Contas', icon: <IconPhone className="nav-icon" /> },
      { to: '/aquecimento', label: 'Aquecimento', icon: <IconFlame className="nav-icon" /> },
      { to: '/enviar', label: 'Enviar', icon: <IconSend className="nav-icon" /> },
    ],
  },
  {
    title: 'Conteúdo',
    items: [
      { to: '/conversas', label: 'Conversas', icon: <IconChat className="nav-icon" /> },
      { to: '/templates', label: 'Templates', icon: <IconTemplate className="nav-icon" /> },
      { to: '/midia', label: 'Mídia', icon: <IconInbox className="nav-icon" /> },
      { to: '/perfil', label: 'Perfis', icon: <IconUserCircle className="nav-icon" /> },
      { to: '/empresas', label: 'Empresas', icon: <IconLink className="nav-icon" /> },
    ],
  },
  {
    title: 'Grupos',
    items: [
      { to: '/grupos-aquecimento', label: 'Grupos de aquecimento', icon: <IconUsers className="nav-icon" /> },
      { to: '/descoberta', label: 'Descoberta', icon: <IconCompass className="nav-icon" /> },
      { to: '/grupos-ativos', label: 'Grupos ao vivo', icon: <IconSearch className="nav-icon" /> },
    ],
  },
  {
    title: 'Infra & Monitor',
    items: [
      { to: '/proxies', label: 'Proxies', icon: <IconServer className="nav-icon" /> },
      { to: '/alertas', label: 'Alertas', icon: <IconBell className="nav-icon" /> },
      { to: '/chamadas', label: 'Chamadas', icon: <IconPhone className="nav-icon" /> },
      { to: '/logs', label: 'Logs', icon: <IconTerminal className="nav-icon" /> },
      { to: '/config', label: 'Configurações', icon: <IconSettings className="nav-icon" /> },
    ],
  },
];

const TITLES: Record<string, string> = {
  '/': 'Visão geral',
  '/contas': 'Contas',
  '/aquecimento': 'Aquecimento',
  '/enviar': 'Enviar mensagem',
  '/conversas': 'Conversas',
  '/templates': 'Templates',
  '/perfil': 'Perfis',
  '/empresas': 'Empresas',
  '/grupos-aquecimento': 'Grupos de aquecimento',
  '/descoberta': 'Descoberta de grupos',
  '/grupos-ativos': 'Grupos ao vivo',
  '/proxies': 'Proxies',
  '/alertas': 'Alertas',
  '/chamadas': 'Chamadas recebidas',
  '/logs': 'Logs do sistema',
  '/config': 'Configurações',
  '/usuarios': 'Usuários',
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [connected, setConnected] = useState(false);
  const [unack, setUnack] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setConnected(socket.connected);

    const onAlert = () => setUnack((n) => n + 1);
    socket.on('alert:new', onAlert);

    get<AlertStats>('/api/alerts/stats')
      .then((s) => setUnack(s.unacknowledged))
      .catch(() => {});

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('alert:new', onAlert);
    };
  }, []);

  // Reset unread badge when visiting alerts page
  useEffect(() => {
    if (location.pathname === '/alertas') setUnack(0);
  }, [location.pathname]);

  const title = TITLES[location.pathname] || 'Maturador';
  const initials = (user?.name || 'U').slice(0, 2).toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img
              src="/logo.png"
              alt="Maturador"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              onError={(e) => {
                const img = e.currentTarget;
                img.style.display = 'none';
                const fb = img.nextElementSibling as HTMLElement | null;
                if (fb) fb.style.display = '';
              }}
            />
            <span style={{ display: 'none' }}>M</span>
          </div>
          <div className="col">
            <span className="brand-name">Maturador</span>
            <span className="brand-sub">WhatsApp</span>
          </div>
        </div>

        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="nav-group-label">{section.title}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.to === '/alertas' && unack > 0 && <span className="nav-badge">{unack}</span>}
              </NavLink>
            ))}
          </div>
        ))}

        {user?.role === 'ADMIN' && (
          <div>
            <div className="nav-group-label">Administração</div>
            <NavLink to="/usuarios" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <IconUsers className="nav-icon" />
              <span>Usuários</span>
            </NavLink>
          </div>
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="page-title">{title}</div>
          <div className="row gap-4">
            <span className="conn-pill">
              <span className={`dot ${connected ? 'live' : ''}`} />
              {connected ? 'Tempo real ativo' : 'Reconectando…'}
            </span>
            <div className="user-chip">
              <div className="avatar">{initials}</div>
              <div className="col hide-sm">
                <span className="text-sm" style={{ fontWeight: 600 }}>{user?.name}</span>
                <span className="text-xs muted">{user?.role === 'ADMIN' ? 'Administrador' : 'Operador'}</span>
              </div>
              <button
                className="btn btn-icon btn-ghost"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
                aria-label="Alternar tema"
              >
                {theme === 'dark' ? <IconSun /> : <IconMoon />}
              </button>
              <button className="btn btn-icon btn-ghost" onClick={logout} title="Sair" aria-label="Sair">
                <IconLogout />
              </button>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
