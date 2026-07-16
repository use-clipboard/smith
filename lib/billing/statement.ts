// Billing module — client statements.
//
// Two shapes, chosen by the firm's statementMode:
//   'outstanding' — an open-item statement: only unpaid invoices, with the
//                   balance due. What most practices send.
//   'activity'    — invoices AND payments over a period, with a brought-forward
//                   balance and a closing balance. A true statement of account.
//
// buildStatement() is the single source of the numbers, used by the emailed
// statement, the PDF and the client portal, so the three can't disagree.

import type { SupabaseClient } from '@supabase/supabase-js';
import { balancePence } from './totals';
import type { StatementMode } from './types';

export const OUTSTANDING_STATUSES = ['sent', 'viewed', 'part_paid', 'overdue'];

export interface StatementLine {
  kind: 'invoice' | 'payment';
  date: string;               // ISO yyyy-mm-dd
  ref: string;                // invoice number, or payment reference
  description: string;
  /** Charged to the client (invoice total). */
  debitPence: number;
  /** Paid by the client (payment amount). */
  creditPence: number;
  /** Running balance after this line — 'activity' mode only. */
  runningPence?: number;
  /** Still owed on this invoice — 'outstanding' mode only. */
  balancePence?: number;
  dueDate?: string | null;
  daysOverdue?: number;
}

