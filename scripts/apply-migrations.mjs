#!/usr/bin/env node
// Guarded migration runner for the SMITH Supabase database.
//
// Migrations are normally applied by hand in the Supabase SQL editor, which
// drifts (a skipped file silently breaks a feature — see the workflow_customised
// incident). This runner lets Claude apply a migration the moment it's written.
//
// SAFETY MODEL — it only ever applies the file(s) you NAME. It never replays the
// whole history (that would re-run old data backfills), so there's no baseline to
// seed. Each file runs in its own transaction and is recorded in _claude_migrations;
// destructive statements (DROP/TRUNCATE/DELETE FROM) abort unless --allow-destructive.
//
// Requires SUPABASE_DB_URL in .env.local (Supabase dashboard → Project Settings →
// Database → Connection string → URI). Uses SSL.
//
// USAGE
//   node scripts/apply-migrations.mjs 20260800_foo.sql [20260801 ...]   apply named file(s)
//   node scripts/apply-migrations.mjs --status                          list what's been applied
//   node scripts/apply-migrations.mjs --pending                         list files NOT yet recorded
//   node scripts/apply-migrations.mjs 20260800 --dry                    print SQL, don't run
//   flags: --force (re-apply even if recorded) · --allow-destructive · --dry

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i === -1) continue;
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch { /* no .env.local */ }
  return out;
}

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const names = argv.filter(a => !a.startsWith('--'));
const DRY = flags.has('--dry');
const FORCE = flags.has('--force');
const ALLOW_DESTRUCTIVE = flags.has('--allow-destructive');

// ── destructive-statement detector (ignores `on delete cascade` etc.) ─────────
function findDestructive(sql) {
  const stripped = sql
    .replace(/--[^\n]*/g, '')          // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
  const re = /\b(drop\s+(table|schema|database|column|type|index|function|view|trigger|policy|constraint|sequence)|truncate\b|delete\s+from)\b/gi;
  const hits = new Set();
  let m;
  while ((m = re.exec(stripped))) hits.add(m[0].replace(/\s+/g, ' ').toLowerCase());
  return [...hits];
}

function allFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
}

function resolveName(name) {
  const files = allFiles();
  const base = name.replace(/\.sql$/, '');
  const exact = files.find(f => f === name || f === `${base}.sql`);
  if (exact) return exact;
  const byPrefix = files.filter(f => f.startsWith(base) || f.startsWith(name.split('_')[0]));
  if (byPrefix.length === 1) return byPrefix[0];
  if (byPrefix.length > 1) throw new Error(`"${name}" matches ${byPrefix.length} files: ${byPrefix.join(', ')}`);
  throw new Error(`no migration file matches "${name}"`);
}

async function main() {
  const env = loadEnv();
  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('✗ SUPABASE_DB_URL is not set in .env.local.\n  Add it from: Supabase dashboard → Project Settings → Database → Connection string → URI');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(`
    create table if not exists _claude_migrations (
      version text primary key,
      applied_at timestamptz not null default now(),
      applied_by text default 'claude-runner'
    );
  `);

  const applied = new Set((await client.query('select version from _claude_migrations')).rows.map(r => r.version));

  if (flags.has('--status')) {
    const rows = (await client.query('select version, applied_at from _claude_migrations order by version')).rows;
    console.log(rows.length ? rows.map(r => `  ${r.version}  ${r.applied_at.toISOString().slice(0,16).replace('T',' ')}`).join('\n') : '  (runner has applied nothing yet)');
    await client.end(); return;
  }
  if (flags.has('--pending')) {
    const pending = allFiles().filter(f => !applied.has(f));
    console.log(pending.length ? pending.map(f => `  ${f}`).join('\n') : '  (every migration file is recorded as applied by the runner)');
    console.log(`\n  Note: "pending" here means the RUNNER hasn't applied it — files applied by hand in the SQL editor also show here. Use scripts/check-migrations.mjs to verify actual DB objects.`);
    await client.end(); return;
  }

  if (names.length === 0) {
    console.error('Name at least one migration file, or use --status / --pending.\n  e.g. node scripts/apply-migrations.mjs 20260800_foo.sql');
    await client.end(); process.exit(1);
  }

  let files;
  try { files = [...new Set(names.map(resolveName))].sort(); }
  catch (e) { console.error(`✗ ${e.message}`); await client.end(); process.exit(1); }

  let ok = 0, skipped = 0;
  for (const file of files) {
    if (applied.has(file) && !FORCE) { console.log(`↷ skip ${file} — already applied by the runner (use --force to re-run)`); skipped++; continue; }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const destructive = findDestructive(sql);
    if (destructive.length && !ALLOW_DESTRUCTIVE) {
      console.error(`✗ ${file} contains destructive statements [${destructive.join(', ')}].\n  Re-run with --allow-destructive if that is intended. Stopping.`);
      await client.end(); process.exit(2);
    }
    if (DRY) { console.log(`\n── ${file}${destructive.length ? '  ⚠ destructive: ' + destructive.join(', ') : ''} ──\n${sql.trim()}\n`); continue; }
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _claude_migrations(version) values ($1) on conflict (version) do update set applied_at = now()', [file]);
      await client.query('commit');
      console.log(`✓ applied ${file}${destructive.length ? '  (destructive, allowed)' : ''}`);
      ok++;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      console.error(`✗ FAILED ${file}: ${e.message}\n  (rolled back; nothing from this file was applied). Stopping.`);
      await client.end(); process.exit(3);
    }
  }
  await client.end();
  console.log(DRY ? '\nDry run — nothing applied.' : `\nDone. applied=${ok} skipped=${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
