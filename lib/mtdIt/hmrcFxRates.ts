// HMRC monthly exchange rates — the official rate for converting foreign income
// to sterling, looked up per currency + month.
//
// Source: the public Trade Tariff monthly CSV, e.g.
//   https://www.trade-tariff.service.gov.uk/api/v2/exchange_rates/files/monthly_csv_2026-1.csv
// (no auth, no leading zero on the month). Columns:
//   Country/Territories, Currency, Currency Code, Currency Units per £1, Start, End
//
// CRITICAL: HMRC publishes "units per £1" (£1 = 1.1382 EUR). Our model stores
// the inverse — "1 unit of foreign → GBP" (1 EUR = 0.8786 GBP) — because that's
// what grossGbp multiplies by. So we ALWAYS return 1 / unitsPerGbp. Using the
// raw HMRC number would over-declare foreign income by the square of the rate.

/** HMRC's monthly rate for one currency, expressed in OUR convention. */
export interface FxLookup {
  /** 1 unit of the currency in GBP (already inverted from HMRC's units-per-£1). */
  rate: number;
  /** HMRC's own figure, for display/audit ("£1 = 1.1382 EUR"). */
  unitsPerGbp: number;
  /** The month the rate covers, YYYY-MM. */
  period: string;
  /** Effective window, ISO dates. */
  startDate: string;
  endDate: string;
}

const BASE = 'https://www.trade-tariff.service.gov.uk/api/v2/exchange_rates/files';

// One parsed month, keyed by uppercase currency code → FxLookup.
type MonthTable = Map<string, FxLookup>;

// Module-level cache. HMRC monthly rates are immutable once published, and this
// is global (not per-firm), so a warm serverless instance fetches each month at
// most once. `null` marks a month we tried and HMRC hasn't published, so we
// don't hammer it on every keystroke.
const cache = new Map<string, MonthTable | null>();

function periodOf(isoDate: string): string {
  return isoDate.slice(0, 7); // YYYY-MM
}

/** ddmmyyyy-ish HMRC date (01/01/2026) → ISO (2026-01-01). */
function hmrcDateToIso(d: string): string {
  const m = d.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return d.trim();
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Split one CSV line, tolerating quoted fields (country names contain commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function loadMonth(period: string): Promise<MonthTable | null> {
  if (cache.has(period)) return cache.get(period) ?? null;

  const [year, monthPadded] = period.split('-');
  const month = String(Number(monthPadded)); // HMRC uses no leading zero
  let table: MonthTable | null = null;
  try {
    const res = await fetch(`${BASE}/monthly_csv_${year}-${month}.csv`, {
      // HMRC publishes next month's rates ahead of time; a not-yet-published
      // month simply 404s. Cache for a day so retries within a session are cheap.
      next: { revalidate: 86400 },
    });
    if (res.ok) {
      const text = await res.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const rows = lines.slice(1); // drop header
      const t: MonthTable = new Map();
      for (const line of rows) {
        const cols = splitCsvLine(line);
        // Country, Currency, Code, UnitsPerGbp, Start, End
        const code = (cols[2] ?? '').trim().toUpperCase();
        const unitsPerGbp = Number((cols[3] ?? '').trim());
        if (!code || !Number.isFinite(unitsPerGbp) || unitsPerGbp <= 0) continue;
        t.set(code, {
          rate: 1 / unitsPerGbp,
          unitsPerGbp,
          period,
          startDate: hmrcDateToIso(cols[4] ?? ''),
          endDate: hmrcDateToIso(cols[5] ?? ''),
        });
      }
      // Only treat it as a real month if we actually parsed rates.
      table = t.size > 0 ? t : null;
    }
  } catch (e) {
    console.warn('hmrcFxRates: fetch failed for', period, e);
    // Don't cache a transient network failure as "no rates" — leave it uncached
    // so the next attempt retries.
    return null;
  }
  cache.set(period, table);
  return table;
}

/**
 * The HMRC monthly rate for `currency` in the month of `isoDate`, in our
 * "1 unit → GBP" convention. Returns null when GBP (no conversion), the inputs
 * are unusable, or HMRC hasn't published that currency/month.
 */
export async function lookupHmrcRate(currency: string, isoDate: string): Promise<FxLookup | null> {
  const code = (currency ?? '').trim().toUpperCase();
  if (!code || code === 'GBP') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

  const table = await loadMonth(periodOf(isoDate));
  return table?.get(code) ?? null;
}
