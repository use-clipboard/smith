// Backfill system_role / ledger_key / code onto a book's accounts.
//
// Books created before migration 20260630 have NULL system_role/ledger_key/code.
// This stamps them from the template seed (matched on ledger + name), and gives
// any user-created account that the seed doesn't know about a code in the right
// band. Idempotent: only fills NULLs, never overwrites an existing value.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookTemplateType } from '@/types/bookkeeping';
import { getCoaSeed, assignSeedCodes } from '@/config/bookkeeping/coa-defaults';
import { rangeBaseFor, nextCodeInRange, type CodeAccountType } from './accountCodes';

const nrm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export interface BackfillResult {
  updated: number;
  skipped: number; // already had all three set
}

export async function backfillAccountMeta(
  supabase: SupabaseClient,
  bookId: string,
  templateType: BookTemplateType,
): Promise<BackfillResult> {
  const seed = getCoaSeed(templateType);

  // Seed lookup by normalised (ledger, name) → {ledger_key, system_role, code}.
  const seedMeta = new Map<string, { ledger_key: string; system_role: string | null; code: string | null }>();
  if (seed) {
    const codes = assignSeedCodes(seed);
    for (const ledger of seed.ledgers) {
      for (const acct of ledger.accounts) {
        seedMeta.set(`${nrm(ledger.name)}::${nrm(acct.name)}`, {
          ledger_key: ledger.ledger_key,
          system_role: acct.system_role ?? null,
          code: codes.get(`${ledger.name}::${acct.name}`) ?? null,
        });
      }
    }
  }

  const { data: accounts, error } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name, ledger, ledger_key, account_type, system_role, code')
    .eq('book_id', bookId);
  if (error) throw error;
  const rows = accounts ?? [];

  // Codes already in use across the book — so user-created accounts get a free one.
  const usedCodes: Array<string | null> = rows.map(r => r.code as string | null);

  let updated = 0;
  let skipped = 0;

  for (const a of rows) {
    const patch: Record<string, unknown> = {};
    const match = seedMeta.get(`${nrm(a.ledger)}::${nrm(a.name)}`);

    if (a.ledger_key == null) {
      // Seed match wins; otherwise borrow a sibling's key in the same ledger.
      const sibling = rows.find(r => r.ledger === a.ledger && r.ledger_key)?.ledger_key as string | undefined;
      const key = match?.ledger_key ?? sibling ?? null;
      if (key) patch.ledger_key = key;
    }
    if (a.system_role == null && match?.system_role) {
      patch.system_role = match.system_role;
    }
    if (a.code == null) {
      let code = match?.code ?? null;
      if (!code) {
        const base = rangeBaseFor(
          a.account_type as CodeAccountType,
          (patch.ledger_key as string | null) ?? (a.ledger_key as string | null),
          a.ledger,
        );
        code = nextCodeInRange(usedCodes, base);
      }
      if (code) {
        patch.code = code;
        usedCodes.push(code); // reserve so the next user account doesn't collide
      }
    }

    if (Object.keys(patch).length === 0) { skipped++; continue; }
    const { error: updErr } = await supabase
      .from('bookkeeping_accounts')
      .update(patch)
      .eq('id', a.id);
    if (updErr) throw updErr;
    updated++;
  }

  return { updated, skipped };
}
