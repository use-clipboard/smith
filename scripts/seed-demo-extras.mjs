// ─── Demo extras (additive) ───────────────────────────────────────────────────
// Adds bell notifications, pending holiday requests, and upcoming Companies House
// deadlines to the EXISTING demo firm — without wiping the clients/tasks/calendar/
// emails you've already seeded. Re-runnable (clears its own items first).
//
//   node scripts/seed-demo-extras.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const DEMO_EMAIL = 'smith@smithyaccountants.co.uk';
const DEMO_FIRM_NAME = 'Smithy Accountants';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Resolve demo firm + people (with a name gate, same safety as the main seed).
const { data: admin } = await sb.from('users').select('id, firm_id, full_name').eq('email', DEMO_EMAIL).maybeSingle();
if (!admin?.firm_id) { console.error(`✋ No demo user ${DEMO_EMAIL}. Run seed-demo.mjs first.`); process.exit(1); }
const { data: firm } = await sb.from('firms').select('name').eq('id', admin.firm_id).maybeSingle();
if (firm?.name !== DEMO_FIRM_NAME) { console.error(`✋ ABORT: firm is "${firm?.name}", not "${DEMO_FIRM_NAME}".`); process.exit(1); }
const firmId = admin.firm_id;
const { data: staff } = await sb.from('users').select('id, full_name').eq('firm_id', firmId).neq('id', admin.id);

const iso = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const pickStaff = i => (staff?.length ? staff[i % staff.length] : { id: admin.id, full_name: 'Team' });

// ── Notifications (for the admin's bell) ──────────────────────────────────────
try {
  await sb.from('notifications').delete().eq('firm_id', firmId);
  const n = (type, title, body, link, read = false) => ({ user_id: admin.id, firm_id: firmId, type, title, body, read, data: { task_link: link } });
  const rows = [
    n('hr_holiday_requested', 'Holiday request: Priya Nair', '13/07/2026 → 17/07/2026 (5 days).', '/hr?tab=approvals'),
    n('mtd_it_changes_requested', 'Northgate Motors Ltd has requested changes', 'Please review the directors loan figure before re-sending.', '/mtd-it'),
    n('client_step_complete', 'Client completed: Send year-end records', 'Wood Road Fish Bar Ltd', '/tasks'),
    n('hr_holiday_requested', 'Holiday request: Tom Fielding', '04/08/2026 (1 day).', '/hr?tab=approvals'),
    n('mtd_it_approved', 'Seagull Pizza Co has approved MTD IT', 'Approved Q1 2026/27 — ready to file.', '/mtd-it'),
    n('general', 'New HR briefing published', 'Q3 capacity & holiday planning is ready to read.', '/hr', true),
  ];
  await sb.from('notifications').insert(rows);
  console.log(`  ✓ ${rows.length} notifications.`);
} catch (e) { console.warn('  ! notifications:', e.message); }

// ── Pending holiday requests (for the admin to approve) ───────────────────────
try {
  await sb.from('hr_holiday_requests').delete().eq('firm_id', firmId);
  const hol = (i, start, end, total, reason) => ({
    firm_id: firmId, user_id: pickStaff(i).id, manager_id: admin.id,
    start_date: start, end_date: end, total_days: total, status: 'pending', source: 'request', reason,
  });
  const rows = [
    hol(0, iso(18), iso(22), 5, 'Family holiday'),
    hol(1, iso(31), iso(31), 1, 'Appointment'),
    hol(2, iso(40), iso(46), 5, 'Half term'),
    hol(3, iso(12), iso(13), 2, null),
  ];
  await sb.from('hr_holiday_requests').insert(rows);
  console.log(`  ✓ ${rows.length} pending holiday requests.`);
} catch (e) { console.warn('  ! holidays:', e.message); }

// ── Companies House deadlines (ch_cache snapshot) ─────────────────────────────
try {
  const companies = [
    { companyNumber: '09112233', companyName: 'Northgate Motors Ltd',       accountsNextDue: iso(9),   csNextDue: iso(74),  nearestOfficerIdvDue: iso(25), nearestPscIdvDue: null },
    { companyNumber: '08233445', companyName: 'Aspen Digital Ltd',          accountsNextDue: iso(52),  csNextDue: iso(14),  nearestOfficerIdvDue: null,    nearestPscIdvDue: iso(40) },
    { companyNumber: '10455667', companyName: 'Wood Road Fish Bar Ltd',     accountsNextDue: iso(21),  csNextDue: iso(61),  nearestOfficerIdvDue: null,    nearestPscIdvDue: null },
    { companyNumber: '07566778', companyName: 'Vesper Salon Ltd',           accountsNextDue: iso(-5),  csNextDue: iso(33),  nearestOfficerIdvDue: null,    nearestPscIdvDue: null },
    { companyNumber: '11677889', companyName: 'Saffron Indian Kitchen Ltd', accountsNextDue: iso(45),  csNextDue: iso(88),  nearestOfficerIdvDue: iso(70), nearestPscIdvDue: null },
    { companyNumber: '09788990', companyName: 'Lumen Electrical Ltd',       accountsNextDue: iso(80),  csNextDue: iso(29),  nearestOfficerIdvDue: null,    nearestPscIdvDue: null },
    { companyNumber: '12899001', companyName: 'Sterling Build Ltd',         accountsNextDue: iso(70),  csNextDue: iso(150), nearestOfficerIdvDue: null,    nearestPscIdvDue: iso(18) },
  ];
  await sb.from('ch_cache').upsert({
    firm_id: firmId, companies, refreshed_at: new Date().toISOString(),
    refresh_status: 'success', companies_fetched: companies.length, companies_total: companies.length,
  });
  console.log(`  ✓ ${companies.length} Companies House deadlines.`);
} catch (e) { console.warn('  ! CH deadlines:', e.message); }

console.log('\n✅ Demo extras added.');
