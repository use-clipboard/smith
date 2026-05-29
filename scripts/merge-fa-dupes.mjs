// Merge double-space FA b/fwd duplicate accounts into their single-space
// COA-seed counterparts.
//
// For each book + ledger, finds groups of accounts whose names are identical
// once whitespace is normalised (e.g. "Cost -  b/fwd" vs "Cost - b/fwd"). Picks
// the CANONICAL survivor — the one whose name exactly matches the normalised
// form (the seed's single-space name) — re-points every split from the other
// copies onto the survivor, then deletes the now-empty duplicates.
//
// DRY RUN by default — prints the plan and changes nothing.
// Pass --apply to actually perform the re-point + delete.
//
//   node scripts/merge-fa-dupes.mjs            # dry run
//   node scripts/merge-fa-dupes.mjs --apply    # execute

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

const APPLY = process.argv.includes('--apply');
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

// All FA accounts (ledger starts with "FA ").
const { data: accounts, error } = await sb
  .from('bookkeeping_accounts')
  .select('id, book_id, ledger, name, archived')
  .order('book_id');
if (error) { console.error(error); process.exit(1); }

const fa = (accounts ?? []).filter(a => typeof a.ledger === 'string' && /^fa\b/i.test(a.ledger.trim()));

// Group by (book, ledger, normalised name).
const groups = new Map();
for (const a of fa) {
  const k = `${a.book_id}|||${a.ledger}|||${norm(a.name).toLowerCase()}`;
  (groups.get(k) ?? groups.set(k, []).get(k)).push(a);
}

async function splitCount(accountId) {
  const { count } = await sb.from('bookkeeping_transaction_splits')
    .select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  return count ?? 0;
}

let planned = 0;
for (const [, group] of groups) {
  if (group.length < 2) continue;

  // Survivor: prefer the copy whose name == its own normalised form (single
  // space — the seed's canonical name). Fall back to the first if none match.
  const canonical = norm(group[0].name);
  const survivor = group.find(a => a.name === canonical) ?? group[0];
  const losers = group.filter(a => a.id !== survivor.id);

  console.log(`\nbook ${survivor.book_id} — ${survivor.ledger}`);
  console.log(`  survivor: "${survivor.name}"  id=${survivor.id}`);
  for (const l of losers) {
    const n = await splitCount(l.id);
    console.log(`  merge   : "${l.name}"  id=${l.id}  (${n} split${n === 1 ? '' : 's'} → survivor)`);
    planned++;

    if (APPLY) {
      // Re-point splits onto the survivor.
      const { error: upErr } = await sb.from('bookkeeping_transaction_splits')
        .update({ account_id: survivor.id }).eq('account_id', l.id);
      if (upErr) { console.error(`    ! failed to re-point splits: ${upErr.message}`); continue; }

      // Safety: confirm no splits remain before deleting.
      const remaining = await splitCount(l.id);
      if (remaining > 0) { console.error(`    ! ${remaining} splits still on loser — NOT deleting`); continue; }

      const { error: delErr } = await sb.from('bookkeeping_accounts').delete().eq('id', l.id);
      if (delErr) { console.error(`    ! failed to delete loser: ${delErr.message}`); continue; }
      console.log('    ✓ merged & deleted');
    }
  }
}

console.log(`\n${planned} duplicate account(s) ${APPLY ? 'merged' : 'would be merged'}.`);
if (!APPLY) console.log('Dry run only — re-run with --apply to execute.');
