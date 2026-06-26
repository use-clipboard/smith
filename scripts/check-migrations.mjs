// Migration drift checker (generator).
//
// We apply migrations by hand in the Supabase SQL editor, so Supabase's own
// migration ledger (supabase_migrations.schema_migrations) does NOT reflect
// what's actually applied. The only reliable signal is whether the database
// OBJECTS each migration creates exist.
//
// This script reads every file in supabase/migrations, extracts the objects it
// creates (tables, columns, functions, indexes, types) and emits a single SQL
// report — scripts/verify-migrations.sql — that you paste into the Supabase SQL
// editor. The report returns one row per migration that has MISSING objects
// (empty result = everything's applied).
//
// Re-run this generator whenever migrations are added:  node scripts/check-migrations.mjs
//
// Caveats: detection is for the `public` schema only and deliberately ignores
// policies/triggers/RLS and pure data backfills (no checkable object) — those
// show as "0 checkable objects" and must be eyeballed. It's a drift smell-test,
// not a formal schema diff.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');
const OUT_SQL = join(__dirname, 'verify-migrations.sql');

const IDENT = `["']?([a-z_][a-z0-9_]*)["']?`;

// Known-superseded objects: a migration created them, then a LATER migration
// deliberately dropped or renamed them. They are *correctly* absent from the
// schema, so we exclude them to avoid false "missing" noise — an empty report
// then genuinely means "all migrations applied". Keyed `migration|kind|ident`.
// Each entry cites the migration that removed it; re-verify if you ever revert
// one of those. (Audited 2026-06-26.)
const SUPERSEDED = new Set([
  // clients.is_active replaced by clients.status in 20260417_client_status.sql
  '20260321_client_links.sql|column|clients:is_active',
  '20260321_client_links.sql|index|clients_is_active_idx',
  // both source-lifecycle toggles dropped for auto_delete_source_on_complete in 20260524
  '20260523_mtd_it_source_lifecycle.sql|column|mtd_it_firm_settings:auto_delete_source_after_save',
  '20260523_mtd_it_source_lifecycle.sql|column|mtd_it_firm_settings:auto_delete_source_on_submit',
  // unique indexes renamed to *_svc_uidx in 20260626_mtd_it_hmrc.sql
  '20260615_hmrc_connections.sql|index|hmrc_connections_firm_agent_uidx',
  '20260615_hmrc_connections.sql|index|hmrc_connections_book_business_uidx',
]);

// Strip a leading `public.` schema prefix; return null if the object is
// explicitly in another schema (auth., storage., …) so we don't check it here.
function stripSchema(match) {
  // match is the captured identifier only (regexes already drop `public.`).
  return match;
}

function matchAll(text, re) {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m);
  return out;
}

function extractObjects(sql) {
  // Drop line comments so `-- create table foo` doesn't get picked up.
  const text = sql.replace(/--[^\n]*/g, ' ');
  const objs = [];
  const add = (kind, ident) => { if (ident) objs.push({ kind, ident: ident.toLowerCase() }); };

  // create table [if not exists] [public.]name
  for (const m of matchAll(text, new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${IDENT}`, 'gi')))
    add('table', stripSchema(m[1]));

  // create [or replace] function [public.]name(
  for (const m of matchAll(text, new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${IDENT}\\s*\\(`, 'gi')))
    add('function', stripSchema(m[1]));

  // create [unique] index [concurrently] [if not exists] [public.]name
  for (const m of matchAll(text, new RegExp(`create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${IDENT}`, 'gi')))
    add('index', stripSchema(m[1]));

  // create type [public.]name
  for (const m of matchAll(text, new RegExp(`create\\s+type\\s+(?:public\\.)?${IDENT}`, 'gi')))
    add('type', stripSchema(m[1]));

  // alter table X ... add column [if not exists] col  (handles multiple adds
  // per statement by binding each add-column to the nearest preceding table).
  const alters = matchAll(text, new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:public\\.)?${IDENT}`, 'gi'))
    .map(m => ({ idx: m.index, table: m[1].toLowerCase() }));
  const addCols = matchAll(text, new RegExp(`add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${IDENT}`, 'gi'))
    .map(m => ({ idx: m.index, col: m[1].toLowerCase() }));
  for (const ac of addCols) {
    let table = null;
    for (const a of alters) if (a.idx < ac.idx) table = a.table; else break;
    if (table) add('column', `${table}:${ac.col}`);
  }

  // Dedupe.
  const seen = new Set();
  return objs.filter(o => {
    const key = `${o.kind}|${o.ident}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

