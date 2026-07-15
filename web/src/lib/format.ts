import type { AccountStatus, BanRiskLevel } from './types';

export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  // Brazilian style: +55 (11) 91234-5678
  if (d.length >= 12 && d.startsWith('55')) {
    const cc = d.slice(0, 2);
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 9) return `+${cc} (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+${cc} (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return `+${d}`;
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  // Clock skew between server and client can put a timestamp slightly in the
  // future (negative diff). Never show a negative "Xs atrás" — clamp to "agora".
  if (sec < 5) return 'agora';
  if (sec < 60) return `${sec}s atrás`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}min atrás`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h atrás`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d atrás`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(ms?: number): string {
  const d = ms ? new Date(ms) : new Date();
  return d.toLocaleTimeString('pt-BR', { hour12: false });
}

export function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}

export function formatPercent(v?: number | null): string {
  if (v === null || v === undefined) return '—';
  // Backend stores rates as 0..1
  return `${(v * 100).toFixed(1)}%`;
}

export const STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING: 'Pendente',
  CONNECTING: 'Conectando',
  CONNECTED: 'Conectado',
  DISCONNECTED: 'Desconectado',
  BANNED: 'Banido',
  PAUSED: 'Pausado',
};

export const STATUS_TONE: Record<AccountStatus, string> = {
  PENDING: 'neutral',
  CONNECTING: 'info',
  CONNECTED: 'success',
  DISCONNECTED: 'neutral',
  BANNED: 'danger',
  PAUSED: 'warning',
};

export const RISK_LABELS: Record<BanRiskLevel, string> = {
  LOW: 'Baixo',
  MEDIUM: 'Médio',
  HIGH: 'Alto',
  CRITICAL: 'Crítico',
};

export const RISK_TONE: Record<BanRiskLevel, string> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
};

export const SEVERITY_TONE: Record<string, string> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
};

export const ALERT_TYPE_LABELS: Record<string, string> = {
  BAN_DETECTED: 'Banimento detectado',
  HIGH_BLOCK_RATE: 'Taxa de bloqueio alta',
  DISCONNECT_STORM: 'Tempestade de desconexões',
  PROXY_FAILURE: 'Falha de proxy',
  RATE_LIMIT_HIT: 'Limite de taxa atingido',
  WARMUP_STALLED: 'Aquecimento travado',
};

export function logLevelName(level: number | string): string {
  if (typeof level === 'string') return level.toUpperCase();
  if (level >= 60) return 'FATAL';
  if (level >= 50) return 'ERROR';
  if (level >= 40) return 'WARN';
  if (level >= 30) return 'INFO';
  if (level >= 20) return 'DEBUG';
  return 'TRACE';
}
