// ─── Demo firm seed ───────────────────────────────────────────────────────────
// Creates an ISOLATED demo firm ("Smithy Accountants") with fake data for
// website / social content. Lives in the same Supabase DB but is a completely
// separate firm_id, so it never touches the real firm's (MM&Co) data.
//
//   node scripts/seed-demo.mjs            → reset (if exists) then seed fresh
//   node scripts/seed-demo.mjs --reset    → wipe the demo firm only, no re-seed
//
// SAFETY: every delete is scoped to the demo firm_id, which is resolved from the
// demo login email and then re-checked against the firm NAME before anything is
// deleted. If the resolved firm isn't exactly "Smithy Accountants" the script
// aborts. It can never target MM&Co.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// ── Config ──────────────────────────────────────────────────────────────────
const DEMO_FIRM_NAME = 'Smithy Accountants';
const DEMO_EMAIL     = 'smith@smithyaccountants.co.uk';
const DEMO_PASSWORD  = process.env.DEMO_PASSWORD || 'SmithyDemo2026!';
const DEMO_FULL_NAME = 'Sam Smithy';

// ── Env + client ──────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const resetOnly = process.argv.includes('--reset');
const pick = (arr, i) => arr[i % arr.length];

// ── Resolve the demo firm (by login email) ─────────────────────────────────────
async function resolveDemo() {
  const { data: u } = await sb.from('users').select('id, firm_id').eq('email', DEMO_EMAIL).maybeSingle();
  if (!u?.firm_id) return null;
  const { data: firm } = await sb.from('firms').select('id, name').eq('id', u.firm_id).maybeSingle();
  return { userId: u.id, firmId: u.firm_id, firmName: firm?.name ?? null };
}