const rows = [];        // { migration, kind, ident }
const noObjects = [];   // migrations with nothing checkable
let totalObjects = 0;

let excluded = 0;
for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  const objs = extractObjects(sql).filter(o => {
    if (SUPERSEDED.has(`${file}|${o.kind}|${o.ident}`)) { excluded++; return false; }
    return true;
  });
  if (objs.length === 0) { noObjects.push(file); continue; }
  for (const o of objs) rows.push({ migration: file, kind: o.kind, ident: o.ident });
  totalObjects += objs.length;
}

const sqlEsc = s => s.replace(/'/g, "''");
const valuesList = rows
  .map(r => `  ('${sqlEsc(r.migration)}','${r.kind}','${sqlEsc(r.ident)}')`)
  .join(',\n');

const out = `-- AUTO-GENERATED by scripts/check-migrations.mjs — do not edit by hand.
-- Paste into the Supabase SQL editor and run. An EMPTY result = every checkable
-- object exists (all migrations applied). Any rows returned list migrations
-- whose objects are missing, i.e. that migration probably never ran.
--
-- Checks ${totalObjects} objects across ${rows.length ? new Set(rows.map(r => r.migration)).size : 0} migrations (public schema only;
-- policies/triggers/RLS and pure-data migrations are not checked).

with expected(migration, kind, ident) as (
  values
${valuesList}
),
checked as (
  select migration, kind, ident,
    case kind
      when 'table'    then to_regclass('public.' || ident) is not null
      when 'index'    then to_regclass('public.' || ident) is not null
      when 'function' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = ident)
      when 'type'     then exists (
        select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = ident)
      when 'column'   then exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name  = split_part(ident, ':', 1)
          and column_name = split_part(ident, ':', 2))
      else null
    end as present
  from expected
)
select
  migration,
  count(*)                                        as expected_objects,
  count(*) filter (where present)                 as present_objects,
  string_agg(kind || ' ' || ident, ', ' order by ident)
    filter (where not present)                    as missing_objects
from checked
group by migration
having count(*) filter (where not present) > 0
order by migration;
`;

writeFileSync(OUT_SQL, out);

// Detail report: one row per missing object (no aggregation, no truncation),
// so you can see exactly what's absent. Same checks as the summary.
const OUT_DETAIL = join(__dirname, 'verify-migrations-detail.sql');
const detail = `-- AUTO-GENERATED by scripts/check-migrations.mjs — do not edit by hand.
-- Per-object detail: every checkable object that is MISSING, one row each.
-- Empty result = all good. Pair with verify-migrations.sql (the summary).

with expected(migration, kind, ident) as (
  values
${valuesList}
),
checked as (
  select migration, kind, ident,
    case kind
      when 'table'    then to_regclass('public.' || ident) is not null
      when 'index'    then to_regclass('public.' || ident) is not null
      when 'function' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = ident)
      when 'type'     then exists (
        select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = ident)
      when 'column'   then exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name  = split_part(ident, ':', 1)
          and column_name = split_part(ident, ':', 2))
      else null
    end as present
  from expected
)
select migration, kind, ident
from checked
where not present
order by migration, kind, ident;
`;
writeFileSync(OUT_DETAIL, detail);

console.log(`Scanned ${files.length} migration files.`);
console.log(`  ${totalObjects} checkable objects across ${new Set(rows.map(r => r.migration)).size} migrations.`);
console.log(`  ${excluded} known-superseded objects excluded (see SUPERSEDED in this script).`);
console.log(`  ${noObjects.length} migrations with no checkable object (verify manually if suspect):`);
for (const f of noObjects) console.log(`    - ${f}`);
console.log(`\nWrote ${OUT_SQL} (summary, one row per migration with gaps)`);
console.log(`Wrote ${OUT_DETAIL} (detail, one row per missing object)`);
console.log('Paste either into the Supabase SQL editor; an empty result means all good.');
