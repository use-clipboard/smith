// ─── Demo calendar seed ───────────────────────────────────────────────────────
// Populates the connected demo Google Calendar with fake events + SMITH personal
// reminders. Run AFTER the demo firm exists (seed-demo.mjs) and AFTER the demo
// user has connected their Google Calendar in Settings.
//
//   node scripts/seed-demo-calendar.mjs           → reset demo items, then seed
//   node scripts/seed-demo-calendar.mjs --reset   → remove demo items only
//
// Google events are tagged with a private extended property (demoSeed=smithy) so
// the reset only ever deletes events this script created — never your real ones.

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const DEMO_EMAIL = 'smith@smithyaccountants.co.uk';
const TAG = 'smithy';

// ── Env ──────────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resetOnly = process.argv.includes('--reset');

// ── Resolve demo user + calendar client ────────────────────────────────────────
const { data: user } = await sb.from('users').select('id, firm_id').eq('email', DEMO_EMAIL).maybeSingle();
if (!user?.firm_id) { console.error(`✋ No demo user ${DEMO_EMAIL}. Run seed-demo.mjs first.`); process.exit(1); }

const { data: tok } = await sb.from('calendar_tokens').select('google_refresh_token').eq('user_id', user.id).maybeSingle();
if (!tok?.google_refresh_token) { console.error('✋ Demo user has not connected Google Calendar. Connect it in Settings, then re-run.'); process.exit(1); }

const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: tok.google_refresh_token });
const calendar = google.calendar({ version: 'v3', auth: oauth });

// ── Reset (delete only our tagged events + the demo user's personal reminders) ──
async function reset() {
  const { data } = await calendar.events.list({ calendarId: 'primary', privateExtendedProperty: `demoSeed=${TAG}`, maxResults: 250, singleEvents: true });
  for (const e of data.items ?? []) await calendar.events.delete({ calendarId: 'primary', eventId: e.id }).catch(() => {});
  await sb.from('calendar_personal_reminders').delete().eq('user_id', user.id);
  console.log(`• Cleared ${(data.items ?? []).length} demo events + personal reminders.`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
// A weekday `daysFromNow` ahead, at `hour`:`min` London time, lasting `mins`.
function slot(daysFromNow, hour, min, mins) {
  const d = new Date(); d.setDate(d.getDate() + daysFromNow); d.setHours(hour, min, 0, 0);
  const start = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(min)}:00`;
  const e = new Date(d.getTime() + mins * 60000);
  const end = `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}T${pad(e.getHours())}:${pad(e.getMinutes())}:00`;
  return { start, end };
}

async function seed() {
  const EVENTS = [
    { d: 1,  h: 10, m: 0,  mins: 45, sum: 'Catch-up — Wood Road Fish Bar Ltd', desc: 'Quarterly bookkeeping review', rem: 30 },
    { d: 1,  h: 14, m: 30, mins: 30, sum: 'Call — Marigold Florists', desc: 'VAT registration questions' },
    { d: 2,  h: 9,  m: 0,  mins: 30, sum: 'Team standup', desc: 'Weekly planning', rem: 10 },
    { d: 2,  h: 11, m: 0,  mins: 60, sum: 'Year-end review — Northgate Motors Ltd', desc: 'Draft accounts walkthrough', rem: 60 },
    { d: 3,  h: 15, m: 0,  mins: 45, sum: 'Onboarding — Aspen Digital Ltd', desc: 'New client kickoff' },
    { d: 4,  h: 12, m: 0,  mins: 30, sum: 'Lunch & learn — MTD for IT', desc: 'Internal training' },
    { d: 7,  h: 10, m: 0,  mins: 60, sum: 'Board pack prep — Meridian Consulting Ltd', desc: 'Management accounts', rem: 30 },
    { d: 8,  h: 13, m: 0,  mins: 30, sum: 'VAT return due — Seagull Pizza Co', desc: 'Submit Q1 return', rem: 1440 },
    { d: 9,  h: 9,  m: 30, mins: 45, sum: 'Review meeting — Pemberton Legal LLP', desc: 'Partnership accounts' },
    { d: 10, h: 16, m: 0,  mins: 30, sum: 'Payroll cut-off', desc: 'Monthly payroll deadline', rem: 120 },
    { d: 14, h: 11, m: 0,  mins: 60, sum: 'Practice planning', desc: 'Capacity + workflow review' },
    { d: -2, h: 10, m: 0,  mins: 45, sum: 'Catch-up — Willow Lane Dental', desc: 'Completed last week' },
  ];
  for (const ev of EVENTS) {
    const { start, end } = slot(ev.d, ev.h, ev.m, ev.mins);
    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: ev.sum,
        description: ev.desc,
        start: { dateTime: start, timeZone: 'Europe/London' },
        end:   { dateTime: end,   timeZone: 'Europe/London' },
        reminders: ev.rem ? { useDefault: false, overrides: [{ method: 'popup', minutes: ev.rem }] } : { useDefault: true },
        extendedProperties: { private: { demoSeed: TAG } },
      },
    });
  }
  console.log(`  ✓ ${EVENTS.length} calendar events.`);

  // SMITH personal reminders (bell items) — DB-backed, private to the demo user.
  const now = new Date();
  const at = (days, hour) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  const reminders = [
    { title: 'Chase Penrose Plumbing for records', remind_at: at(1, 9) },
    { title: 'Submit VAT — Seagull Pizza', remind_at: at(2, 12) },
    { title: 'Call HMRC re: UTR for Aspen Digital', remind_at: at(3, 10), notes: 'Hold time ~20 min' },
    { title: 'Prep board pack — Meridian', remind_at: at(6, 16) },
    { title: 'Confirm year-end date — Northgate Motors', remind_at: at(4, 11) },
  ].map(r => ({ ...r, user_id: user.id, firm_id: user.firm_id }));
  await sb.from('calendar_personal_reminders').insert(reminders);
  console.log(`  ✓ ${reminders.length} personal reminders.`);
}

// ── Run ───────────────────────────────────────────────────────────────────────
await reset();
if (!resetOnly) { await seed(); console.log('\n✅ Demo calendar seeded.'); }
