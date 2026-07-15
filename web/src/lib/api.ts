// Thin fetch wrapper around the backend REST API with JWT auth.
// In dev, the Vite proxy forwards /api to :3000, so we use same-origin paths.
// In production, set VITE_API_BASE or serve both frontend and backend from the same origin.

export const API_BASE = import.meta.env.VITE_API_BASE || '';

const TOKEN_KEY = 'maturador.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** When true a 401 will NOT trigger a global logout (used by the login call). */
  noAuthRedirect?: boolean;
}

type LogoutHandler = () => void;
let onUnauthorized: LogoutHandler | null = null;
export function setUnauthorizedHandler(fn: LogoutHandler): void {
  onUnauthorized = fn;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, noAuthRedirect } = opts;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload, signal });

  if (res.status === 401 && !noAuthRedirect) {
    onUnauthorized?.();
    throw new ApiError('Sessão expirada. Faça login novamente.', 401);
  }

  // Some endpoints (CSV export) return non-JSON.
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      message = (data && (data.error || data.message)) || message;
    }
    throw new ApiError(message, res.status);
  }

  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

/** Multipart upload of one or more files under the `files` field. */
export async function upload<T = unknown>(path: string, files: File[], opts?: { category?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);

  const qs = opts?.category ? `?category=${encodeURIComponent(opts.category)}` : '';
  const res = await fetch(`${API_BASE}${path}${qs}`, { method: 'POST', headers, body: form });

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError('Sessão expirada. Faça login novamente.', 401);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      message = (data && (data.error || data.message)) || message;
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

// Convenience verbs
export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
