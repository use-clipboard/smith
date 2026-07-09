// Billing module — map raw Supabase rows to the app-facing types.

import { balancePence } from './totals';
import type {
  Invoice, InvoiceLine, InvoiceStatus, InvoiceSource,
  RecurringInvoice, RecurrenceFrequency, RecurringStatus, RecurringTemplateLine,
} from './types';

export interface InvoiceRow {
  id: string;
  client_id: string | null;
  client_name: string | null;
  number: string | null;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  amount_paid_pence: number;
  notes: string | null;
  terms: string | null;
  source: string;
  auto_chase: boolean | null;
  created_at: string;
}

export interface InvoiceLineRow {
  id: string;
  description: string;
  quantity: number;
  unit_price_pence: number;
  vat_rate: number;
  net_pence: number;
  vat_pence: number;
  gross_pence: number;
  position: number;
}

export function mapLineRow(r: InvoiceLineRow): InvoiceLine {
  return {
    id: r.id,
    description: r.description,
    quantity: Number(r.quantity),
    unitPricePence: r.unit_price_pence,
    vatRate: Number(r.vat_rate),
    netPence: r.net_pence,
    vatPence: r.vat_pence,
    grossPence: r.gross_pence,
    position: r.position,
  };
}

export interface RecurringRow {
  id: string;
  client_id: string | null;
  client_name: string | null;
  frequency: string;
  interval_days: number | null;
  day_of_month: number | null;
  start_date: string;
  next_run_date: string;
  end_date: string | null;
  status: string;
  template: RecurringTemplateLine[] | null;
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  notes: string | null;
  terms: string | null;
  auto_send: boolean;
  source_note: string | null;
  last_run_date: string | null;
  created_at: string;
}

export function mapRecurringRow(r: RecurringRow): RecurringInvoice {
  return {
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    frequency: r.frequency as RecurrenceFrequency,
    intervalDays: r.interval_days,
    dayOfMonth: r.day_of_month,
    startDate: r.start_date,
    nextRunDate: r.next_run_date,
    endDate: r.end_date,
    status: r.status as RecurringStatus,
    template: (r.template ?? []) as RecurringTemplateLine[],
    subtotalPence: r.subtotal_pence,
    vatPence: r.vat_pence,
    totalPence: r.total_pence,
    notes: r.notes,
    terms: r.terms,
    autoSend: r.auto_send,
    sourceNote: r.source_note,
    lastRunDate: r.last_run_date,
    createdAt: r.created_at,
  };
}

export function mapInvoiceRow(r: InvoiceRow, lines?: InvoiceLineRow[]): Invoice {
  return {
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    number: r.number,
    status: r.status as InvoiceStatus,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    currency: r.currency,
    subtotalPence: r.subtotal_pence,
    vatPence: r.vat_pence,
    totalPence: r.total_pence,
    amountPaidPence: r.amount_paid_pence,
    balancePence: balancePence(r.total_pence, r.amount_paid_pence),
    notes: r.notes,
    terms: r.terms,
    source: r.source as InvoiceSource,
    autoChase: r.auto_chase ?? true,
    createdAt: r.created_at,
    lines: lines ? lines.map(mapLineRow) : undefined,
  };
}
