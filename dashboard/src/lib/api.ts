const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

/* ── internal fetch wrapper ── */

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T | null> {
  try {
    const headers: Record<string, string> = {};

    // Only set Content-Type if there's a body
    if (opts?.body) {
      headers["Content-Type"] = "application/json";
    }

    if (typeof window !== "undefined") {
      const token = localStorage.getItem("maturador_token");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    if (API_KEY) {
      headers["x-api-key"] = API_KEY;
    }

    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: { ...headers, ...opts?.headers },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[API] ${opts?.method || "GET"} ${path} → ${res.status}`, body);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[API] ${opts?.method || "GET"} ${path} → NETWORK ERROR`, err);
    return null;
  }
}

/* ── types ── */

export interface AccountOverview {
  total: number;
  connected: number;
  warming: number;
  atRisk: number;
  banned: number;
  paused: number;
}

export interface Account {
  id: string;
  phoneNumber: string;
  displayName?: string;
  status: string;
  isPaused: boolean;
  pauseReason?: string;
  warmupDay: number;
  msgsSentToday: number;
  msgsReceivedToday: number;
  banRisk: string;
  proxy?: { id: string; host: string; port: number; protocol: string };
  warmupState?: { currentDay: number; maxCapacity: number };
  metrics?: { date: string; messagesSent: number; messagesReceived: number; replyRate: number }[];
}

export interface MetricsEntry {
  id: string;
  accountId: string;
  date: string;
  messagesSent: number;
  messagesReceived: number;
  replyRate: number;
}

export interface MetricsToday {
  totals: { sent: number; received: number };
  accounts: {
    id: string;
    phoneNumber: string;
    msgsSentToday: number;
    msgsReceivedToday: number;
    warmupDay: number;
    banRisk: string;
  }[];
}

export interface ProxyItem {
  id: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: string;
  type?: string;
  latency?: number;
  isHealthy: boolean;
  lastChecked?: string;
  createdAt: string;
  _count?: { assignedAccounts: number };
}

