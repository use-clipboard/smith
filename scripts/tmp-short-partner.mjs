import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const mode = process.argv[2] || 'add';

const r = await fetch(`${URL}/rest/v1/tax_studio_returns?select=id,data&limit=200`, { headers: H });
const rows = await r.json();
const hit = rows.find(x => JSON.stringify(x.data?.clientName || '').toLowerCase().includes('adam cole'));
if (!hit) { console.log('no Adam Cole return; names:', rows.map(x => x.data?.clientName)); process.exit(1); }
const data = hit.data;
data.income = data.income || {};
const list = (data.income.partnerships || []).filter(p => p.__demoShort !== true);

if (mode === 'add') {
  list.push({
    id: 'demo-short-1', form: 'short', __demoShort: true,
    name: 'Riverside Dental Associates', description: 'Dental practice',
    utr: '1234567890',
    becamePartner: false, ceasedPartner: false,
    profit: 18400, adjustmentPeriod: -600, accountingAdjustment: 0,
    averagingAdjustment: 0, foreignTaxDeduction: 0,
    lossBroughtForward: 0, otherBusinessIncome: 250,
    class2Voluntary: false, class4Exempt: false, class4Adjustment: 0,
    ukSavings: 120, cisDeductions: 0, taxTakenTradingIncome: 0,
    otherInformation: 'Profit share per the partnership statement; accounting date 31 December 2025 apportioned to the tax year.',
  });
  console.log('adding short partnership; total partnerships now', list.length);
} else {
  console.log('removing demo short partnership; remaining', list.length);
}
data.income.partnerships = list;

const up = await fetch(`${URL}/rest/v1/tax_studio_returns?id=eq.${hit.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ data }) });
console.log('patch', up.status, up.ok ? 'OK' : await up.text());
console.log('return id', hit.id);
