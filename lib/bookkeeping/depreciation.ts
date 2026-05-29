/**
 * Depreciation engine — pure, framework-free so it can run on the server
 * (API routes) and be unit-tested directly.
 *
 * Charge for a period:
 *   charge = base × (annualRate / 100) × (daysHeldInPeriod / 365)
 *     • straight_line   → base = original cost
 *     • reducing_balance → base = NBV at the start of the period
 *   • daysHeld clamps the start to the later of the period start / purchase
 *     date and the end to the earlier of the period end / disposal date, so
 *     it is naturally capped at one full period ("max of the period length").
 *   • A mid-period rate/method change splits the period at the effective date
 *     and charges each segment with the setting in force at its start.
 *   • Never depreciates below NBV 0.
 *
 * Accumulated depreciation brought into a period = the asset's
 * opening_accumulated_depn plus every posted charge dated before the period.
 */

import type {
  Asset,
  AssetScheduleRow,
  DepreciationCharge,
  DepreciationMethod,
  LedgerDepreciationSetting,
} from '@/types/bookkeeping';

const DAYS_IN_YEAR = 365;

// ── Date helpers (YYYY-MM-DD, UTC) ──────────────────────────────────────────

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `a` to `b` (b − a). Negative if b precedes a. */
function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** The day after `iso`, as YYYY-MM-DD. */
function dayAfter(iso: string): string {
  return new Date(toUtc(iso) + 86_400_000).toISOString().slice(0, 10);
}

function maxIso(a: string, b: string): string {
  return toUtc(a) >= toUtc(b) ? a : b;
}
function minIso(a: string, b: string): string {
  return toUtc(a) <= toUtc(b) ? a : b;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Settings lookup ─────────────────────────────────────────────────────────

/** The setting in force on `date` — latest effective_from <= date. */
function settingInForce(
  settings: LedgerDepreciationSetting[],
  date: string,
): LedgerDepreciationSetting | null {
  let chosen: LedgerDepreciationSetting | null = null;
  for (const s of settings) {
    if (toUtc(s.effective_from) <= toUtc(date)) {
      if (!chosen || toUtc(s.effective_from) > toUtc(chosen.effective_from)) chosen = s;
    }
  }
  return chosen;
}

export interface PeriodCharge {
  amount: number;
  /** The method in force at the period start (for display). null = no setting. */
  method: DepreciationMethod | null;
  annualRate: number | null;
}

/**
 * Compute the depreciation charge for a single asset over one period.
 *
 * @param accumulatedDepnBfwd accumulated depreciation at the start of the period
 *        (opening_accumulated_depn + posted charges before this period).
 */
export function computePeriodCharge(
  asset: Pick<Asset, 'cost' | 'purchase_date' | 'disposal_date' | 'status'>,
  settings: LedgerDepreciationSetting[],
  accumulatedDepnBfwd: number,
  periodFrom: string,
  periodTo: string,
): PeriodCharge {
  const inForceAtStart = settingInForce(settings, maxIso(periodFrom, asset.purchase_date));
  const display: PeriodCharge = {
    amount: 0,
    method: inForceAtStart?.method ?? null,
    annualRate: inForceAtStart?.annual_rate ?? null,
  };

  // Window the asset is actually held within this period.
  const activeStart = maxIso(periodFrom, asset.purchase_date);
  const disposalEnd = asset.disposal_date ? minIso(periodTo, asset.disposal_date) : periodTo;
  const activeEnd = disposalEnd;
  if (toUtc(activeStart) > toUtc(activeEnd)) return display; // not held in this period

  let runningNbv = round2(asset.cost - accumulatedDepnBfwd);
  if (runningNbv <= 0) return display; // already fully depreciated

  // Segment boundaries: activeStart, then each rate change inside the window,
  // and a final sentinel one day past activeEnd.
  const breakpoints: string[] = [activeStart];
  for (const s of settings) {
    if (toUtc(s.effective_from) > toUtc(activeStart) && toUtc(s.effective_from) <= toUtc(activeEnd)) {
      breakpoints.push(s.effective_from);
    }
  }
  breakpoints.sort((a, b) => toUtc(a) - toUtc(b));
  const sentinel = dayAfter(activeEnd);
  const bounds = [...breakpoints, sentinel];

  let total = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const segStart = bounds[i];
    const segEndExclusive = bounds[i + 1];
    const days = daysBetween(segStart, segEndExclusive);
    if (days <= 0) continue;

    const setting = settingInForce(settings, segStart);
    if (!setting) continue; // no policy in force yet → no charge for this segment

    const factor = (setting.annual_rate / 100) * (days / DAYS_IN_YEAR);
    const base = setting.method === 'reducing_balance' ? runningNbv : asset.cost;
    let segCharge = round2(base * factor);
    // Straight-line: a full year must charge exactly one annual amount. With a
    // days/365 factor a 366-day leap year would otherwise charge 366/365 ≈
    // 100.27% of the annual amount, slowly over-depreciating the asset. Cap each
    // SL segment at its annual amount (base × rate) so a leap year lands bang on.
    if (setting.method === 'straight_line') {
      const annualAmount = round2(base * (setting.annual_rate / 100));
      if (segCharge > annualAmount) segCharge = annualAmount;
    }
    if (segCharge > runningNbv) segCharge = runningNbv; // never below NBV 0
    if (segCharge <= 0) continue;

    total += segCharge;
    runningNbv = round2(runningNbv - segCharge);
    if (runningNbv <= 0) break;
  }

  display.amount = round2(total);
  return display;
}