// ── Reset — only ever deletes the demo firm, with a name assertion ──────────────
async function reset() {
  const demo = await resolveDemo();
  if (!demo) { console.log('• No existing demo firm — nothing to reset.'); return; }

  // HARD SAFETY GATE: never delete anything unless the resolved firm is exactly
  // the demo firm by name. This is what makes it impossible to hit MM&Co.
  if (demo.firmName !== DEMO_FIRM_NAME) {
    console.error(`✋ ABORT: ${DEMO_EMAIL} resolves to firm "${demo.firmName}", not "${DEMO_FIRM_NAME}". Refusing to delete.`);
    process.exit(1);
  }

  console.log(`• Resetting demo firm "${demo.firmName}" (${demo.firmId})…`);

  // Capture all auth users + clients of this firm BEFORE deleting the firm row.
  const { data: users } = await sb.from('users').select('id').eq('firm_id', demo.firmId);
  const { data: clients } = await sb.from('clients').select('id').eq('firm_id', demo.firmId);
  const clientIds = (clients ?? []).map(c => c.id);

  if (clientIds.length) {
    await sb.from('outputs').delete().in('client_id', clientIds);
    await sb.from('documents').delete().in('client_id', clientIds);
  }
  await sb.from('outputs').delete().eq('firm_id', demo.firmId);
  await sb.from('tasks').delete().eq('firm_id', demo.firmId);
  await sb.from('task_templates').delete().eq('firm_id', demo.firmId);
  await sb.from('clients').delete().eq('firm_id', demo.firmId);
  await sb.from('firms').delete().eq('id', demo.firmId);             // cascades the users rows
  for (const u of users ?? []) await sb.auth.admin.deleteUser(u.id).catch(() => {}); // the auth logins
  console.log('  ✓ Demo firm wiped.');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function makeUser(firmId, email, fullName, role) {
  const { data: created, error } = await sb.auth.admin.createUser({ email, password: DEMO_PASSWORD, email_confirm: true });
  if (error) { console.warn(`  ! user ${email}:`, error.message); return null; }
  await sb.from('users').update({ firm_id: firmId, role, full_name: fullName }).eq('id', created.user.id);
  return created.user.id;
}

// ── Seed ────────────────────────────────────────────────────────────────────
async function seed() {
  console.log(`• Creating demo firm "${DEMO_FIRM_NAME}"…`);
  const { data: firm, error: firmErr } = await sb.from('firms').insert({ name: DEMO_FIRM_NAME, subscription_tier: 'internal' }).select('id').single();
  if (firmErr) { console.error('firm insert', firmErr); process.exit(1); }
  const firmId = firm.id;

  // ── Team: the admin login + a few staff ──────────────────────────────────
  const adminId = await makeUser(firmId, DEMO_EMAIL, DEMO_FULL_NAME, 'admin');
  const team = [adminId];
  for (const [email, name] of [
    ['priya@smithyaccountants.co.uk', 'Priya Nair'],
    ['tom@smithyaccountants.co.uk',   'Tom Fielding'],
    ['grace@smithyaccountants.co.uk', 'Grace Okoro'],
    ['liam@smithyaccountants.co.uk',  'Liam Walsh'],
  ]) {
    const id = await makeUser(firmId, email, name, 'staff');
    if (id) team.push(id);
  }
  console.log(`  ✓ Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}  (+${team.length - 1} staff)`);

  // ── Clients: ~30 believable UK small-business clients across types ────────
  const TYPES = ['limited_company', 'sole_trader', 'partnership', 'llp'];
  const NAMES = [
    'Wood Road Fish Bar Ltd', 'Seagull Pizza Co', 'Marigold Florists', 'Penrose Plumbing Ltd',
    'The Copper Kettle Café', 'Brightwell Joinery', 'Harbourside Lettings LLP', 'Quince & Co Bakery',
    'Northgate Motors Ltd', 'Willow Lane Dental', 'Aspen Digital Ltd', 'Greenfield Landscapes',
    'Tobias Hart Photography', 'Saffron Indian Kitchen Ltd', 'Bramble Cottage B&B', 'Vesper Salon Ltd',
    'Oakwood Joiners LLP', 'Riverside Physio', 'Lumen Electrical Ltd', 'The Daily Grind Coffee',
    'Hattie Rose Interiors', 'Meridian Consulting Ltd', 'Crestwave Surf School', 'Pemberton Legal LLP',
    'Clearview Window Co', 'Fenwick Farm Shop', 'Bluebird Childcare Ltd', 'Atlas Removals',
    'Sterling Build Ltd', 'Mockingbird Books',
  ];
  const clientRows = NAMES.map((name, i) => {
    const slug = name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
    return {
      firm_id: firmId, name,
      client_ref: `${slug}${100 + i}`,
      business_type: pick(TYPES, i),
      contact_email: `${name.replace(/[^A-Za-z]/g, '').toLowerCase().slice(0, 14)}@example.co.uk`,
      contact_number: `01${String(200000000 + i * 137).slice(0, 9)}`,
      risk_rating: pick(['Low', 'Low', 'Medium', 'Low', 'High'], i),
      address: `${10 + i} ${pick(['High St', 'Mill Lane', 'Station Rd', 'Church St', 'Market Sq'], i)}, ${pick(['Bristol', 'Leeds', 'Derby', 'Coventry', 'Bath'], i)}`,
    };
  });
  const { data: clients, error: clientErr } = await sb.from('clients').insert(clientRows).select('id, name');
  if (clientErr) { console.error('clients insert', clientErr); process.exit(1); }
  console.log(`  ✓ ${clients.length} clients.`);

  // ── Tasks: ~14 across statuses, assigned to the team, linked to clients ───
  try {
    const TASK_TITLES = [
      'VAT return — Q1', 'Year-end accounts', 'Confirmation statement', 'Monthly payroll',
      'Self-assessment return', 'New client onboarding', 'Management accounts', 'CT600 filing',
      'Bookkeeping catch-up', 'P11D preparation', 'Quarterly review meeting', 'Companies House update',
      'Dividend planning', 'VAT registration',
    ];
    const STATUSES = ['not_started', 'in_progress', 'in_progress', 'review', 'waiting_on_client', 'complete'];
    const today = new Date();
    const taskRows = TASK_TITLES.map((title, i) => {
      const due = new Date(today); due.setDate(due.getDate() + (i % 5) * 7 - 7);
      return {
        firm_id: firmId,
        client_id: pick(clients, i * 3).id,
        created_by: pick(team, i),
        title,
        status: pick(STATUSES, i),
        due_date: due.toISOString().slice(0, 10),
      };
    });
    const { data: tasks, error: taskErr } = await sb.from('tasks').insert(taskRows).select('id');
    if (taskErr) throw taskErr;
    // One step per task so the workflow view isn't empty.
    const stepRows = (tasks ?? []).map((t, i) => ({
      task_id: t.id, step_key: 'step1', title: pick(['Gather records', 'Prepare draft', 'Review', 'File'], i),
      assignee_id: pick(team, i + 1), is_client_step: i % 4 === 0,
      status: i % 3 === 0 ? 'complete' : 'not_started',
    }));
    if (stepRows.length) await sb.from('task_steps').insert(stepRows);
    console.log(`  ✓ ${tasks.length} tasks.`);
  } catch (e) { console.warn('  ! tasks skipped:', e.message); }

  // ── AI outputs: populate the History screens for the flagship tools ───────
  try {
    const out = [];
    const txn = (n) => Array.from({ length: n }, (_, k) => ({
      fileName: `invoice_${k + 1}.pdf`, date: `2026-0${(k % 9) + 1}-1${k % 9}`,
      details: pick(['Office supplies', 'Fuel', 'Subscriptions', 'Materials', 'Insurance'], k),
      total: (50 + k * 37.5).toFixed(2), vat: (10 + k * 7.5).toFixed(2),
    }));
    const addOut = (i, feature, target, result, count) => out.push({
      firm_id: firmId, client_id: pick(clients, i).id, client_name: pick(clients, i).name,
      user_id: pick(team, i), feature, target_software: target, transaction_count: count,
      source_filenames: ['records.pdf'], result_data: result,
    });
    // Capture (full_analysis)
    for (let i = 0; i < 4; i++) addOut(i * 2, 'full_analysis', pick(['xero', 'vt', 'capium'], i), { transactions: txn(8 + i), flaggedEntries: [] }, 8 + i);
    // Bank to CSV
    for (let i = 0; i < 3; i++) addOut(i * 5 + 1, 'bank_to_csv', null, { rows: txn(12) }, 12);
    // Accounts Review
    for (let i = 0; i < 3; i++) addOut(i * 7 + 2, 'final_accounts_review', pick(['sole_trader', 'limited_company'], i), {
      businessName: pick(clients, i * 7 + 2).name,
      reviewPoints: [
        { area: 'Balance Sheet', subArea: 'Director Loan Account', issue: 'Overdrawn DLA', severity: 'Serious', explanation: 'The director loan account is overdrawn by £12,400 at the year end.', risk: 'Potential s455 tax charge.' },
        { area: 'P&L', subArea: 'Depreciation', issue: 'No depreciation charged', severity: 'Medium', explanation: 'Fixed assets are held but no depreciation has been charged this year.' },
      ],
      workingPapers: [],
    }, 2);
    // Performance
    for (let i = 0; i < 2; i++) addOut(i * 11 + 3, 'performance_analysis', null, {
      reportHtml: `<h1>Performance review — ${pick(clients, i * 11 + 3).name}</h1><p>Revenue grew 14% year on year with gross margin improving to 41%.</p>`,
      chartDataJson: JSON.stringify([{ label: 'Gross margin %', company: 41, benchmark: 36 }, { label: 'Net margin %', company: 12, benchmark: 9 }]),
    }, null);
    const { error: outErr } = await sb.from('outputs').insert(out);
    if (outErr) throw outErr;
    console.log(`  ✓ ${out.length} AI outputs (Capture, Bank to CSV, Accounts Review, Performance).`);
  } catch (e) { console.warn('  ! AI outputs skipped:', e.message); }

  console.log('\n✅ Demo seeded. Next increments: CH Secretarial, HR, calendar/meeting notes, and the email-triage send script.');
}

// ── Run ───────────────────────────────────────────────────────────────────────
(async () => {
  await reset();
  if (!resetOnly) await seed();
})();
