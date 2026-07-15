// Shared domain types mirroring the backend Prisma schema + API responses.

export type AccountStatus =
  | 'PENDING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'BANNED'
  | 'PAUSED';

export type BanRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface Proxy {
  id: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  protocol: 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5';
  type: 'RESIDENTIAL' | 'MOBILE' | 'DATACENTER';
  isHealthy: boolean;
  lastCheckedAt?: string | null;
  responseTimeMs?: number | null;
  failCount: number;
  createdAt: string;
  _count?: { assignedAccounts: number };
}

export interface WarmupState {
  id: string;
  accountId: string;
  currentDay: number;
  dailyLimit: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  uniqueContactsToday: number;
  replyRate: number;
  blockRate: number;
}

export interface Account {
  id: string;
  phoneNumber: string;
  displayName?: string | null;
  status: AccountStatus;
  warmupDay: number;
  warmupStartedAt?: string | null;
  warmupTotalDays?: number | null;
  dailyMsgLimit: number;
  msgsSentToday: number;
  msgsReceivedToday: number;
  lastActiveAt?: string | null;
  banRisk: BanRiskLevel;
  isPaused: boolean;
  pauseReason?: string | null;
  proxyId?: string | null;
  proxy?: Proxy | null;
  warmupState?: WarmupState | null;
  metrics?: AccountMetrics[];
  createdAt: string;
  updatedAt: string;
}

export interface AccountsOverview {
  total: number;
  connected: number;
  warming: number;
  atRisk: number;
  banned: number;
  paused: number;
}

export interface AccountMetrics {
  id: string;
  accountId: string;
  date: string;
  messagesSent: number;
  messagesReceived: number;
  repliesSent: number;
  repliesReceived: number;
  reactionsSent: number;
  reactionsReceived: number;
  statusesPosted: number;
  uniqueContacts: number;
  newContacts: number;
  blocksReceived: number;
  avgResponseTimeSec?: number | null;
  replyRate?: number | null;
  blockRate?: number | null;
  warmupDay: number;
  banRiskLevel: BanRiskLevel;
}

export interface TodayMetrics {
  totals: { sent: number; received: number };
  accounts: Array<{
    id: string;
    phoneNumber: string;
    msgsSentToday: number;
    msgsReceivedToday: number;
    warmupDay: number;
    banRisk: BanRiskLevel;
  }>;
}

export type AlertType =
  | 'BAN_DETECTED'
  | 'HIGH_BLOCK_RATE'
  | 'DISCONNECT_STORM'
  | 'PROXY_FAILURE'
  | 'RATE_LIMIT_HIT'
  | 'WARMUP_STALLED';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Alert {
  id: string;
  accountId?: string | null;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  metadata?: unknown;
  acknowledged: boolean;
  createdAt: string;
}

export interface AlertStats {
  total: number;
  unacknowledged: number;
  critical: number;
  warning: number;
}

export interface ConversationTemplate {
  id: string;
  name: string;
  category: string;
  messages: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WarmupStatus {
  warmupRunning: boolean;
  conversationRunning: boolean;
}

export interface WarmingGroup {
  id: string;
  inviteLink: string;
  inviteCode: string;
  groupJid?: string | null;
  groupName?: string | null;
  status: string;
  accountId?: string | null;
  joinedAt?: string | null;
  lastActivity?: string | null;
  messagesSent: number;
  createdAt: string;
}

export interface WarmingGroupsResponse {
  groups: WarmingGroup[];
  stats: {
    total: number;
    pending: number;
    joined: number;
    left: number;
    failed: number;
    totalMessages: number;
  };
}

export interface DiscoveredGroup {
  id: string;
  inviteCode: string;
  inviteLink: string;
  groupName?: string | null;
  description?: string | null;
  memberCount?: number | null;
  niche: string;
  source: string;
  isActive: boolean;
  lastChecked?: string | null;
  createdAt: string;
}

export interface MessageLog {
  id: string;
  senderId: string;
  receiverId: string;
  messageType: string;
  direction: 'OUTBOUND' | 'INBOUND';
  status: string;
  spintaxOutput?: string | null;
  reactionEmoji?: string | null;
  createdAt: string;
  sender?: { id: string; phoneNumber: string };
  receiver?: { id: string; phoneNumber: string };
}

export interface LiveGroup {
  jid: string;
  subject: string;
  owner?: string;
  desc: string;
  participantCount: number;
  creation?: number;
  myRole: string;
}

export interface LogEntry {
  level: number | string;
  time?: number;
  msg: string;
  module?: string;
  [key: string]: unknown;
}
