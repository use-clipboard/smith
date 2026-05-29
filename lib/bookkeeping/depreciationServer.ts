/**
 * Server-side depreciation helpers shared by the depreciation API routes.
 *
 * The asset register is layered on top of the FA ledgers: every debit to a
 * ledger's "Cost - additions" account is an asset. `syncAdditionAssets` keeps
 * the `bookkeeping_assets` table in step with those splits (cost / date /
 * description mirror the split), then `loadLedgerSchedule` builds the per-asset
 * schedule for a period using the depreciation engine.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Asset,
  AssetScheduleRow,
  DepreciationCharge,
  LedgerDepreciationSetting,
} from '@/types/bookkeeping';
import { faAccountNames, isFixedAssetLedger } from './fixedAssets';
import { buildScheduleRow } from './depreciation';

type DB = SupabaseClient;

/**
 * Ensure an `addition` asset row exists for every debit posted to the ledger's
 * "Cost - additions" account, and that cost/date/description still mirror the
 * underlying split. Returns nothing — callers re-read the asset table after.
 */
export async function syncAdditionAssets(
  supabase: DB,
  bookId: string,
  ledger: string,
): Promise<void> {
  if (!isFixedAssetLedger(ledger)) return;

  const names = faAccountNames(ledger);
  const { data: costAcct } = await supabase
    .from('bookkeeping_accounts')
    .select('id')
    .eq('book_id', bookId)
    .eq('ledger', ledger)
    .eq('name', names.costAdditions)
    .maybeSingle();
  if (!costAcct) return;

  // Every split touching the Cost-additions account, with its transaction.
  const { data: splits } = await supabase
    .from('bookkeeping_transaction_splits')
    .select(`
      id, debit, credit, entry_details,
      transaction:bookkeeping_transactions!inner(id, date, payee_text, details)
    `)
    .eq('account_id', costAcct.id);

  if (!splits || splits.length === 0) return;

  // Existing addition assets for this ledger, keyed by split_id.
  const { data: existing } = await supabase
    .from('bookkeeping_assets')
    .select('id, split_id, cost, purchase_date, description')
    .eq('book_id', bookId)
    .eq('ledger', ledger)
    .eq('source', 'addition');
  const bySplit = new Map((existing ?? []).map(a => [a.split_id as string, a]));

  for (const s of splits) {
    // A debit increases cost (an addition). A pure credit line (contra) isn't
    // an asset on its own — skip zero/negative cost.
    const cost = Number(s.debit) - Number(s.credit);
    if (cost <= 0) continue;

    const txn = Array.isArray(s.transaction) ? s.transaction[0] : s.transaction;
    if (!txn) continue;
    const description =
      (s.entry_details && s.entry_details.trim()) ||
      (txn.payee_text && txn.payee_text.trim()) ||
      (txn.details && txn.details.trim()) ||
      'Asset addition';

    const found = bySplit.get(s.id);
    if (found) {
      // Refresh in case the split was edited since it was first registered.
      if (
        Number(found.cost) !== cost ||
        found.purchase_date !== txn.date ||
        found.description !== description
      ) {
        await supabase
          .from('bookkeeping_assets')
          .update({ cost, purchase_date: txn.date, description, updated_at: new Date().toISOString() })
          .eq('id', found.id);
      }
    } else {
      await supabase.from('bookkeeping_assets').insert({
        book_id: bookId,
        ledger,
        source: 'addition',
        split_id: s.id,
        description,
        purchase_date: txn.date,
        cost,
      });
    }
  }
}

export interface LedgerSchedule {
  ledger: string;
  settings: LedgerDepreciationSetting[];
  rows: AssetScheduleRow[];
  /** Totals across all rows for the period. */
  totals: {
    cost: number;
    depnBroughtForward: number;
    periodCharge: number;
    depnCarriedForward: number;
    nbv: number;
  };
  /** Warn-only reconciliation between the ledger and the itemised assets.
   *  `cost*` compares total cost across ALL cost movement accounts vs the sum
   *  of every itemised asset's cost. `depnBfwd*` compares the Depn-b/fwd
   *  balance vs the sum of opening accumulated depn across all assets. */
  reconciliation: {
    costLedger: number;
    costAssets: number;
    depnBfwdLedger: number;
    depnBfwdAssets: number;
  };
}

/**
 * Build the schedule for one FA ledger over [periodFrom, periodTo]. Syncs
 * addition assets first so freshly-booked additions appear immediately.
 */
