// ─── Demo inbox seed (Gmail insert) ───────────────────────────────────────────
// Inserts realistic fake "client" emails straight into the demo user's connected
// Gmail inbox via gmail.users.messages.insert. Inserted (not sent), so the From
// can be any believable client address — no domain verification, no Resend.
// Messages arrive UNREAD in the Inbox so Email Triage shows them as genuine.
//
//   node scripts/seed-demo-emails.mjs          → reset demo emails, then insert
//   node scripts/seed-demo-emails.mjs --reset  → trash the demo emails only
//
// `match: true` emails come from an address we set as that client's contact_email,
// so SMITH's auto-allocation (and create-task-from-email) recognise the client.
// `match: false` emails stay unallocated, to show that path too.

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const DEMO_EMAIL = 'smith@smithyaccountants.co.uk';
const MARKER = 'smithy-demo-seed-9f3a';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resetOnly = process.argv.includes('--reset');

const { data: user } = await sb.from('users').select('id, firm_id').eq('email', DEMO_EMAIL).maybeSingle();
if (!user) { console.error(`✋ No demo user ${DEMO_EMAIL}. Run seed-demo.mjs first.`); process.exit(1); }
const { data: conn } = await sb.from('email_connections').select('refresh_token, google_email').eq('user_id', user.id).maybeSingle();
if (!conn?.refresh_token || !conn?.google_email) { console.error('✋ Demo user has no connected inbox. Connect Email Triage for the demo user first.'); process.exit(1); }
const TO = conn.google_email;

const oauth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: conn.refresh_token });
const gmail = google.gmail({ version: 'v1', auth: oauth });

const b64url = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// RFC 2047 encoded-word for any header value containing non-ASCII (fixes em-dash mojibake).
const encHeader = s => /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : null;

async function reset() {
  const { data } = await gmail.users.messages.list({ userId: 'me', q: `"${MARKER}"`, maxResults: 100 });
  for (const m of data.messages ?? []) await gmail.users.messages.trash({ userId: 'me', id: m.id }).catch(() => {});
  console.log(`• Trashed ${(data.messages ?? []).length} demo emails.`);
}

