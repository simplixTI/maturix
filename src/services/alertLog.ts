import { getDb } from '../database/client.js';

/**
 * Shared alert creation used by every alert source so that ALL alerts are:
 *  - enriched with the instance name (displayName) + a formatted phone number,
 *  - deduplicated (the same type for the same account inside a window updates the
 *    existing alert instead of spamming a new one every few seconds).
 */

/** Format a raw BR number (e.g. 5524992228389) as +55 (24) 99222-8389. */
export function formatPhoneBR(phone?: string | null): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  const m = d.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+${m[1]} (${m[2]}) ${m[3]}-${m[4]}`;
  return `+${d}`;
}

export interface AccountContext {
  label: string | null;
  phoneNumber: string | null;
  displayName: string | null;
}

/** Resolve the friendly "instance name · +phone" label for an account. */
export async function buildAccountContext(accountId?: string | null): Promise<AccountContext> {
  if (!accountId) return { label: null, phoneNumber: null, displayName: null };
  const db = getDb();
  const acc = await db.account.findUnique({
    where: { id: accountId },
    select: { phoneNumber: true, displayName: true },
  });
  if (!acc) return { label: accountId, phoneNumber: null, displayName: null };
  const phone = formatPhoneBR(acc.phoneNumber);
  const label = acc.displayName ? `${acc.displayName} · ${phone}` : phone;
  return { label, phoneNumber: acc.phoneNumber, displayName: acc.displayName ?? null };
}

/** Ensure the message identifies the account (swap raw id / add name / append label). */
function enrichMessage(message: string, ctx: AccountContext, accountId?: string | null): string {
  if (!ctx.label) return message;
  if (accountId && message.includes(accountId)) {
    return message.split(accountId).join(ctx.label);
  }
  if (ctx.phoneNumber && message.includes(ctx.phoneNumber)) {
    return ctx.displayName ? message.split(ctx.phoneNumber).join(ctx.label) : message;
  }
  return `${message} · ${ctx.label}`;
}

export interface EnrichedAlertInput {
  accountId?: string | null;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  metadata?: any;
  /** Dedupe window for the same (accountId, type). Default 10 min. */
  dedupeWindowMs?: number;
}

/**
 * Create an alert with account enrichment + dedup. Returns the alert and whether
 * a NEW row was created (false = an existing recent alert was updated in place).
 */
export async function createEnrichedAlert(
  input: EnrichedAlertInput,
): Promise<{ alert: any; created: boolean }> {
  const db = getDb();
  const ctx = await buildAccountContext(input.accountId);
  const message = enrichMessage(input.message, ctx, input.accountId);
  const metadata = {
    ...(input.metadata ?? {}),
    phoneNumber: ctx.phoneNumber,
    displayName: ctx.displayName,
    accountLabel: ctx.label,
  };

  const windowMs = input.dedupeWindowMs ?? 10 * 60 * 1000;
  if (input.accountId) {
    const existing = await db.alertLog.findFirst({
      where: {
        accountId: input.accountId,
        type: input.type as any,
        acknowledged: false,
        createdAt: { gte: new Date(Date.now() - windowMs) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      // Refresh the existing alert (e.g. latest disconnect count) instead of spamming.
      const alert = await db.alertLog.update({
        where: { id: existing.id },
        data: { message, metadata } as any,
      });
      return { alert, created: false };
    }
  }

  const alert = await db.alertLog.create({
    data: {
      accountId: input.accountId ?? undefined,
      type: input.type,
      severity: input.severity,
      message,
      metadata,
    } as any,
  });
  return { alert, created: true };
}
