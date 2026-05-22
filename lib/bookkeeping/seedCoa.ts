// Seed a new bookkeeping book's Chart of Accounts from the template default.
//
// Called from the POST /api/bookkeeping/books handler after the book row is
// inserted. Safe to call multiple times — uses INSERT … ON CONFLICT so re-runs
// (e.g. backfilling VAT accounts when a book is flipped to VAT-registered)
// don't duplicate accounts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getCoaSeed } from '@/config/bookkeeping/coa-defaults';
import type { BookTemplateType } from '@/types/bookkeeping';

interface SeedOptions {
  /** When false, accounts marked `vat_only: true` in the seed are skipped. */
  vatRegistered: boolean;
}

export interface SeedResult {
  inserted: number;
  skipped: number;       // already existed in the book
  vat_skipped: number;   // skipped because the book isn't VAT-registered
}

/**
 * Expand the template's COA into bookkeeping_accounts rows for this book.
 *
 * Templates that don't have a seed yet (sole_trader, llp, etc.) return
 * { inserted: 0 } — the book ships with an empty COA and the user/admin
 * builds it from there.
 */
export async function seedBookCoa(
  supabase: SupabaseClient,
  bookId: string,
  templateType: BookTemplateType,
  opts: SeedOptions,
): Promise<SeedResult> {
  const seed = getCoaSeed(templateType);
  if (!seed) return { inserted: 0, skipped: 0, vat_skipped: 0 };

  let vatSkipped = 0;
  const rows: Array<{
    book_id: string;
    ledger: string;
    name: string;
    account_type: string;
    sort_order: number;
  }> = [];

  let sortOrder = 0;
  for (const ledger of seed.ledgers) {
    for (const account of ledger.accounts) {
      if (account.vat_only && !opts.vatRegistered) {
        vatSkipped++;
        continue;
      }
      rows.push({
        book_id: bookId,
        ledger: ledger.name,
        name: account.name,
        account_type: ledger.account_type,
        sort_order: sortOrder++,
      });
    }
  }

  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, vat_skipped: vatSkipped };
  }

  // ON CONFLICT (book_id, ledger, name) DO NOTHING — keeps re-runs idempotent
  // for the VAT back-fill case. Supabase JS doesn't expose the SQL onConflict
  // returning behaviour we want directly, so we do two passes: check what
  // already exists, only insert the gap.
  const { data: existing, error: loadErr } = await supabase
    .from('bookkeeping_accounts')
    .select('ledger, name')
    .eq('book_id', bookId);
  if (loadErr) throw loadErr;

  const existingKeys = new Set(
    (existing ?? []).map(a => `${a.ledger}::${a.name}`),
  );
  const toInsert = rows.filter(r => !existingKeys.has(`${r.ledger}::${r.name}`));
  const alreadyThere = rows.length - toInsert.length;

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: alreadyThere, vat_skipped: vatSkipped };
  }

  const { error: insertErr } = await supabase
    .from('bookkeeping_accounts')
    .insert(toInsert);
  if (insertErr) throw insertErr;

  return { inserted: toInsert.length, skipped: alreadyThere, vat_skipped: vatSkipped };
}
