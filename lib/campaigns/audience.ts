// Server-side audience resolution.
//
// Given a firm and an audience (dynamic rule tree, or a static/manual client-id
// list), work out who's in it. Because the segmentable data lives across several
// tables — and Companies House data is a per-firm JSON cache, not client columns
// — we load each dataset once, fold it into a per-client attribute record, then
// evaluate the rule tree in JS. For a practice's client base (hundreds, low
// thousands) this is simple and correct; a future scale-up can push predicates
// into SQL.
//
// Every auxiliary load is wrapped so a missing table (pre-migration) or a read
// error degrades to "that field is unknown" rather than failing the whole
// resolve.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AudienceGroup, AudienceNode, AudienceSource, RuleOperator,
  ResolvedRecipient, AudiencePreview,
} from '@/types/campaigns';
import { isGroup } from '@/types/campaigns';
import { BUSINESS_TYPE_OPTIONS } from '@/lib/campaigns/fields';
import { buildMergeData, firstNameFrom, type CampaignMergeSource } from '@/lib/campaigns/mergeFields';
import { rowToRecipient, rowMergeData } from '@/lib/campaigns/spreadsheet';
import type { SpreadsheetAudienceData } from '@/types/campaigns';
import type { CHCompanyData } from '@/types/ch';

type Attr = string | number | boolean | null;

interface ClientRow {
  id: string;
  name: string | null;
  client_ref: string | null;
  business_type: string | null;
  contact_email: string | null;
  risk_rating: string | null;
  status: string | null;
  account_manager_id: string | null;
  year_end: string | null;
  vat_number: string | null;
  vat_scheme: string | null;
  mtd_it: boolean | null;
  companies_house_id: string | null;
  registration_number: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  key_contacts: any;
}

const BUSINESS_TYPE_LABEL: Record<string, string> =
  Object.fromEntries(BUSINESS_TYPE_OPTIONS.map(o => [o.value, o.label]));

