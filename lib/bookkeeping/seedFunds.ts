// Seed a new charity book's default fund.
//
// Called from the POST /api/bookkeeping/books handler after the book row is
// inserted, only when template_type === 'charity'. Every charity has general
// unrestricted funds, so we seed a single "General" unrestricted fund — the
// user adds restricted / endowment funds (which carry specific donor-given
// names, e.g. "Building Fund") from the Funds settings.
//
// Idempotent: skips if the book already has any funds.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SeedFundsResult {
  inserted: number;
  skipped: boolean; // book already had funds
}

export async function seedBookFunds(
  supabase: SupabaseClient,
  bookId: string,
  createdBy: string | null,
): Promise<SeedFundsResult> {
  const { data: existing, error: loadErr } = await supabase
    .from('bookkeeping_funds')
    .select('id')
    .eq('book_id', bookId)
    .limit(1);
  if (loadErr) throw loadErr;
  if (existing && existing.length > 0) return { inserted: 0, skipped: true };

  const { error: insertErr } = await supabase
    .from('bookkeeping_funds')
    .insert({
      book_id: bookId,
      name: 'General',
      fund_type: 'unrestricted',
      description: 'General unrestricted funds',
      sort_order: 0,
      created_by: createdBy,
    });
  if (insertErr) throw insertErr;

  return { inserted: 1, skipped: false };
}
