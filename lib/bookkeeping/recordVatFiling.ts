// Shared "record a VAT filing" logic, used by both the manual "Mark as filed"
// route and the MTD direct-submission route. Posts the closing journal that
// clears the VAT control accounts, inserts the filing row, advances the VAT
// lock, and writes the audit entry — so an MTD submission files identically to
// a manual one (just with submission_method='mtd_api' + the HMRC reference).

import { createClient } from '@/lib/supabase-server';
import type { computeVatReturn } from './vatReturn';

type Supabase = ReturnType<typeof createClient>;
export type VatFigures = Awaited<ReturnType<typeof computeVatReturn>>;

export const VAT_RETURN_SELECT = `
  id, book_id, ref_no, ref_seq, period_from, period_to,
  box1, box2, box3, box4, box5, box6, box7, box8, box9,
  late_entry_vat,
  filed_at, filed_by, submitted_at, submission_method,
  hmrc_reference, notes, filing_journal_id,
  filed_by_user:users!bookkeeping_vat_returns_filed_by_fkey(id, full_name, email),
  created_at, updated_at
`;

const r2 = (n: number) => Math.round(n * 100) / 100;

interface FiledByUserRow { id: string; full_name: string | null; email: string | null }

/** Find (or create) the "Flat rate surplus" income account used to recognise
 *  the difference between VAT charged and the flat-rate paid to HMRC. */
async function resolveFlatRateSurplus(supabase: Supabase, bookId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('bookkeeping_accounts').select('id')
    .eq('book_id', bookId).eq('name', 'Flat rate surplus').limit(1).maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created } = await supabase
    .from('bookkeeping_accounts')
    .insert({ book_id: bookId, name: 'Flat rate surplus', ledger: 'Income', account_type: 'income', sort_order: 9000 })
    .select('id').single();
  return (created?.id as string | undefined) ?? null;
}

export function shapeVatReturn(row: unknown) {
  const r = row as Record<string, unknown> & { filed_by_user?: FiledByUserRow | FiledByUserRow[] | null };
  const fbu = Array.isArray(r.filed_by_user) ? r.filed_by_user[0] : r.filed_by_user;
  const filedByName = fbu?.full_name ?? fbu?.email ?? null;
  const { filed_by_user, ...rest } = r;
  void filed_by_user;
  return { ...rest, filed_by_name: filedByName };
}

export interface RecordVatFilingOptions {
  filingDate?: string;                            // YYYY-MM-DD, default today
  hmrcReference?: string | null;
  submissionMethod?: 'manual' | 'mtd_api' | null;
  submittedAtIso?: string | null;
  lockPeriod?: boolean;                           // default true
  /** Post the VAT-clearing closing journal. Default true. */
  postJournal?: boolean;
  notes?: string | null;
}

export interface RecordVatFilingResult {
  filed: Record<string, unknown>;
  journalWarning: string | null;
  refNo: string;
}

/** Allocate the VAT ref, post the closing journal, insert the filing row,
 *  advance the VAT lock and audit. Throws on a hard failure (caller maps to a
 *  response). Returns the shaped filing row + any non-fatal journal warning. */