export interface StatementData {
  mode: StatementMode;
  clientName: string;
  /** As-at date (ISO) — the statement's headline date. */
  statementDate: string;
  /** 'activity' only: the window covered. */
  periodFrom?: string;
  /** 'activity' only: balance before the window opened. */
  broughtForwardPence?: number;
  lines: StatementLine[];
  /** Total still owed across all open invoices. Drives the aged analysis and
   *  the auto-run threshold. */
  outstandingPence: number;
  /** The statement's headline balance. Same as outstandingPence for an open-item
   *  statement; for an activity statement it's where the running balance ends,
   *  which also nets off payments on account and so can be lower. */
  closingPence: number;
  /** Aged buckets of the outstanding total. */
  aged: { current: number; d31_60: number; d61_90: number; d90plus: number };
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** Shift an ISO date back by n months, clamped to a valid day. */
export function monthsBack(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const targetMonth = d.getUTCMonth() - months;
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return shifted.toISOString().slice(0, 10);
}

interface InvRow {
  id: string; number: string | null; status: string; issue_date: string | null; due_date: string | null;
  total_pence: number; amount_paid_pence: number; credit_pence: number | null;
}
interface PayRow {
  id: string; amount_pence: number; received_date: string; reference: string | null; method: string;
}

export async function buildStatement(
  supabase: SupabaseClient,
  args: { firmId: string; clientId: string; mode: StatementMode; periodMonths?: number; today?: string },
): Promise<StatementData | null> {
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const periodFrom = monthsBack(today, args.periodMonths ?? 3);

  const { data: client } = await supabase
    .from('clients').select('name').eq('id', args.clientId).eq('firm_id', args.firmId).maybeSingle();
  if (!client) return null;

  // Every non-draft, non-cancelled invoice — needed in full even in 'activity'
  // mode, because the brought-forward balance is derived from what came before.
  const { data: invData } = await supabase
    .from('invoices')
    .select('id, number, status, issue_date, due_date, total_pence, amount_paid_pence, credit_pence')
    .eq('firm_id', args.firmId).eq('client_id', args.clientId)
    .not('status', 'in', '("draft","cancelled")')
    .order('issue_date', { ascending: true })
    .limit(1000);
  const invoices = (invData ?? []) as InvRow[];

  const openBalance = (r: InvRow) => balancePence(r.total_pence, r.amount_paid_pence, r.credit_pence ?? 0);
  const outstandingPence = invoices
    .filter(r => OUTSTANDING_STATUSES.includes(r.status))
    .reduce((s, r) => s + openBalance(r), 0);

  // Aged buckets, by how long each open invoice has been past its due date.
  const aged = { current: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  for (const r of invoices) {
    if (!OUTSTANDING_STATUSES.includes(r.status)) continue;
    const bal = openBalance(r);
    if (bal <= 0) continue;
    const od = r.due_date ? daysBetween(r.due_date, today) : 0;
    if (od <= 30) aged.current += bal;
    else if (od <= 60) aged.d31_60 += bal;
    else if (od <= 90) aged.d61_90 += bal;
    else aged.d90plus += bal;
  }

  let lines: StatementLine[] = [];
  let broughtForwardPence: number | undefined;

  if (args.mode === 'outstanding') {
    lines = invoices
      .filter(r => OUTSTANDING_STATUSES.includes(r.status) && openBalance(r) > 0)
      .map(r => ({
        kind: 'invoice' as const,
        date: r.issue_date ?? '',
        ref: r.number ?? '—',
        description: 'Invoice',
        debitPence: r.total_pence,
        creditPence: 0,
        balancePence: openBalance(r),
        dueDate: r.due_date,
        daysOverdue: r.due_date ? Math.max(0, daysBetween(r.due_date, today)) : 0,
      }));
  } else {
    const { data: payData } = await supabase
      .from('payments')
      .select('id, amount_pence, received_date, reference, method')
      .eq('firm_id', args.firmId).eq('client_id', args.clientId)
      .order('received_date', { ascending: true })
      .limit(1000);
    const payments = (payData ?? []) as PayRow[];

    // Everything before the window nets down to one opening figure. Credit notes
    // count against the invoice they were raised on, so they belong here too —
    // without them the running balance never ties back to what's really owed.
    const invBefore = invoices
      .filter(r => (r.issue_date ?? '') < periodFrom)
      .reduce((s, r) => s + r.total_pence - (r.credit_pence ?? 0), 0);
    const payBefore = payments.filter(p => p.received_date < periodFrom).reduce((s, p) => s + p.amount_pence, 0);
    broughtForwardPence = invBefore - payBefore;

    const inWindow: StatementLine[] = [
      ...invoices.filter(r => (r.issue_date ?? '') >= periodFrom).map(r => ({
        kind: 'invoice' as const,
        date: r.issue_date ?? '',
        ref: r.number ?? '—',
        description: 'Invoice',
        debitPence: r.total_pence,
        creditPence: 0,
        dueDate: r.due_date,
      })),
      // A credit applied to an in-window invoice, shown against it. The credit
      // note's own date isn't on the invoice row, so it sits with its invoice.
      ...invoices.filter(r => (r.issue_date ?? '') >= periodFrom && (r.credit_pence ?? 0) > 0).map(r => ({
        kind: 'payment' as const,
        date: r.issue_date ?? '',
        ref: r.number ?? '—',
        description: 'Credit note',
        debitPence: 0,
        creditPence: r.credit_pence ?? 0,
      })),
      ...payments.filter(p => p.received_date >= periodFrom).map(p => ({
        kind: 'payment' as const,
        date: p.received_date,
        ref: p.reference ?? '—',
        description: p.method === 'manual' ? 'Payment received' : 'Payment received (card/DD)',
        debitPence: 0,
        creditPence: p.amount_pence,
      })),
    ].sort((a, b) => (a.date === b.date ? (a.kind === 'invoice' ? -1 : 1) : a.date < b.date ? -1 : 1));

    let running = broughtForwardPence;
    lines = inWindow.map(l => {
      running += l.debitPence - l.creditPence;
      return { ...l, runningPence: running };
    });
  }

  // An activity statement's headline is where its own table ends — otherwise the
  // rows and the total would disagree in front of the client.
  const closingPence = args.mode === 'activity'
    ? (lines.length ? (lines[lines.length - 1].runningPence ?? 0) : (broughtForwardPence ?? 0))
    : outstandingPence;

  return {
    mode: args.mode,
    clientName: client.name as string,
    statementDate: today,
    ...(args.mode === 'activity' ? { periodFrom, broughtForwardPence } : {}),
    lines,
    outstandingPence,
    closingPence,
    aged,
  };
}
