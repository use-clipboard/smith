// Billing module — invoice / credit-note number allocation.
//
// Reads billing_settings for the firm, formats the next number, and advances
// the sequence. For the internal 16-user firm a read-modify-write is fine;
// when we move to higher concurrency this should become a Postgres RPC that
// increments atomically. Callers pass a firm-scoped Supabase client.

import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULTS = {
  invoice_prefix: 'INV-',
  next_invoice_number: 1,
  credit_note_prefix: 'CN-',
  next_credit_note_number: 1,
};

/** Zero-pad the numeric part to at least 4 digits (INV-0001). */
function formatNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

interface SettingsRow {
  invoice_prefix: string | null;
  next_invoice_number: number | null;
  credit_note_prefix: string | null;
  next_credit_note_number: number | null;
}

async function ensureSettings(supabase: SupabaseClient, firmId: string): Promise<SettingsRow> {
  const { data } = await supabase
    .from('billing_settings')
    .select('invoice_prefix, next_invoice_number, credit_note_prefix, next_credit_note_number')
    .eq('firm_id', firmId)
    .maybeSingle();

  if (data) return data as SettingsRow;

  // First use — create the row with defaults.
  await supabase.from('billing_settings').insert({ firm_id: firmId, ...DEFAULTS });
  return { ...DEFAULTS };
}

/** Allocate the next invoice number for a firm and advance the sequence. */
export async function allocateInvoiceNumber(supabase: SupabaseClient, firmId: string): Promise<string> {
  const s = await ensureSettings(supabase, firmId);
  const prefix = s.invoice_prefix ?? DEFAULTS.invoice_prefix;
  const seq = s.next_invoice_number ?? DEFAULTS.next_invoice_number;
  await supabase
    .from('billing_settings')
    .update({ next_invoice_number: seq + 1, updated_at: new Date().toISOString() })
    .eq('firm_id', firmId);
  return formatNumber(prefix, seq);
}

/** Allocate the next credit-note number for a firm and advance the sequence. */
export async function allocateCreditNoteNumber(supabase: SupabaseClient, firmId: string): Promise<string> {
  const s = await ensureSettings(supabase, firmId);
  const prefix = s.credit_note_prefix ?? DEFAULTS.credit_note_prefix;
  const seq = s.next_credit_note_number ?? DEFAULTS.next_credit_note_number;
  await supabase
    .from('billing_settings')
    .update({ next_credit_note_number: seq + 1, updated_at: new Date().toISOString() })
    .eq('firm_id', firmId);
  return formatNumber(prefix, seq);
}