export interface TemplateItem {
  id: string;
  name: string;
  category: string;
  messages: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertItem {
  id: string;
  severity: string;
  message: string;
  accountId?: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface AlertStats {
  total: number;
  unacknowledged: number;
  critical: number;
  warning: number;
}

export interface Settings {
  safeZones: Record<string, unknown>;
  timing: Record<string, unknown>;
  session: Record<string, unknown>;
  warmup: Record<string, unknown>;
  circadianCurve: number[];
  warmupProfiles: unknown[];
}

/* ── accounts ── */

export const accounts = {
  getAll: () => apiFetch<Account[]>("/api/accounts"),
  getById: (id: string) => apiFetch<Account>(`/api/accounts/${id}`),
  create: (phoneNumber: string, displayName?: string) =>
    apiFetch<Account>("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ phoneNumber, displayName }),
    }),
  update: (id: string, data: { isPaused?: boolean; pauseReason?: string; displayName?: string }) =>
    apiFetch<Account>(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/accounts/${id}`, { method: "DELETE" }),
  getOverview: () => apiFetch<AccountOverview>("/api/accounts/stats/overview"),
};

/* ── sessions ── */

export const sessions = {
  connect: (phoneNumber: string) =>
    apiFetch<{ status: string; accountId: string; phoneNumber: string }>("/api/sessions/connect", {
      method: "POST",
      body: JSON.stringify({ phoneNumber }),
    }),
  reconnect: (accountId: string) =>
    apiFetch<{ status: string; accountId: string }>("/api/sessions/reconnect", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    }),
  requestPairingCode: (accountId: string, phoneNumber: string) =>
    apiFetch<{ code: string; accountId: string }>("/api/sessions/pairing-code", {
      method: "POST",
      body: JSON.stringify({ accountId, phoneNumber }),
    }),
  disconnect: (accountId: string) =>
    apiFetch<{ status: string; accountId: string }>("/api/sessions/disconnect", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    }),
  getActive: () => apiFetch<{ count: number }>("/api/sessions/active"),
};

/* ── metrics ── */

export const metrics = {
  get: (days?: number, accountId?: string) => {
    const params = new URLSearchParams();
    if (days) params.set("days", String(days));
    if (accountId) params.set("accountId", accountId);
    const qs = params.toString();
    return apiFetch<MetricsEntry[]>(`/api/metrics${qs ? `?${qs}` : ""}`);
  },
  getToday: () => apiFetch<MetricsToday>("/api/metrics/today"),
  getAlerts: () => apiFetch<AlertItem[]>("/api/metrics/alerts"),
};

/* ── proxies ── */

export const proxies = {
  getAll: () => apiFetch<ProxyItem[]>("/api/proxies"),
  add: (data: { host: string; port: number; username?: string; password?: string; protocol?: string; type?: string }) =>
    apiFetch<{ id: string }>("/api/proxies", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  bulkImport: (lines: string[]) =>
    apiFetch<{ imported: number }>("/api/proxies/bulk-import", {
      method: "POST",
      body: JSON.stringify({ lines }),
    }),
  delete: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/proxies/${id}`, { method: "DELETE" }),
  testAll: () =>
    apiFetch<{ status: string }>("/api/proxies/check-all", { method: "POST" }),
};

/* ── templates ── */

export const templates = {
  getAll: () => apiFetch<TemplateItem[]>("/api/templates"),
  create: (data: { name: string; category: string; messages: unknown[] }) =>
    apiFetch<TemplateItem>("/api/templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; category?: string; messages?: unknown[]; isActive?: boolean }) =>
    apiFetch<TemplateItem>(`/api/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/templates/${id}`, { method: "DELETE" }),
  previewSpintax: (text: string, count?: number) =>
    apiFetch<{ variations: string[] }>("/api/templates/preview-spintax", {
      method: "POST",
      body: JSON.stringify({ text, count }),
    }),
};

/* ── alerts ── */

export const alerts = {
  getAll: () => apiFetch<AlertItem[]>("/api/alerts"),
  getUnacknowledged: () => apiFetch<AlertItem[]>("/api/alerts/unacknowledged"),
  acknowledge: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/alerts/${id}/acknowledge`, { method: "PATCH" }),
  acknowledgeAll: () =>
    apiFetch<{ success: boolean }>("/api/alerts/acknowledge-all", { method: "POST" }),
  getStats: () => apiFetch<AlertStats>("/api/alerts/stats"),
};

/* ── profile ── */

export interface ProfileInfo {
  accountId: string;
  jid: string;
  name: string | null;
  bio: string | null;
  pictureUrl: string | null;
}

export const profile = {
  get: (accountId: string) =>
    apiFetch<ProfileInfo>(`/api/profile/${accountId}`),
  updateName: (accountId: string, name: string) =>
    apiFetch<{ success: boolean; name: string }>(`/api/profile/${accountId}/name`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  updateBio: (accountId: string, bio: string) =>
    apiFetch<{ success: boolean; bio: string }>(`/api/profile/${accountId}/bio`, {
      method: "PATCH",
      body: JSON.stringify({ bio }),
    }),
  updatePicture: (accountId: string, data: string) =>
    apiFetch<{ success: boolean; sizeKb: number }>(`/api/profile/${accountId}/picture`, {
      method: "POST",
      body: JSON.stringify({ data }),
    }),
};

/* ── warmup control ── */

export interface WarmupStatus {
  warmupRunning: boolean;
  conversationRunning: boolean;
}

export const warmupControl = {
  getStatus: () => apiFetch<WarmupStatus>("/api/warmup/status"),
  start: () =>
    apiFetch<{ status: string }>("/api/warmup/start", { method: "POST" }),
  stop: () =>
    apiFetch<{ status: string }>("/api/warmup/stop", { method: "POST" }),
};

/* ── settings ── */

export const settings = {
  get: () => apiFetch<Settings>("/api/settings"),
  getWarmupProfiles: () => apiFetch<unknown[]>("/api/settings/warmup-profiles"),
  getCircadianCurve: () => apiFetch<{ curve: number[] }>("/api/settings/circadian-curve"),
};

/* ── warming groups ── */

export interface WarmingGroup {
  id: string;
  inviteLink: string;
  inviteCode: string;
  groupJid: string | null;
  groupName: string | null;
  status: string;
  accountId: string | null;
  joinedAt: string | null;
  lastActivity: string | null;
  messagesSent: number;
  createdAt: string;
}

export interface WarmingGroupStats {
  total: number;
  pending: number;
  joined: number;
  left: number;
  failed: number;
  totalMessages: number;
}

export interface WarmingGroupsResponse {
  groups: WarmingGroup[];
  stats: WarmingGroupStats;
}

export const warmingGroups = {
  getAll: (accountId?: string) => {
    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    const qs = params.toString();
    return apiFetch<WarmingGroupsResponse>(`/api/warming-groups${qs ? `?${qs}` : ""}`);
  },
  addLinks: (links: string[], accountId?: string) =>
    apiFetch<{ created: number; skipped: number; groups: unknown[]; skippedLinks: string[] }>(
      "/api/warming-groups",
      {
        method: "POST",
        body: JSON.stringify({ links, accountId }),
      }
    ),
  join: (id: string, accountId: string) =>
    apiFetch<{ status: string; groupJid: string; groupName: string | null }>(
      `/api/warming-groups/${id}/join`,
      {
        method: "POST",
        body: JSON.stringify({ accountId }),
      }
    ),
  leave: (id: string, accountId: string) =>
    apiFetch<{ status: string; groupJid: string }>(
      `/api/warming-groups/${id}/leave`,
      {
        method: "POST",
        body: JSON.stringify({ accountId }),
      }
    ),
  remove: (id: string) =>
    apiFetch<{ status: string; id: string }>(`/api/warming-groups/${id}`, {
      method: "DELETE",
    }),
  interact: (accountId: string) =>
    apiFetch<{ status: string; groupJid: string; groupName: string | null; message: string }>(
      "/api/warming-groups/interact",
      {
        method: "POST",
        body: JSON.stringify({ accountId }),
      }
    ),
  bulkJoin: (accountId: string) =>
    apiFetch<{ status: string; planned: number; maxJoinsToday: number; joinedToday: number; message: string }>(
      "/api/warming-groups/bulk-join",
      {
        method: "POST",
        body: JSON.stringify({ accountId }),
      }
    ),
  bulkLeave: (accountId: string) =>
    apiFetch<{ status: string; left: number; failed: number }>(
      "/api/warming-groups/bulk-leave",
      {
        method: "POST",
        body: JSON.stringify({ accountId }),
      }
    ),
};
