// READ-ONLY diagnostic: find duplicate FA movement accounts.
//
// Lists, per book, every account whose ledger looks like a fixed-asset ledger,
// showing the EXACT ledger string (quoted so trailing spaces/case are visible),
// the account name, whether it's archived, and its split balance + split count.
// Pairs with the same display name but different ledger strings are the dupes.
//
// Run: node scripts/diag-fa-dupes.mjs [optionalBookId]
// Does NOT write anything.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Load .env.local manually (no dotenv dependency assumed).
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });
const onlyBook = process.argv[2] ?? null;

// FA ledgers always start with "FA " — match loosely so odd-cased dupes show too.
const isFa = (l) => typeof l === 'string' && /fa\b/i.test(l) && /b\/?fwd|additions|disposals|depn|cost|amort/i.test('x');

let q = sb.from('bookkeeping_accounts')
  .select('id, book_id, ledger, name, archived, inactive')
  .order('book_id').order('ledger').order('name');
if (onlyBook) q = q.eq('book_id', onlyBook);
const { data: accounts, error } = await q;
if (error) { console.error(error); process.exit(1); }

// Keep only fixed-asset-looking ledgers.
const fa = (accounts ?? []).filter(a => typeof a.ledger === 'string'
  ? /^fa\b/i.test(a.ledger.trim()) : a.ledger === null && /b\/?fwd|cost|depn|amort/i.test(a.name));
// Also pull in NULL-ledger orphans whose name matches an FA movement account.
const orphans = (accounts ?? []).filter(a =>
  a.ledger === null && /(cost|depn|amortisation) - (b\/fwd|additions|disposals|charge)/i.test(a.name));
const set = new Map();
for (const a of [...fa, ...orphans]) set.set(a.id, a);
const rows = [...set.values()];

// Balance + split count per account.
async function balance(accountId) {
  const { data } = await sb.from('bookkeeping_transaction_splits')
    .select('debit, credit').eq('account_id', accountId);
  const n = (data ?? []).length;
  const bal = (data ?? []).reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);
  return { n, bal: Math.round(bal * 100) / 100 };
}

// A real duplicate is two accounts in the SAME book + SAME ledger whose names
// are equal once whitespace/case is normalised. Group by that normalised key so
// legitimate per-ledger copies (each FA ledger has its own "Cost - b/fwd") are
// NOT flagged — only genuine in-ledger twins like "Cost - b/fwd" vs
// "Cost -  b/fwd" (double space).
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const byKey = new Map();
for (const a of rows) {
  const k = `${a.book_id}|||${JSON.stringify(a.ledger)}|||${norm(a.name)}`;
  (byKey.get(k) ?? byKey.set(k, []).get(k)).push(a);
}

let dupeGroups = 0;
for (const [k, group] of byKey) {
  if (group.length < 2) continue;
  dupeGroups++;
  const [bookId, ledger] = k.split('|||');
  console.log(`\n=== book ${bookId} — ledger ${ledger} — ${group.length} copies of the same account ===`);
  for (const a of group) {
    const { n, bal } = await balance(a.id);
    console.log(
      `  name=${JSON.stringify(a.name)} archived=${a.archived} inactive=${a.inactive} ` +
      `splits=${n} balance=${bal}  id=${a.id}`,
    );
  }
}

if (dupeGroups === 0) {
  console.log('No same-book + same-ledger duplicate accounts found among FA accounts.');
}
console.log(`\nScanned ${rows.length} FA-looking accounts; ${dupeGroups} true duplicate group(s).`);