export async function loadLedgerSchedule(
  supabase: DB,
  bookId: string,
  ledger: string,
  periodFrom: string,
  periodTo: string,
): Promise<LedgerSchedule> {
  await syncAdditionAssets(supabase, bookId, ledger);

  // Assets + settings first; charges are then fetched scoped to just this
  // ledger's assets (rather than every charge in the book) so a large book's
  // unrelated FA categories don't get pulled across the wire and filtered out.
  const [assetsRes, settingsRes] = await Promise.all([
    supabase
      .from('bookkeeping_assets')
      .select('*')
      .eq('book_id', bookId)
      .eq('ledger', ledger)
      .order('purchase_date', { ascending: true }),
    supabase
      .from('bookkeeping_ledger_depreciation_settings')
      .select('*')
      .eq('book_id', bookId)
      .eq('ledger', ledger)
      .order('effective_from', { ascending: true }),
  ]);

  const assets = (assetsRes.data ?? []) as Asset[];
  const settings = (settingsRes.data ?? []) as LedgerDepreciationSetting[];
  const assetIds = assets.map(a => a.id);

  let charges: DepreciationCharge[] = [];
  if (assetIds.length > 0) {
    const { data: chargesData } = await supabase
      .from('bookkeeping_depreciation_charges')
      .select('*')
      .eq('book_id', bookId)
      .in('asset_id', assetIds);
    charges = (chargesData ?? []) as DepreciationCharge[];
  }

  const rows = assets.map(a => buildScheduleRow(a, settings, charges, periodFrom, periodTo));

  const totals = rows.reduce(
    (t, r) => ({
      cost: t.cost + r.asset.cost,
      depnBroughtForward: t.depnBroughtForward + r.depnBroughtForward,
      periodCharge: t.periodCharge + r.periodCharge,
      depnCarriedForward: t.depnCarriedForward + r.depnCarriedForward,
      nbv: t.nbv + r.nbv,
    }),
    { cost: 0, depnBroughtForward: 0, periodCharge: 0, depnCarriedForward: 0, nbv: 0 },
  );

  const reconciliation = await reconcileBfwd(supabase, bookId, ledger, assets);

  return { ledger, settings, rows, totals, reconciliation };
}

/**
 * Warn-only reconciliation between the ledger's aggregate accounts and the
 * itemised assets. Compares total cost across all cost movement accounts vs
 * Σ every asset's cost, and Depn-b/fwd balance vs Σ opening accumulated depn.
 */
async function reconcileBfwd(
  supabase: DB,
  bookId: string,
  ledger: string,
  assets: Asset[],
) {
  const names = faAccountNames(ledger);
  const { data: bfwdAccts } = await supabase
    .from('bookkeeping_accounts')
    .select('id, name')
    .eq('book_id', bookId)
    .eq('ledger', ledger);

  // A book can end up with more than one account of the same name — e.g. the
  // COA seed creates "Depn - b/fwd" and an opening-TB import created a near-twin
  // with a stray double space ("Depn -  b/fwd"), so the balance sits on one and
  // the empty duplicate on the other. Match on a whitespace-normalised name and
  // sum across ALL matches, otherwise picking just one (or an exact-string
  // filter) can land on the empty duplicate and report a £0 ledger balance.
  const nrm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const depnName = nrm(names.depnBfwd);
  const depnAcctIds = (bfwdAccts ?? []).filter(a => nrm(a.name) === depnName).map(a => a.id);

  // Cost is reconciled across ALL cost movement accounts, not just "Cost -
  // b/fwd". On a mid-life migration the opening cost is often imported as a
  // single lump into Cost-b/fwd even for assets the user tracks as in-year
  // *additions* (whose cost would normally sit in Cost-additions). Comparing
  // only Cost-b/fwd against only brought_forward assets then cries "mismatch"
  // when the totals actually tie out. Summing every cost account (b/fwd +
  // additions − disposals, all signed via debit−credit) against every itemised
  // asset's cost reconciles the real position regardless of which cost account
  // the migration parked the money in.
  const isCostAcct = (name: string) => nrm(name).startsWith('cost - ');
  const costAcctIds = (bfwdAccts ?? []).filter(a => isCostAcct(a.name)).map(a => a.id);

  const balanceOf = async (accountIds: string[]): Promise<number> => {
    if (accountIds.length === 0) return 0;
    const { data } = await supabase
      .from('bookkeeping_transaction_splits')
      .select('debit, credit')
      .in('account_id', accountIds);
    return (data ?? []).reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);
  };

  const [costLedger, depnBfwdLedgerRaw] = await Promise.all([
    balanceOf(costAcctIds),
    balanceOf(depnAcctIds),
  ]);

  // Total itemised cost across every asset in the register (any source).
  const costAssets = assets.reduce((s, a) => s + a.cost, 0);
  // Opening accumulated depreciation is a migration figure that any asset can
  // carry (additions bought in a prior year keep their depn-to-date), so the
  // Depn-b/fwd tie-out sums over EVERY asset. Current-period additions carry 0
  // here, so they don't distort the comparison.
  const depnBfwdAssets = assets.reduce((s, a) => s + a.opening_accumulated_depn, 0);

  return {
    costLedger: round2(costLedger),
    costAssets: round2(costAssets),
    // Depn b/fwd is a credit balance on a contra-asset account → negate so the
    // sign matches the positive accumulated-depn figure on the assets.
    depnBfwdLedger: round2(-depnBfwdLedgerRaw),
    depnBfwdAssets: round2(depnBfwdAssets),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