// client = the seeded client name; match=true sets that client's contact_email to
// `from` so auto-allocation recognises it. task=true = an obviously actionable one.
const EMAILS = [
  { name: 'Carol, Seagull Pizza Co', from: 'carol@seagullpizza.co.uk', client: 'Seagull Pizza Co', match: true, subject: 'Quick VAT question', body: 'Hi, can we claim the VAT back on the new pizza oven we bought last month? It was about £4,200 + VAT. Thanks, Carol' },
  { name: 'Dave Wood', from: 'accounts@woodroadfishbar.co.uk', client: 'Wood Road Fish Bar Ltd', match: true, task: true, subject: 'Year-end records attached', body: 'Morning — here are our bank statements and purchase invoices for the year end. Please prepare our accounts when you can. Cheers, Dave' },
  { name: 'Priya, Aspen Digital', from: 'priya@aspendigital.io', client: 'Aspen Digital Ltd', match: true, subject: 'New company — where do I start?', body: 'Hi, we just incorporated Aspen Digital. Could you give us a call to talk through bookkeeping and VAT? Thanks' },
  { name: 'Tobias Hart', from: 'tobias@tobiashartphoto.co.uk', client: 'Tobias Hart Photography', match: true, subject: 'Self Assessment — am I registered?', body: 'Hi, can you confirm I am registered for self assessment and let me know what you need from me for this year? Thanks' },
  { name: 'Marigold Florists', from: 'hello@marigoldflorists.co.uk', client: 'Marigold Florists', match: true, subject: 'Invoice query', body: 'Hi, a supplier is chasing an invoice we think we already paid. Can you check the bank for a payment to "Petal Wholesale" around the 14th? Thanks' },
  { name: 'Sam, Northgate Motors', from: 'sam@northgatemotors.co.uk', client: 'Northgate Motors Ltd', match: true, subject: 'Draft accounts — questions', body: 'Thanks for the draft accounts. The directors loan looks high — can we discuss? And when is the filing deadline? Regards, Sam' },
  { name: 'Mark Penrose', from: 'mark@penroseplumbing.co.uk', client: 'Penrose Plumbing Ltd', match: true, subject: 'Mileage + van expenses', body: 'Hi, do I claim the van on mileage or actual costs? I do about 18,000 business miles a year.' },
  { name: 'Vesper Salon', from: 'reception@vespersalon.co.uk', client: 'Vesper Salon Ltd', match: true, task: true, subject: 'New starter — add to payroll', body: 'Hi, we have a new stylist starting Monday, 30 hours a week at £12.50/hr. Please add her to payroll — I have her details ready.' },
  { name: 'James, Meridian', from: 'james@meridianconsulting.co.uk', client: 'Meridian Consulting Ltd', match: true, subject: 'Dividend planning', body: 'Hi, we have had a good year. Could we chat about the most tax-efficient way to take money out — salary vs dividends? Thanks, James' },
  { name: 'The Copper Kettle Café', from: 'owner@copperkettlecafe.co.uk', client: 'The Copper Kettle Café', match: true, task: true, subject: 'Late filing penalty?', body: 'Hi, I got a £100 penalty notice from Companies House. Can you look into what happened and sort it please?' },
  // Unmatched senders — show the unallocated path.
  { name: 'Pemberton Legal LLP', from: 'newaccounts@pembertonlegal-group.com', client: null, match: false, subject: 'Partnership accounts', body: 'Morning, could you confirm the profit split figures for the partners this year before we sign off? Thanks' },
  { name: 'Sue', from: 'sue.harris88@gmail.com', client: null, match: false, task: true, subject: 'Change of address', body: 'Hi, our business address has changed to 14 Mill Lane, Bath. Please update HMRC and Companies House. Thanks, Sue (Bramble Cottage)' },
  { name: 'Gary', from: 'gary.lumen@outlook.com', client: null, match: false, subject: 'CIS — subcontractors', body: 'Hi, we have started using two subcontractors. Do we need to register for CIS and what do we deduct? Bit confused on this one.' },
  { name: 'Quince & Co Bakery', from: 'orders@quincebakery.co.uk', client: 'Quince & Co Bakery', match: true, subject: 'Bank statements — March', body: 'Hi, attaching March statements. We switched banks mid-month so there are two accounts this time. Let me know if that is a problem!' },
  { name: 'Tom, Atlas Removals', from: 'tom@atlasremovals.co.uk', client: 'Atlas Removals', match: true, subject: 'Thanks!', body: 'Just wanted to say thanks for sorting the accounts so quickly this year — really appreciate it. Same time next year!' },
];

async function seed() {
  // Load demo clients to align contact_email for the matched senders.
  const { data: clients } = await sb.from('clients').select('id, name').eq('firm_id', user.firm_id);
  const byName = new Map((clients ?? []).map(c => [c.name, c.id]));

  let n = 0, matched = 0;
  for (const e of EMAILS) {
    if (e.match && e.client && byName.has(e.client)) {
      await sb.from('clients').update({ contact_email: e.from }).eq('id', byName.get(e.client));
      matched++;
    }
    const d = new Date(Date.now() - (EMAILS.length - n) * 7 * 3600 * 1000);
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">${e.body}`
      + `<div style="display:none;color:transparent;font-size:1px">${MARKER}</div></div>`;
    const fromName = encHeader(e.name) ?? `"${e.name}"`;
    const subj = encHeader(e.subject) ?? e.subject;
    const raw = [
      `From: ${fromName} <${e.from}>`,
      `To: ${TO}`,
      `Subject: ${subj}`,
      `Date: ${d.toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
    ].join('\r\n');
    await gmail.users.messages.insert({
      userId: 'me',
      internalDateSource: 'dateHeader',
      requestBody: { raw: b64url(raw), labelIds: ['INBOX', 'UNREAD'] },
    });
    n++;
  }
  console.log(`  ✓ Inserted ${n} emails (${matched} aligned to client contact emails for auto-allocation).`);
}

await reset();
if (!resetOnly) { await seed(); console.log('\n✅ Demo inbox seeded. Open Email Triage and refresh.'); }
