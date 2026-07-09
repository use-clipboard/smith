// Billing module — invoice status display metadata (labels, chip + dot colours).

import type { InvoiceStatus } from '@/lib/billing/types';

export interface StatusMeta {
  label: string;
  chip: string;   // tailwind classes for a filled pill
  dot: string;    // hex for a legend dot / donut
}

export const STATUS_META: Record<InvoiceStatus, StatusMeta> = {
  draft:     { label: 'Draft',     chip: 'bg-slate-100 text-slate-600',     dot: '#94A3B8' },
  sent:      { label: 'Sent',      chip: 'bg-indigo-50 text-indigo-600',    dot: '#6366F1' },
  viewed:    { label: 'Viewed',    chip: 'bg-violet-50 text-violet-600',    dot: '#8B5CF6' },
  part_paid: { label: 'Part paid', chip: 'bg-amber-50 text-amber-600',      dot: '#F59E0B' },
  paid:      { label: 'Paid',      chip: 'bg-emerald-50 text-emerald-600',  dot: '#10B981' },
  overdue:   { label: 'Overdue',   chip: 'bg-rose-50 text-rose-600',        dot: '#F43F5E' },
  cancelled: { label: 'Cancelled', chip: 'bg-slate-100 text-slate-500',     dot: '#CBD5E1' },
  bad_debt:  { label: 'Bad debt',  chip: 'bg-red-100 text-red-700',         dot: '#DC2626' },
};

export const STATUS_FILTERS: InvoiceStatus[] = [
  'draft', 'sent', 'viewed', 'part_paid', 'paid', 'overdue', 'cancelled', 'bad_debt',
];

export const FREQ_LABEL: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  custom: 'Custom',
};
