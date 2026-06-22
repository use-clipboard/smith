// ─── Demo clients enrichment + bulk + team avatars (additive) ─────────────────
// • Fills random tax details (VAT/UTR/NINO/DOB/CH no./year-end/PAYE/address) on
//   EVERY client of the demo firm.
// • Adds ~100 more clients across types, including individuals (personal tax).
// • Gives every team member a profile photo.
// Does NOT wipe the firm. Re-runnable: bulk clients use 'DM####' refs and are
// cleared+rebuilt; the original named clients keep their email alignment.
//
//   node scripts/seed-demo-clients.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const DEMO_EMAIL = 'smith@smithyaccountants.co.uk';
const DEMO_FIRM_NAME = 'Smithy Accountants';
const BULK = 100;

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: admin } = await sb.from('users').select('id, firm_id').eq('email', DEMO_EMAIL).maybeSingle();
if (!admin?.firm_id) { console.error(`✋ No demo user ${DEMO_EMAIL}. Run seed-demo.mjs first.`); process.exit(1); }
const { data: firm } = await sb.from('firms').select('name').eq('id', admin.firm_id).maybeSingle();
if (firm?.name !== DEMO_FIRM_NAME) { console.error(`✋ ABORT: firm is "${firm?.name}", not "${DEMO_FIRM_NAME}".`); process.exit(1); }
const firmId = admin.firm_id;
const { data: staff } = await sb.from('users').select('id, email, full_name').eq('firm_id', firmId);
const managers = (staff ?? []).map(s => s.id);

// ── Random generators ─────────────────────────────────────────────────────────
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const pad = n => String(n).padStart(2, '0');
const digits = n => Array.from({ length: n }, () => rnd(10)).join('');
const FIRST = ['James','Sarah','Mohammed','Emma','David','Olivia','Daniel','Aisha','Jack','Sophie','Ryan','Chloe','Harry','Amelia','George','Lily','Oscar','Ella','Charlie','Mia','Noah','Isla','Leo','Freya','Adam','Ruby','Nathan','Maya','Sean','Hannah','Luke','Zara','Ben','Eve','Owen','Nadia'];
const LAST = ['Smith','Jones','Patel','Williams','Brown','Taylor','Davies','Khan','Walsh','Hughes','Murphy','Clarke','Robinson','Wright','Green','Baker','Adams','Mitchell','Cooper','Ward','Foster','Bennett','Reed','Sharma','Begum','Ali','Evans','Carter','Morgan','Hall','Cole','Shah','Lewis','Price','Wood','Holmes'];
const ADJ = ['Northgate','Riverside','Oakwood','Clearview','Bluebird','Sterling','Crystal','Meridian','Summit','Willow','Maple','Crimson','Apex','Harbour','Pinnacle','Vantage','Granite','Beacon','Cedar','Hazel','Kingsway','Westfield','Brookside','Ashford'];
const NOUN = ['Consulting','Construction','Joinery','Catering','Logistics','Design','Electrical','Property','Care','Retail','Trading','Media','Engineering','Solutions','Holdings','Services','Interiors','Roofing','Plumbing','Lettings','Fitness','Automotive','Hospitality','Recruitment'];
const STREETS = ['High St','Mill Lane','Station Rd','Church St','Market Sq','Victoria Rd','King St','Queens Rd','Park Ave','Bridge St','Castle St','New Rd','School Lane','The Green','Albert Rd'];
const TOWNS = [['Bristol','BS'],['Leeds','LS'],['Derby','DE'],['Coventry','CV'],['Bath','BA'],['Leicester','LE'],['Nottingham','NG'],['Sheffield','S'],['Manchester','M'],['Cardiff','CF'],['York','YO'],['Exeter','EX']];
const YEAR_ENDS = ['03-31','12-31','09-30','06-30','04-30','05-31'];

const nino = () => `${pick('ABCEGHJ')}${pick('ABCEGHJ')}${digits(6)}${pick('ABCD')}`;
const dob = () => `19${55 + rnd(40)}-${pad(rnd(12) + 1)}-${pad(rnd(28) + 1)}`;
const address = () => { const [t, p] = pick(TOWNS); return `${rnd(120) + 1} ${pick(STREETS)}, ${t}, ${p}${rnd(20) + 1} ${rnd(9)}${pick('ABDEFGH')}${pick('ABDEFGH')}`; };
const phone = () => Math.random() < 0.5 ? `07${digits(9)}` : `01${digits(9)}`;

