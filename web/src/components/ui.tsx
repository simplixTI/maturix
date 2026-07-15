import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { IconInbox } from './Icons';

/* ── Button ── */
type Variant = 'default' | 'primary' | 'danger' | 'ghost';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  block?: boolean;
}
export function Button({ variant = 'default', size = 'md', loading, block, className = '', children, disabled, ...rest }: BtnProps) {
  const v = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'ghost' ? 'btn-ghost' : '';
  return (
    <button
      className={`btn ${v} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="spinner" style={{ width: 14, height: 14 }} />}
      {children}
    </button>
  );
}

/* ── Card ── */
export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}

/* ── Badge ── */
export function Badge({ tone = 'neutral', children, dot = true }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return <span className={`badge tone-${tone} ${dot ? '' : 'no-dot'}`}>{children}</span>;
}

/* ── Stat card ── */
export function Stat({ label, value, foot, accent, icon, onClick }: { label: string; value: ReactNode; foot?: ReactNode; accent?: boolean; icon?: ReactNode; onClick?: () => void }) {
  return (
    <div
      className={`stat${onClick ? ' stat-clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      {icon && <span className="stat-icon">{icon}</span>}
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${accent ? 'stat-accent' : ''}`}>{value}</span>
      {foot && <span className="stat-foot">{foot}</span>}
    </div>
  );
}

/* ── Spinner / loading ── */
export function Spinner({ lg }: { lg?: boolean }) {
  return <span className={`spinner ${lg ? 'lg' : ''}`} />;
}
export function Loading({ label }: { label?: string }) {
  return (
    <div className="loading-wrap">
      <div className="col" style={{ alignItems: 'center', gap: 12 }}>
        <Spinner lg />
        {label && <span className="muted text-sm">{label}</span>}
      </div>
    </div>
  );
}

/* ── Empty state ── */
export function Empty({ title, hint, icon, action }: { title: string; hint?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <IconInbox />}
      <div className="empty-title">{title}</div>
      {hint && <div className="text-sm">{hint}</div>}
      {action}
    </div>
  );
}

/* ── Form fields ── */
export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      {label && <label className="label">{label}</label>}
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...rest} />;
}
export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return <select className={`select ${className}`} {...rest}>{children}</select>;
}
export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...rest} />;
}

/* ── KPI bar ── */
export function KpiBar({ value }: { value: number }) {
  return (
    <div className="kpi-bar">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