function ukDate(d?: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${dt.getUTCFullYear()}`;
}

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const now = new Date();
  const ms = dt.getTime() - now.getTime();
  return Math.floor(ms / 86_400_000);
}

function normCompanyNo(s?: string | null): string {
  return (s ?? '').trim().toUpperCase();
}

// ── Per-firm dataset loads (all best-effort) ──────────────────────────────────
async function loadClients(supabase: SupabaseClient, firmId: string): Promise<ClientRow[]> {
  const SELECT = 'id, name, client_ref, business_type, contact_email, risk_rating, status, account_manager_id, year_end, vat_number, vat_scheme, mtd_it, companies_house_id, registration_number, key_contacts';
  const PAGE = 1000;
  const rows: ClientRow[] = [];
  let offset = 0;
  // Mirrors app/api/clients/route.ts paging (PostgREST caps at 1000).
  for (;;) {
    const { data, error } = await supabase
      .from('clients')
      .select(SELECT)
      .eq('firm_id', firmId)
      .order('name', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as unknown as ClientRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

async function loadCh(supabase: SupabaseClient, firmId: string): Promise<Map<string, CHCompanyData>> {
  const map = new Map<string, CHCompanyData>();
  try {
    const { data } = await supabase.from('ch_cache').select('companies').eq('firm_id', firmId).maybeSingle();
    const companies = (data?.companies as CHCompanyData[] | null) ?? [];
    for (const c of companies) map.set(normCompanyNo(c.companyNumber), c);
  } catch { /* no CH module / pre-migration */ }
  return map;
}

async function loadUsers(supabase: SupabaseClient, firmId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await supabase.from('users').select('id, full_name').eq('firm_id', firmId);
    for (const u of (data ?? [])) map.set(u.id as string, (u.full_name as string) ?? '');
  } catch { /* ignore */ }
  return map;
}

interface TaskFlags { open: boolean; overdue: boolean; recordsHere: boolean }
async function loadTasks(supabase: SupabaseClient, firmId: string): Promise<Map<string, TaskFlags>> {
  const map = new Map<string, TaskFlags>();
  try {
    const { data } = await supabase
      .from('tasks')
      .select('client_id, status, due_date')
      .eq('firm_id', firmId);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const t of (data ?? [])) {
      const cid = t.client_id as string | null;
      if (!cid) continue;
      const status = (t.status as string) ?? '';
      const open = status !== 'complete' && status !== 'cancelled';
      // 'records_here' is itself an open status, so an open check is sufficient.
      if (!open) continue;
      const cur = map.get(cid) ?? { open: false, overdue: false, recordsHere: false };
      if (open) cur.open = true;
      if (status === 'records_here') cur.recordsHere = true;
      if (open && t.due_date && new Date(t.due_date as string) < today) cur.overdue = true;
      map.set(cid, cur);
    }
  } catch { /* no tasks module */ }
  return map;
}

interface BillingFlags { outstandingPence: number; overdue: boolean }
async function loadBilling(supabase: SupabaseClient, firmId: string): Promise<{ inv: Map<string, BillingFlags>; dd: Set<string> }> {
  const inv = new Map<string, BillingFlags>();
  const dd = new Set<string>();
  try {
    const { data } = await supabase
      .from('invoices')
      .select('client_id, status, total_pence, amount_paid_pence, credit_pence, due_date')
      .eq('firm_id', firmId);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const i of (data ?? [])) {
      const cid = i.client_id as string | null;
      if (!cid) continue;
      const status = (i.status as string) ?? '';
      if (status === 'draft' || status === 'cancelled' || status === 'paid' || status === 'bad_debt') continue;
      const outstanding = Math.max(0,
        ((i.total_pence as number) ?? 0) - ((i.amount_paid_pence as number) ?? 0) - ((i.credit_pence as number) ?? 0));
      if (outstanding <= 0) continue;
      const cur = inv.get(cid) ?? { outstandingPence: 0, overdue: false };
      cur.outstandingPence += outstanding;
      if (i.due_date && new Date(i.due_date as string) < today) cur.overdue = true;
      inv.set(cid, cur);
    }
  } catch { /* no billing module */ }
  try {
    const { data } = await supabase.from('dd_mandates').select('client_id, status').eq('firm_id', firmId);
    for (const m of (data ?? [])) {
      if ((m.status as string) === 'active' && m.client_id) dd.add(m.client_id as string);
    }
  } catch { /* ignore */ }
  return { inv, dd };
}

async function loadMtdOutstanding(supabase: SupabaseClient, clientIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (clientIds.length === 0) return set;
  try {
    // Chunk the IN() list to stay well under PostgREST URL limits.
    for (let i = 0; i < clientIds.length; i += 300) {
      const chunk = clientIds.slice(i, i + 300);
      const { data } = await supabase
        .from('mtd_it_quarters')
        .select('client_id, status')
        .in('client_id', chunk);
      for (const q of (data ?? [])) {
        const status = (q.status as string) ?? '';
        if (status !== 'submitted' && status !== 'approved' && q.client_id) set.add(q.client_id as string);
      }
    }
  } catch { /* no MTD module */ }
  return set;
}

async function loadUnsubscribes(supabase: SupabaseClient, firmId: string): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const { data } = await supabase.from('campaign_unsubscribes').select('email').eq('firm_id', firmId);
    for (const u of (data ?? [])) set.add(((u.email as string) ?? '').trim().toLowerCase());
  } catch { /* pre-migration */ }
  return set;
}

// ── Attribute computation + evaluation ────────────────────────────────────────
interface Aux {
  ch: Map<string, CHCompanyData>;
  users: Map<string, string>;
  tasks: Map<string, TaskFlags>;
  billing: { inv: Map<string, BillingFlags>; dd: Set<string> };
  mtdOutstanding: Set<string>;
  unsub: Set<string>;
}

function chForClient(c: ClientRow, ch: Map<string, CHCompanyData>): CHCompanyData | undefined {
  return ch.get(normCompanyNo(c.companies_house_id)) ?? ch.get(normCompanyNo(c.registration_number));
}

function buildAttrs(c: ClientRow, aux: Aux): Record<string, Attr> {
  const ch = chForClient(c, aux.ch);
  const task = c.id ? aux.tasks.get(c.id) : undefined;
  const bill = c.id ? aux.billing.inv.get(c.id) : undefined;
  const email = (c.contact_email ?? '').trim().toLowerCase();
  return {
    client_status: c.status ?? null,
    business_type: c.business_type ?? null,
    risk_rating: c.risk_rating ?? null,
    account_manager_id: c.account_manager_id ?? null,
    client_name: c.name ?? null,
    client_ref: c.client_ref ?? null,
    year_end: c.year_end ?? null,
    has_email: !!email,
    vat_registered: !!(c.vat_number && c.vat_number.trim()),
    vat_scheme: c.vat_scheme ?? null,
    mtd_it: !!c.mtd_it,
    mtd_quarter_outstanding: aux.mtdOutstanding.has(c.id),
    ch_status: ch?.status ?? null,
    accounts_due_in_days: ch ? daysUntil(ch.accountsNextDue) : null,
    accounts_overdue: ch ? !!ch.accountsOverdue : null,
    cs_due_in_days: ch ? daysUntil(ch.csNextDue) : null,
    cs_overdue: ch ? !!ch.csOverdue : null,
    has_open_task: !!task?.open,
    has_overdue_task: !!task?.overdue,
    has_records_here_task: !!task?.recordsHere,
    has_overdue_invoice: !!bill?.overdue,
    outstanding_balance_pounds: bill ? bill.outstandingPence / 100 : 0,
    has_active_dd: c.id ? aux.billing.dd.has(c.id) : false,
    unsubscribed: aux.unsub.has(email),
  };
}

function evalRule(attr: Attr, op: RuleOperator, value: unknown): boolean {
  switch (op) {
    case 'eq':  return attr != null && String(attr).toLowerCase() === String(value ?? '').toLowerCase();
    case 'neq': return !(attr != null && String(attr).toLowerCase() === String(value ?? '').toLowerCase());
    case 'contains':     return String(attr ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'not_contains': return !String(attr ?? '').toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'is_true':  return attr === true;
    case 'is_false': return attr !== true;
    case 'is_empty':     return attr == null || String(attr).trim() === '';
    case 'is_not_empty': return !(attr == null || String(attr).trim() === '');
    case 'gt':  return typeof attr === 'number' && attr >  Number(value);
    case 'lt':  return typeof attr === 'number' && attr <  Number(value);
    case 'gte': return typeof attr === 'number' && attr >= Number(value);
    case 'lte': return typeof attr === 'number' && attr <= Number(value);
    case 'within_days': return typeof attr === 'number' && attr <= Number(value);
    default: return false;
  }
}

function evalNode(node: AudienceNode, attrs: Record<string, Attr>): boolean {
  if (isGroup(node)) return evalGroup(node, attrs);
  const attr = node.field in attrs ? attrs[node.field] : null;
  return evalRule(attr, node.operator, node.value);
}

function evalGroup(group: AudienceGroup, attrs: Record<string, Attr>): boolean {
  const children = group.children ?? [];
  if (children.length === 0) return true; // an empty group matches everyone
  const results = children.map(ch => evalNode(ch, attrs));
  const res = group.combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
  return group.negate ? !res : res;
}

function toRecipient(c: ClientRow, aux: Aux): ResolvedRecipient {
  const ch = chForClient(c, aux.ch);
  const bill = c.id ? aux.billing.inv.get(c.id) : undefined;
  // Prefer a key contact's name for the personal first-name tag on company clients.
  let contactName: string | null = null;
  try {
    const kc = Array.isArray(c.key_contacts) ? c.key_contacts : [];
    const primary = kc.find((k: { name?: string }) => k && typeof k.name === 'string' && k.name.trim());
    if (primary) contactName = primary.name as string;
  } catch { /* ignore */ }

  const src: CampaignMergeSource = {
    name: c.name,
    first_name: firstNameFrom(contactName ?? c.name),
    business_name: c.name,
    reference: c.client_ref,
    entity_type: c.business_type ? (BUSINESS_TYPE_LABEL[c.business_type] ?? c.business_type) : null,
    year_end: c.year_end,
    account_manager: c.account_manager_id ? (aux.users.get(c.account_manager_id) ?? null) : null,
    vat_number: c.vat_number,
    company_number: ch?.companyNumber ?? c.companies_house_id ?? c.registration_number ?? null,
    confirmation_statement_due: ch?.csNextDue ? ukDate(ch.csNextDue) : null,
    accounts_due: ch?.accountsNextDue ? ukDate(ch.accountsNextDue) : null,
    balance_outstanding: bill ? `£${(bill.outstandingPence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null,
  };
  return {
    client_id: c.id,
    name: c.name ?? '',
    email: (c.contact_email ?? '').trim(),
    client_ref: c.client_ref,
    business_type: c.business_type,
    merge_data: buildMergeData(src),
  };
}

export interface ResolveInput {
  source: AudienceSource;
  definition?: AudienceGroup | Record<string, never> | null;
  member_client_ids?: string[] | null;
}

/**
 * Resolve an audience to the full recipient list, with per-recipient merge data
 * and exclusion reasons (no email / unsubscribed / duplicate). Deduplication of
 * shared email addresses is marked here (excludedReason='duplicate') but the
 * caller decides whether to actually drop them (settings.dedupe).
 */
export async function resolveAudience(
  supabase: SupabaseClient,
  firmId: string,
  input: ResolveInput,
): Promise<ResolvedRecipient[]> {
  // Spreadsheet audiences carry their own rows — no client segmentation needed.
  if (input.source === 'spreadsheet') {
    return resolveSpreadsheet(supabase, firmId, input.definition);
  }

  const clients = await loadClients(supabase, firmId);
  const clientIds = clients.map(c => c.id);
  const [ch, users, tasks, billing, mtdOutstanding, unsub] = await Promise.all([
    loadCh(supabase, firmId),
    loadUsers(supabase, firmId),
    loadTasks(supabase, firmId),
    loadBilling(supabase, firmId),
    loadMtdOutstanding(supabase, clientIds),
    loadUnsubscribes(supabase, firmId),
  ]);
  const aux: Aux = { ch, users, tasks, billing, mtdOutstanding, unsub };

  let matched: ClientRow[];
  if (input.source === 'dynamic') {
    const def = input.definition && 'children' in input.definition ? input.definition as AudienceGroup : null;
    matched = def ? clients.filter(c => evalGroup(def, buildAttrs(c, aux))) : clients;
  } else {
    const ids = new Set(input.member_client_ids ?? []);
    matched = clients.filter(c => ids.has(c.id));
  }

  const recipients = matched.map(c => toRecipient(c, aux));
  markExclusions(recipients, unsub);
  return recipients;
}

/** Mark no-email / unsubscribed / duplicate recipients (in place). */
function markExclusions(recipients: ResolvedRecipient[], unsub: Set<string>) {
  const seenEmail = new Set<string>();
  for (const r of recipients) {
    const email = r.email.trim().toLowerCase();
    if (!email || !email.includes('@')) { r.excludedReason = 'no_email'; continue; }
    if (unsub.has(email)) { r.excludedReason = 'unsubscribed'; continue; }
    if (seenEmail.has(email)) { r.excludedReason = 'duplicate'; continue; }
    seenEmail.add(email);
  }
}

/** Resolve a spreadsheet audience: one recipient per row, matched to a client by
 *  email where possible (so outcome-linking + timeline still work). */
async function resolveSpreadsheet(
  supabase: SupabaseClient,
  firmId: string,
  definition: ResolveInput['definition'],
): Promise<ResolvedRecipient[]> {
  const def = definition as unknown as SpreadsheetAudienceData | null;
  if (!def || def.kind !== 'spreadsheet' || !Array.isArray(def.rows) || !Array.isArray(def.columns)) return [];

  // email → client_id, so spreadsheet recipients still tie back to client records.
  const emailToClient = new Map<string, string>();
  try {
    const rows = await loadClients(supabase, firmId);
    for (const c of rows) {
      const e = (c.contact_email ?? '').trim().toLowerCase();
      if (e && !emailToClient.has(e)) emailToClient.set(e, c.id);
    }
  } catch { /* ignore */ }
  const unsub = await loadUnsubscribes(supabase, firmId);

  const recipients: ResolvedRecipient[] = def.rows.map(row => {
    const rr = rowToRecipient(def.columns, row);
    const email = rr.email.trim();
    return {
      client_id: emailToClient.get(email.toLowerCase()) ?? null,
      name: rr.name,
      email,
      client_ref: rr.reference || null,
      business_type: null,
      merge_data: rowMergeData(rr),
    };
  });
  markExclusions(recipients, unsub);
  return recipients;
}

/**
 * Communication-frequency guard: hold back anyone this firm has already emailed
 * within `days`. Marks them 'too_recent' in place (no-op when days <= 0).
 *
 * Deliberately counts *any* campaign email, including automation and journey
 * sends, since the point is how much mail the client is receiving overall.
 */
export async function applyFrequencyGuard(
  supabase: SupabaseClient,
  firmId: string,
  recipients: ResolvedRecipient[],
  days: number,
): Promise<void> {
  if (!days || days <= 0) return;
  const candidates = recipients.filter(r => !r.excludedReason && r.email);
  if (candidates.length === 0) return;

  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const recent = new Set<string>();
  try {
    // Page through recent sends for the firm rather than filtering by a long
    // email IN() list — simpler and avoids URL limits on big audiences.
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from('campaign_recipients')
        .select('email')
        .eq('firm_id', firmId)
        .gte('sent_at', since)
        .range(offset, offset + PAGE - 1);
      if (error || !data) break;
      for (const row of data) {
        const e = ((row.email as string) ?? '').trim().toLowerCase();
        if (e) recent.add(e);
      }
      if (data.length < PAGE) break;
    }
  } catch { return; }   // can't tell → don't block the send

  for (const r of candidates) {
    if (recent.has(r.email.trim().toLowerCase())) r.excludedReason = 'too_recent';
  }
}

/** Summarise a resolved list into the preview shape (count + sample). */
export function summarise(recipients: ResolvedRecipient[], sampleSize = 8): AudiencePreview {
  const noEmail = recipients.filter(r => r.excludedReason === 'no_email').length;
  const unsubscribed = recipients.filter(r => r.excludedReason === 'unsubscribed').length;
  const duplicates = recipients.filter(r => r.excludedReason === 'duplicate').length;
  const tooRecent = recipients.filter(r => r.excludedReason === 'too_recent').length;
  const sendable = recipients.filter(r => !r.excludedReason).length;
  return {
    total: recipients.length,
    sendable,
    noEmail,
    unsubscribed,
    duplicates,
    tooRecent,
    sample: recipients.slice(0, sampleSize),
  };
}
