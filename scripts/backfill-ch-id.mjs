// One-off backfill: mirror registration_number → companies_house_id for
// limited companies and LLPs where companies_house_id is blank.
//
// Going forward the clients API keeps these two in sync automatically; this
// script fixes the existing rows created before that logic existed. Only fills
// blanks — never overwrites a companies_house_id that already has a value.
//
// DRY RUN by default — prints the plan and changes nothing.
// Pass --apply to actually write.
//
//   node scripts/backfill-ch-id.mjs            # dry run
//   node scripts/backfill-ch-id.mjs --apply    # execute

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
// Also overwrite Ltd/LLP where companies_house_id is already set but differs
// from registration_number (e.g. a lost leading zero). Off by default so a
// plain run never clobbers existing values.
const ALIGN_MISMATCHED = process.argv.includes('--align-mismatched');
const blank = (v) => v == null || String(v).trim() === '';

// Paginate to beat the PostgREST ~1000-row cap.
const rows = [];
const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await sb
    .from('clients')
    .select('id, name, client_ref, business_type, registration_number, companies_house_id')
    .in('business_type', ['limited_company', 'llp'])
    .order('id')
    .range(from, from + PAGE - 1);
  if (error) { console.error('fetch error', error); process.exit(1); }
  rows.push(...(data ?? []));
  if (!data || data.length < PAGE) break;
}

// Candidates: has a registration_number, companies_house_id is blank (or
// differs — a blank target only), and they aren't already equal.
const candidates = rows.filter(r =>
  !blank(r.registration_number) && blank(r.companies_house_id));

console.log(`Ltd/LLP clients scanned: ${rows.length}`);
console.log(`Need backfill (blank companies_house_id, have a company number): ${candidates.length}`);
for (const c of candidates.slice(0, 30)) {
  console.log(`  ${c.client_ref ?? '—'}  ${c.name}  reg=${c.registration_number}  ch_id=${c.companies_house_id ?? '(blank)'}`);
}
if (candidates.length > 30) console.log(`  … and ${candidates.length - 30} more`);

// Also report Ltd/LLP where both are set but differ — informational only, NOT
// touched (we don't clobber existing values).
const mismatched = rows.filter(r =>
  !blank(r.registration_number) && !blank(r.companies_house_id) &&
  String(r.registration_number).trim() !== String(r.companies_house_id).trim());
if (mismatched.length) {
  const note = ALIGN_MISMATCHED ? 'will be ALIGNED to reg' : 'left untouched — pass --align-mismatched to fix';
  console.log(`\nℹ ${mismatched.length} Ltd/LLP have BOTH set but differing (${note}):`);
  for (const c of mismatched.slice(0, 20)) {
    console.log(`  ${c.client_ref ?? '—'}  ${c.name}  reg=${c.registration_number}  ch_id=${c.companies_house_id}`);
  }
}

// Rows to write: always the blank candidates; the mismatched ones only when
// explicitly asked to align.
const toWrite = ALIGN_MISMATCHED ? [...candidates, ...mismatched] : candidates;

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Re-run with --apply${ALIGN_MISMATCHED ? ' --align-mismatched' : ''} to write ${toWrite.length} row(s).`);
  process.exit(0);
}

let ok = 0, fail = 0;
for (const c of toWrite) {
  const { error } = await sb
    .from('clients')
    .update({ companies_house_id: String(c.registration_number).trim() })
    .eq('id', c.id);
  if (error) { console.error(`  ✗ ${c.client_ref ?? c.id}`, error.message); fail++; }
  else ok++;
}
console.log(`\nApplied: ${ok} updated, ${fail} failed.`);
process.exit(fail ? 1 : 0);
