// Campaign outcome-linking.
//
// What makes Campaigns more than a newsletter tool: instead of only "58%
// opened", we ask "did the email precede the client actually doing something?"
// For a sent campaign we look at the recipient clients and count practice
// activity in the window AFTER the send — records uploaded, tasks completed,
// invoices paid. This is correlation, not causation, and the UI says "after
// this campaign", never "because of it".
//
// Computed live from existing tables — no new schema. Every source is wrapped so
// a missing module/table degrades to zero rather than failing the report.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClientOutcomes {
  documents: boolean; tasks: boolean; invoices: boolean; mtd: boolean; accounts: boolean;
}

export interface CampaignOutcomes {
  windowDays: number;
  documentsUploaded: number;   // distinct clients who uploaded a document
  tasksCompleted: number;      // distinct clients who had a task completed
  invoicesPaid: number;        // distinct clients who paid an invoice
  mtdSubmitted: number;        // distinct clients whose MTD quarter reached submitted/approved
  accountsApproved: number;    // distinct clients who approved their accounts
  anyOutcome: number;          // distinct clients with at least one of the above
  /** Per-client flags, for annotating the recipient list. */
  byClient: Record<string, ClientOutcomes>;
}

const CHUNK = 300;

/** Run a select over a chunked `client_id IN (...)` list, collecting the client
 *  ids that come back. Never throws. */
async function collectClientIds(
  supabase: SupabaseClient,
  table: string,
  dateColumn: string,
  clientIds: string[],
  fromIso: string,
  toIso: string,
  /** Optional extra `column IN (...)` filter, e.g. a status whitelist. */
  statusFilter?: { column: string; values: string[] },
): Promise<Set<string>> {
  const found = new Set<string>();
  try {
    for (let i = 0; i < clientIds.length; i += CHUNK) {
      const slice = clientIds.slice(i, i + CHUNK);
      let q = supabase
        .from(table)
        .select('client_id')
        .in('client_id', slice)
        .gte(dateColumn, fromIso)
        .lte(dateColumn, toIso);
      if (statusFilter) q = q.in(statusFilter.column, statusFilter.values);
      const { data, error } = await q;
      if (error) break;              // table/column missing — treat as no data
      const rows = (data ?? []) as unknown as Array<{ client_id: string | null }>;
      for (const row of rows) {
        if (row.client_id) found.add(row.client_id);
      }
    }
  } catch {
    /* missing module — return what we have */
  }
  return found;
}

/**
 * Clients who approved their statutory accounts in the window. Accounts Studio
 * approvals hang off an engagement rather than a client, so this resolves
 * client → engagements → approvals. Degrades to empty if the module isn't there.
 */
async function collectAccountsApproved(
  supabase: SupabaseClient,
  clientIds: string[],
  fromIso: string,
  toIso: string,
): Promise<Set<string>> {
  const found = new Set<string>();
  try {
    for (let i = 0; i < clientIds.length; i += CHUNK) {
      const slice = clientIds.slice(i, i + CHUNK);
      const { data: engs, error } = await supabase
        .from('accounts_studio_engagements')
        .select('id, client_id')
        .in('client_id', slice);
      if (error) break;
      const clientByEngagement = new Map<string, string>();
      for (const e of (engs ?? [])) {
        const row = e as unknown as { id: string; client_id: string | null };
        if (row.client_id) clientByEngagement.set(row.id, row.client_id);
      }
      const engIds = Array.from(clientByEngagement.keys());
      for (let j = 0; j < engIds.length; j += CHUNK) {
        const { data: aps, error: apErr } = await supabase
          .from('accounts_studio_approvals')
          .select('engagement_id')
          .in('engagement_id', engIds.slice(j, j + CHUNK))
          .gte('approved_at', fromIso)
          .lte('approved_at', toIso);
        if (apErr) break;
        for (const a of (aps ?? [])) {
          const cid = clientByEngagement.get((a as unknown as { engagement_id: string }).engagement_id);
          if (cid) found.add(cid);
        }
      }
    }
  } catch { /* module absent */ }
  return found;
}

export async function computeCampaignOutcomes(
  supabase: SupabaseClient,
  clientIds: string[],
  sentAt: string,
  windowDays: number,
): Promise<CampaignOutcomes> {
  const ids = Array.from(new Set(clientIds.filter(Boolean)));
  const empty: CampaignOutcomes = {
    windowDays, documentsUploaded: 0, tasksCompleted: 0, invoicesPaid: 0,
    mtdSubmitted: 0, accountsApproved: 0, anyOutcome: 0, byClient: {},
  };
  if (ids.length === 0 || !sentAt) return empty;

  const from = new Date(sentAt);
  const to = new Date(from.getTime() + windowDays * 86_400_000);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // Documents can land in either the basic `documents` table or the Vault.
  const [docsA, docsB, tasks, invoices, mtd, accounts] = await Promise.all([
    collectClientIds(supabase, 'documents', 'created_at', ids, fromIso, toIso),
    collectClientIds(supabase, 'vault_documents', 'created_at', ids, fromIso, toIso),
    collectClientIds(supabase, 'tasks', 'completed_at', ids, fromIso, toIso),
    collectClientIds(supabase, 'invoices', 'paid_at', ids, fromIso, toIso),
    // Exact: submitted_at is stamped at the filing moment (20260775), so this no
    // longer has to approximate from updated_at.
    collectClientIds(supabase, 'mtd_it_quarters', 'submitted_at', ids, fromIso, toIso),
    collectAccountsApproved(supabase, ids, fromIso, toIso),
  ]);

  const docs = new Set<string>([...docsA, ...docsB]);

  const byClient: Record<string, ClientOutcomes> = {};
  const mark = (set: Set<string>, key: keyof ClientOutcomes) => {
    for (const cid of set) {
      byClient[cid] = byClient[cid] ?? { documents: false, tasks: false, invoices: false, mtd: false, accounts: false };
      byClient[cid][key] = true;
    }
  };
  mark(docs, 'documents');
  mark(tasks, 'tasks');
  mark(invoices, 'invoices');
  mark(mtd, 'mtd');
  mark(accounts, 'accounts');

  return {
    windowDays,
    documentsUploaded: docs.size,
    tasksCompleted: tasks.size,
    invoicesPaid: invoices.size,
    mtdSubmitted: mtd.size,
    accountsApproved: accounts.size,
    anyOutcome: Object.keys(byClient).length,
    byClient,
  };
}