export async function recordVatFiling(
  supabase: Supabase,
  actor: { userId: string },
  bookId: string,
  from: string,
  to: string,
  figures: VatFigures,
  vatScheme: string | null,
  opts: RecordVatFilingOptions = {},
): Promise<RecordVatFilingResult> {
  const filingDate = opts.filingDate ?? new Date().toISOString().slice(0, 10);
  const lockPeriod = opts.lockPeriod ?? true;

  // ── Allocate sequential VAT ref ───────────────────────────────────────────
  const { data: nextSeqData, error: seqErr } = await supabase
    .rpc('bookkeeping_next_ref', { p_book_id: bookId, p_type: 'VAT' });
  if (seqErr || typeof nextSeqData !== 'number') {
    throw new Error(seqErr?.message ?? 'Could not allocate VAT ref');
  }
  const refSeq = nextSeqData;
  const refNo = `VAT ${String(refSeq).padStart(6, '0')}`;

  // ── Post the closing journal (DR VAT-Output / CR VAT-Input / net → Net VAT due)
  let filingJournalId: string | null = null;
  let journalWarning: string | null = null;
  if (opts.postJournal !== false) try {
    // Resolve VAT control accounts by system_role first, falling back to name
    // within the Creditors ledger — a rename can't break VAT filing.
    const { data: vatAccts } = await supabase
      .from('bookkeeping_accounts')
      .select('id, name, ledger, system_role')
      .eq('book_id', bookId)
      .eq('ledger', 'Creditors');
    const resolveVat = (role: string, name: string) =>
      (vatAccts ?? []).find(a => a.system_role === role)?.id
      ?? (vatAccts ?? []).find(a => a.name === name)?.id;
    const outAcct = resolveVat('vat_output', 'VAT - Output');
    const inAcct = resolveVat('vat_input', 'VAT - Input');
    const netAcct = resolveVat('net_vat_due', 'Net VAT due');
    if (outAcct && inAcct && netAcct) {
      const splits: Array<{ account_id: string; debit: number; credit: number; entry_details: string }> = [];
      const isFrs = figures.scheme === 'flat_rate';

      if (!isFrs) {
        // Standard: clear the output VAT (Box 1) and input VAT (Box 4), net → Net VAT due.
        if (figures.box1 !== 0) splits.push({ account_id: outAcct, debit: figures.box1, credit: 0, entry_details: `${refNo} — clear output VAT (Box 1)` });
        if (figures.box4 !== 0) splits.push({ account_id: inAcct, debit: 0, credit: figures.box4, entry_details: `${refNo} — clear input VAT (Box 4)` });
        if (figures.box5 > 0) splits.push({ account_id: netAcct, debit: 0, credit: figures.box5, entry_details: `${refNo} — net VAT due to HMRC` });
        else if (figures.box5 < 0) splits.push({ account_id: netAcct, debit: -figures.box5, credit: 0, entry_details: `${refNo} — net VAT recoverable from HMRC` });
      } else {
        // Flat Rate: clear the VAT actually charged on sales; pay the flat-rate
        // amount to HMRC; recognise the difference as "Flat rate surplus" income.
        const surplusAcct = await resolveFlatRateSurplus(supabase, bookId);
        if (!surplusAcct) {
          journalWarning = 'Could not resolve a "Flat rate surplus" income account — closing journal not posted.';
        } else {
          const actual = figures.actual_output_vat;
          if (actual > 0) splits.push({ account_id: outAcct, debit: actual, credit: 0, entry_details: `${refNo} — clear output VAT charged` });
          else if (actual < 0) splits.push({ account_id: outAcct, debit: 0, credit: -actual, entry_details: `${refNo} — clear output VAT charged` });
          if (figures.box4 > 0) splits.push({ account_id: inAcct, debit: 0, credit: figures.box4, entry_details: `${refNo} — capital input VAT reclaimed (Box 4)` });
          else if (figures.box4 < 0) splits.push({ account_id: inAcct, debit: -figures.box4, credit: 0, entry_details: `${refNo} — capital input VAT (Box 4)` });
          if (figures.box5 > 0) splits.push({ account_id: netAcct, debit: 0, credit: figures.box5, entry_details: `${refNo} — net VAT due to HMRC (flat rate)` });
          else if (figures.box5 < 0) splits.push({ account_id: netAcct, debit: -figures.box5, credit: 0, entry_details: `${refNo} — net VAT recoverable from HMRC` });
          const surplus = r2(figures.actual_output_vat - figures.box1);
          if (surplus > 0.005) splits.push({ account_id: surplusAcct, debit: 0, credit: surplus, entry_details: `${refNo} — flat rate surplus (income)` });
          else if (surplus < -0.005) splits.push({ account_id: surplusAcct, debit: -surplus, credit: 0, entry_details: `${refNo} — flat rate shortfall` });
        }
      }

      if (splits.length >= 2) {
        const { data: jrnSeq, error: jrnSeqErr } = await supabase
          .rpc('bookkeeping_next_ref', { p_book_id: bookId, p_type: 'JRN' });
        if (jrnSeqErr || typeof jrnSeq !== 'number') {
          journalWarning = `Could not allocate JRN ref for closing journal: ${jrnSeqErr?.message ?? 'unknown'}`;
        } else {
          const jrnRefNo = `JRN ${String(jrnSeq).padStart(6, '0')}`;
          const { data: jrn, error: jrnErr } = await supabase
            .from('bookkeeping_transactions')
            .insert({
              book_id: bookId, type: 'JRN', ref_no: jrnRefNo, ref_seq: jrnSeq,
              date: to, payee_text: null,
              details: `${refNo} — VAT return for ${from} to ${to}`,
              total: figures.scheme === 'flat_rate'
                ? Math.max(figures.actual_output_vat, figures.box4)
                : Math.max(figures.box1, figures.box4),
              vat_total: 0, vat_rate: null, vat_treatment: null, primary_account_id: null,
              status: 'posted', created_by: actor.userId, posted_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          if (jrnErr || !jrn) {
            journalWarning = `Could not post closing journal: ${jrnErr?.message ?? 'unknown'}`;
          } else {
            const { error: splitsErr } = await supabase
              .from('bookkeeping_transaction_splits')
              .insert(splits.map((s, i) => ({ transaction_id: jrn.id, line_no: i + 1, account_id: s.account_id, debit: s.debit, credit: s.credit, entry_details: s.entry_details, notes: null })));
            if (splitsErr) {
              await supabase.from('bookkeeping_transactions').delete().eq('id', jrn.id);
              journalWarning = `Closing journal split insert failed: ${splitsErr.message}`;
            } else {
              filingJournalId = jrn.id;
            }
          }
        }
      }
    } else {
      const missing = [
        !inAcct && 'VAT - Input',
        !outAcct && 'VAT - Output',
        !netAcct && 'Net VAT due',
      ].filter(Boolean);
      journalWarning = `Closing journal not posted — missing accounts in Creditors ledger: ${missing.join(', ')}.`;
    }
  } catch (e) {
    journalWarning = e instanceof Error ? e.message : 'Closing journal failed';
  }

  // ── Insert the filing record ──────────────────────────────────────────────
  const { data: filed, error: insErr } = await supabase
    .from('bookkeeping_vat_returns')
    .insert({
      book_id: bookId, ref_no: refNo, ref_seq: refSeq, period_from: from, period_to: to,
      box1: figures.box1, box2: figures.box2, box3: figures.box3, box4: figures.box4, box5: figures.box5,
      box6: figures.box6, box7: figures.box7, box8: figures.box8, box9: figures.box9,
      late_entry_vat: figures.late_entry_vat,
      filed_at: `${filingDate}T${new Date().toISOString().slice(11)}`,
      filed_by: actor.userId,
      submitted_at: opts.submittedAtIso ?? null,
      submission_method: opts.submissionMethod ?? null,
      hmrc_reference: opts.hmrcReference ?? null,
      notes: opts.notes ?? null,
      filing_journal_id: filingJournalId,
      snapshot: {
        vat_scheme: vatScheme,
        outputs: figures.outputs,
        inputs: figures.inputs,
        late_entry_breakdown: [...figures.outputs, ...figures.inputs].filter(r => r.is_late_entry),
      },
    })
    .select(VAT_RETURN_SELECT)
    .single();
  if (insErr || !filed) {
    if (filingJournalId) await supabase.from('bookkeeping_transactions').delete().eq('id', filingJournalId);
    throw new Error(insErr?.message ?? 'Insert failed');
  }

  // ── Advance the VAT lock ──────────────────────────────────────────────────
  if (lockPeriod) {
    const { data: book } = await supabase.from('bookkeeping_books').select('vat_lock_date').eq('id', bookId).single();
    const currentLock = (book?.vat_lock_date as string | null) ?? null;
    if (!currentLock || to > currentLock) {
      const { error: lockErr } = await supabase.from('bookkeeping_books').update({ vat_lock_date: to }).eq('id', bookId);
      if (lockErr) console.error('[bookkeeping] failed to advance vat_lock_date', lockErr);
    }
  }

  // ── Audit ─────────────────────────────────────────────────────────────────
  await supabase.from('bookkeeping_audit').insert({
    book_id: bookId, user_id: actor.userId, entity_type: 'vat_return', entity_id: filed.id, action: 'create',
    diff: {
      ref_no: refNo, period: `${from} to ${to}`, box5: figures.box5,
      hmrc_reference: opts.hmrcReference ?? null, submitted_at: opts.submittedAtIso ?? null,
      submission_method: opts.submissionMethod ?? null,
      late_entry_vat: figures.late_entry_vat, filing_journal_id: filingJournalId, lock_period: lockPeriod,
    },
  });

  return { filed: shapeVatReturn(filed), journalWarning, refNo };
}