// Type-appropriate tax fields.
function taxFields(type) {
  const indiv = type === 'individual' || type === 'sole_trader';
  const co = type === 'limited_company' || type === 'llp';
  const vatReg = Math.random() < 0.55;
  return {
    vat_number: vatReg ? `GB${digits(9)}` : null,
    utr_number: (indiv || type === 'partnership') ? digits(10) : null,
    national_insurance_number: indiv ? nino() : null,
    date_of_birth: indiv ? dob() : null,
    companies_house_id: co ? digits(8) : null,
    year_end: co ? `2026-${pick(YEAR_ENDS)}` : null,
    paye_reference: (co && Math.random() < 0.5) ? `${digits(3)}/${pick(['AB', 'XY', 'ZZ'])}${digits(5)}` : null,
    account_manager_id: managers.length ? pick(managers) : null,
  };
}

// ── 1. Enrich existing clients (don't touch name / contact_email / address) ────
const { data: existing } = await sb.from('clients').select('id, business_type, address').eq('firm_id', firmId).not('client_ref', 'like', 'DM%');
for (const c of existing ?? []) {
  const t = c.business_type || 'limited_company';
  await sb.from('clients').update({ ...taxFields(t), ...(c.address ? {} : { address: address() }) }).eq('id', c.id);
}
console.log(`  ✓ Enriched ${existing?.length ?? 0} existing clients.`);

// ── 2. Bulk clients (incl. individuals) ────────────────────────────────────────
await sb.from('clients').delete().eq('firm_id', firmId).like('client_ref', 'DM%');
function buildClient(i) {
  const r = Math.random();
  let type, name;
  if (r < 0.35) { type = 'individual'; name = `${pick(FIRST)} ${pick(LAST)}`; }
  else if (r < 0.60) { type = 'sole_trader'; name = Math.random() < 0.5 ? `${pick(FIRST)} ${pick(LAST)}` : `${pick(LAST)} ${pick(NOUN)}`; }
  else if (r < 0.85) { type = 'limited_company'; name = `${pick(ADJ)} ${pick(NOUN)} Ltd`; }
  else if (r < 0.93) { type = 'partnership'; name = `${pick(LAST)} & ${pick(LAST)}`; }
  else { type = 'llp'; name = `${pick(ADJ)} ${pick(NOUN)} LLP`; }
  const indiv = type === 'individual' || type === 'sole_trader';
  const slug = name.toLowerCase().replace(/[^a-z]+/g, indiv ? '.' : '').replace(/^\.|\.$/g, '');
  return {
    firm_id: firmId, name,
    client_ref: `DM${1000 + i}`,
    business_type: type,
    contact_email: indiv ? `${slug}@${pick(['gmail.com', 'outlook.com', 'icloud.com', 'btinternet.com'])}` : `info@${slug}.co.uk`,
    contact_number: phone(),
    address: address(),
    risk_rating: pick(['Low', 'Low', 'Low', 'Medium', 'Medium', 'High']),
    status: Math.random() < 0.9 ? 'active' : 'hold',
    ...taxFields(type),
  };
}
const bulk = Array.from({ length: BULK }, (_, i) => buildClient(i));
for (let i = 0; i < bulk.length; i += 50) {
  const { error } = await sb.from('clients').insert(bulk.slice(i, i + 50));
  if (error) { console.error('clients insert', error.message); break; }
}
console.log(`  ✓ Added ${bulk.length} bulk clients (individuals, sole traders, companies, partnerships, LLPs).`);

// ── 3. Team profile photos — clean, office-professional headshots ──────────────
const AVATARS = {
  'smith@smithyaccountants.co.uk': 'https://randomuser.me/api/portraits/men/32.jpg',
  'priya@smithyaccountants.co.uk': 'https://randomuser.me/api/portraits/women/44.jpg',
  'tom@smithyaccountants.co.uk':   'https://randomuser.me/api/portraits/men/45.jpg',
  'grace@smithyaccountants.co.uk': 'https://randomuser.me/api/portraits/women/68.jpg',
  'liam@smithyaccountants.co.uk':  'https://randomuser.me/api/portraits/men/51.jpg',
};
for (const u of staff ?? []) {
  const url = AVATARS[u.email] ?? `https://randomuser.me/api/portraits/${rnd(2) ? 'men' : 'women'}/${rnd(90)}.jpg`;
  await sb.from('users').update({ avatar_url: url }).eq('id', u.id);
}
console.log(`  ✓ Profile photos for ${staff?.length ?? 0} team members.`);

console.log('\n✅ Clients enriched + bulk added + team photos set.');