/**
 * Build the schedule row for an asset in a period, using its already-posted
 * charge history. If this exact period is already posted, the stored amount is
 * shown verbatim; otherwise it is computed.
 */
export function buildScheduleRow(
  asset: Asset,
  settings: LedgerDepreciationSetting[],
  charges: DepreciationCharge[],
  periodFrom: string,
  periodTo: string,
): AssetScheduleRow {
  const assetCharges = charges.filter(c => c.asset_id === asset.id);

  const depnBroughtForward = round2(
    asset.opening_accumulated_depn +
      assetCharges
        .filter(c => toUtc(c.period_to) < toUtc(periodFrom))
        .reduce((sum, c) => sum + c.amount, 0),
  );

  const postedThisPeriod = assetCharges.find(
    c => c.period_from === periodFrom && c.period_to === periodTo,
  );

  let periodCharge: number;
  let method: DepreciationMethod | null;
  let annualRate: number | null;
  if (postedThisPeriod) {
    periodCharge = postedThisPeriod.amount;
    // Prefer the method/rate captured at post time so the display reflects what
    // was actually charged, even if a back-dated settings change was added
    // since. Legacy charges (posted before those columns existed) store null —
    // fall back to the setting that was in force at the period start.
    if (postedThisPeriod.method != null) {
      method = postedThisPeriod.method;
      annualRate = postedThisPeriod.annual_rate ?? null;
    } else {
      const s = settingInForce(settings, maxIso(periodFrom, asset.purchase_date));
      method = s?.method ?? null;
      annualRate = s?.annual_rate ?? null;
    }
  } else {
    const computed = computePeriodCharge(asset, settings, depnBroughtForward, periodFrom, periodTo);
    periodCharge = computed.amount;
    method = computed.method;
    annualRate = computed.annualRate;
  }

  const depnCarriedForward = round2(depnBroughtForward + periodCharge);
  const nbv = round2(asset.cost - depnCarriedForward);

  return {
    asset,
    method: method ?? 'straight_line',
    annualRate: annualRate ?? 0,
    depnBroughtForward,
    periodCharge,
    depnCarriedForward,
    nbv,
    posted: !!postedThisPeriod,
  };
}
