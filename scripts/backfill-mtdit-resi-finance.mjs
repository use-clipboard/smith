// One-off backfill: reclassify legacy finance-cost entries to the new
// residential category.
//
// Until now the only rental finance category was "Non Residential Financial
// Costs" — the sole option available — so residential mortgage/loan interest was
// mis-filed there (and, worse, treated as a fully deductible expense). The tool
// now splits finance costs into "Residential Finance Costs" (restricted, 20% tax
// reducer) and "Non-Residential Finance Costs" (deductible commercial interest).
//
// Residential letting is the overwhelming majority, and moving a cost OUT of the
// deductible bucket is the compliance-safe direction, so this reclassifies the
// legacy rows to "Residential Finance Costs" and prints a REVIEW LIST for the
// team to flip any genuinely commercial ones back. It does NOT flag rows
// (flagging would drop them from the totals) — it only changes the category.
//
// SAFETY: only touches DRAFT quarters. Anything already sent/approved/submitted
// (i.e. figures a client has seen or that were filed with HMRC) is left alone
// and reported separately — changing those is an amendment, a human decision.
//
// DRY RUN by default — prints the plan and changes nothing.
//   node scripts/backfill-mtdit-resi-finance.mjs            # dry run
//   node scripts/backfill-mtdit-resi-finance.mjs --apply    # execute

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

const LEGACY_CATEGORY = 'Non Residential Financial Costs';
const NEW_CATEGORY    = 'Residential Finance Costs';
const EDITABLE_STATUSES = new Set(['not_started', 'draft', 'complete']); // pre-send only

// Pull every legacy finance entry (rental streams), paginated.
const rows = [];
const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await sb
    .from('mtd_it_entries')
    .select('id, quarter_id, stream, category, description, supplier, gross_amount, gbp_amount, currency, property_id, entry_type')
    .eq('category', LEGACY_CATEGORY)
    .order('id')
    .range(from, from + PAGE - 1);
  if (error) { console.error('entries fetch error', error); process.exit(1); }
  rows.push(...(data ?? []));
  if (!data || data.length < PAGE) break;
}

// Quarter status + client for each entry.
const qids = [...new Set(rows.map(r => r.quarter_id).filter(Boolean))];
const qInfo = new Map();
for (let i = 0; i < qids.length; i += 500) {
  const { data } = await sb.from('mtd_it_quarters')
    .select('id, status, client_id, tax_year, quarter').in('id', qids.slice(i, i + 500));
  for (const q of data ?? []) qInfo.set(q.id, q);
}
// Client names + property addresses for the review list.
const clientIds = [...new Set([...qInfo.values()].map(q => q.client_id).filter(Boolean))];
const clientName = new Map();
for (let i = 0; i < clientIds.length; i += 500) {
  const { data } = await sb.from('clients').select('id, name, client_ref').in('id', clientIds.slice(i, i + 500));
  for (const c of data ?? []) clientName.set(c.id, `${c.name}${c.client_ref ? ` (${c.client_ref})` : ''}`);
}
const propIds = [...new Set(rows.map(r => r.property_id).filter(Boolean))];
const propAddr = new Map();
for (let i = 0; i < propIds.length; i += 500) {
  const { data } = await sb.from('mtd_it_properties').select('id, address').in('id', propIds.slice(i, i + 500));
  for (const p of data ?? []) propAddr.set(p.id, p.address);
}

// Not every legacy row is actually a finance cost — the AI used this category as
// a catch-all, so insurance and other deductible costs landed here too. Only move
// rows that genuinely read as finance; leave the rest (they're correctly
// deductible where they are) and list them for manual recategorisation.
const looksFinance = (s) => /mortgage|interest|\bloan\b|finance charge|arrangement fee|broker fee|re-?mortgage/i.test(s ?? '');

const editable = [];      // finance rows in editable quarters → will move
const notFinance = [];    // editable but doesn't read as finance → leave, list for review
const locked = [];        // sent/approved/submitted → never touch
for (const r of rows) {
  const q = qInfo.get(r.quarter_id);
  const status = q?.status ?? 'unknown';
  const rec = { ...r, status, q };
  if (!EDITABLE_STATUSES.has(status)) { locked.push(rec); continue; }
  (looksFinance(r.description) || looksFinance(r.supplier) ? editable : notFinance).push(rec);
}

const gbp = (r) => {
  const v = typeof r.gbp_amount === 'number' ? r.gbp_amount
    : r.currency === 'GBP' ? Number(r.gross_amount ?? 0) : null;
  return v == null ? '   (fx)' : `£${Number(v).toFixed(2)}`;
};

console.log('=== MTD IT residential finance-cost backfill ===');
console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no changes)'}`);
console.log(`Legacy category "${LEGACY_CATEGORY}" → "${NEW_CATEGORY}"`);
console.log('');
console.log(`Total legacy "${LEGACY_CATEGORY}" entries: ${rows.length}`);
console.log(`  • finance, editable → reclassify to Residential: ${editable.length}`);
console.log(`  • editable but NOT finance (e.g. insurance) → left as-is, recategorise manually: ${notFinance.length}`);
console.log(`  • locked (sent/approved/submitted) → untouched: ${locked.length}`);
console.log('');

console.log('--- WILL RECLASSIFY to Residential (flip any genuine COMMERCIAL ones back afterwards) ---');
for (const r of editable) {
  const client = clientName.get(r.q?.client_id) ?? '(unknown client)';
  const addr = r.property_id ? (propAddr.get(r.property_id) ?? '(unknown property)') : '(untagged)';
  console.log(`  ${gbp(r).padStart(12)}  ${client}  ·  ${addr}  ·  ${r.description ?? r.supplier ?? '(no description)'}`);
}
if (notFinance.length > 0) {
  console.log('');
  console.log('--- NOT MOVED — does not read as a finance cost. Recategorise manually (e.g. insurance → Premises Running Costs) ---');
  for (const r of notFinance) {
    const client = clientName.get(r.q?.client_id) ?? '(unknown client)';
    const addr = r.property_id ? (propAddr.get(r.property_id) ?? '(unknown property)') : '(untagged)';
    console.log(`  ${gbp(r).padStart(12)}  ${client}  ·  ${addr}  ·  ${r.description ?? r.supplier ?? '(no description)'}`);
  }
}
if (locked.length > 0) {
  console.log('');
  console.log('--- LOCKED (NOT changed — sent/approved/filed; amend manually if residential) ---');
  for (const r of locked) {
    const client = clientName.get(r.q?.client_id) ?? '(unknown client)';
    console.log(`  [${r.status}]  ${client}  ·  ${r.description ?? r.supplier ?? '(no description)'}`);
  }
}
console.log('');

if (!APPLY) {
  console.log('Dry run only — re-run with --apply to reclassify the editable rows.');
  process.exit(0);
}

if (editable.length === 0) {
  console.log('Nothing editable to change.');
  process.exit(0);
}

let done = 0;
for (let i = 0; i < editable.length; i += 200) {
  const batch = editable.slice(i, i + 200).map(r => r.id);
  const { error } = await sb.from('mtd_it_entries').update({ category: NEW_CATEGORY }).in('id', batch);
  if (error) { console.error('update error', error); process.exit(1); }
  done += batch.length;
}
console.log(`Reclassified ${done} entr${done === 1 ? 'y' : 'ies'} to "${NEW_CATEGORY}".`);
console.log('Review the list above and set any commercial ones to "Non-Residential Finance Costs" in the app.');
