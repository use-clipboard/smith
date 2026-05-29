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
  /** Warn-only b/fwd reconciliation: the ledger's Cost/Depn b/fwd balances vs
   *  the sum of itemised assets' cost / opening accumulated depn. */
  reconciliation: {
    costBfwdLedger: number;
    costBfwdAssets: number;
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

  const [assetsRes, settingsRes, chargesRes] = await Promise.all([
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
    supabase
      .from('bookkeeping_depreciation_charges')
      .select('*')
      .eq('book_id', bookId),
  ]);

  const assets = (assetsRes.data ?? []) as Asset[];
  const settings = (settingsRes.data ?? []) as LedgerDepreciationSetting[];
  const allCharges = (chargesRes.data ?? []) as DepreciationCharge[];
  const assetIds = new Set(assets.map(a => a.id));
  const charges = allCharges.filter(c => assetIds.has(c.asset_id));

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
 * Warn-only reconciliation between the ledger's aggregate b/fwd accounts and
 * the itemised assets. Compares Cost-b/fwd balance vs Σ b/fwd asset cost, and
 * Depn-b/fwd balance vs Σ opening accumulated depn.
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
    .eq('ledger', ledger)
    .in('name', [names.costBfwd, names.depnBfwd]);

  const costAcctId = bfwdAccts?.find(a => a.name === names.costBfwd)?.id;
  const depnAcctId = bfwdAccts?.find(a => a.name === names.depnBfwd)?.id;

  const balanceOf = async (accountId: string | undefined): Promise<number> => {
    if (!accountId) return 0;
    const { data } = await supabase
      .from('bookkeeping_transaction_splits')
      .select('debit, credit')
      .eq('account_id', accountId);
    return (data ?? []).reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);
  };

  const [costBfwdLedger, depnBfwdLedgerRaw] = await Promise.all([
    balanceOf(costAcctId),
    balanceOf(depnAcctId),
  ]);

  const bfwdAssets = assets.filter(a => a.source === 'brought_forward');
  const costBfwdAssets = bfwdAssets.reduce((s, a) => s + a.cost, 0);
  const depnBfwdAssets = bfwdAssets.reduce((s, a) => s + a.opening_accumulated_depn, 0);

  return {
    costBfwdLedger: round2(costBfwdLedger),
    costBfwdAssets: round2(costBfwdAssets),
    // Depn b/fwd is a credit balance on a contra-asset account → negate so the
    // sign matches the positive accumulated-depn figure on the assets.
    depnBfwdLedger: round2(-depnBfwdLedgerRaw),
    depnBfwdAssets: round2(depnBfwdAssets),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
