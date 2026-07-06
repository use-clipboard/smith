'use client';

// Renders the real, structured statutory statements (P&L + Balance Sheet) built
// from an imported trial balance. Group-total level — statement-like, not a raw
// ledger dump — with a prior-year comparative column when available.

import type { FinancialStatements, StmtGroup } from '@/lib/accounts-studio/statements';

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (Math.abs(v) < 0.005) return '—';
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${abs})` : abs;
}

function Row({
  label, current, prior, hasPrior, bold, rule, muted,
}: {
  label: string; current: number | null; prior: number | null; hasPrior: boolean;
  bold?: boolean; rule?: boolean; muted?: boolean;
}) {
  return (
    <tr className={rule ? 'border-t border-slate-300' : ''}>
      <td className={`py-1.5 pr-3 ${bold ? 'font-semibold text-[var(--text-primary)]' : muted ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}>{label}</td>
      <td className={`py-1.5 pl-3 text-right tabular-nums ${bold ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
        {current === null ? '' : money(current)}
      </td>
      {hasPrior && (
        <td className={`py-1.5 pl-3 text-right tabular-nums ${bold ? 'font-semibold text-[var(--text-muted)]' : 'text-[var(--text-muted)]'}`}>
          {prior === null ? '' : money(prior)}
        </td>
      )}
    </tr>
  );
}

/** Emit one line per ledger group; `sign` flips costs/expenses to negative. */
function groupRows(groups: StmtGroup[], hasPrior: boolean, sign: 1 | -1) {
  return groups.map(g => (
    <Row key={g.title} label={g.title} hasPrior={hasPrior}
      current={sign * g.total}
      prior={g.totalPrior === null ? null : sign * g.totalPrior} />
  ));
}

function StatementTable({
  title, period, hasPrior, priorLabel, children,
}: {
  title: string; period: string; hasPrior: boolean; priorLabel: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/80 p-5 backdrop-blur-md">
      <div className="mb-3">
        <h4 className="text-[14px] font-bold text-[var(--text-primary)]">{title}</h4>
        <p className="text-[11.5px] text-[var(--text-muted)]">{period}</p>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-1.5 text-left font-semibold"></th>
            <th className="pb-1.5 pl-3 text-right font-semibold">£</th>
            {hasPrior && <th className="pb-1.5 pl-3 text-right font-semibold">{priorLabel}</th>}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function StatementsView({
  statements, periodLabel, priorLabel = 'Prior yr',
}: {
  statements: FinancialStatements;
  periodLabel: string;
  priorLabel?: string;
}) {
  const { profitLoss: pl, balanceSheet: bs, hasPrior } = statements;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <StatementTable title="Profit &amp; Loss Account" period={periodLabel} hasPrior={hasPrior} priorLabel={priorLabel}>
        {groupRows(pl.turnover, hasPrior, 1)}
        <Row label="Turnover" hasPrior={hasPrior} bold rule current={pl.turnoverTotal} prior={pl.turnoverTotalPrior} />
        {pl.costOfSales.length > 0 && (
          <>
            {groupRows(pl.costOfSales, hasPrior, -1)}
            <Row label="Gross profit" hasPrior={hasPrior} bold rule current={pl.grossProfit} prior={pl.grossProfitPrior} />
          </>
        )}
        {groupRows(pl.expenses, hasPrior, -1)}
        {pl.expenses.length > 0 && (
          <Row label="Operating profit" hasPrior={hasPrior} bold rule current={pl.operatingProfit} prior={pl.operatingProfitPrior} />
        )}
        {groupRows(pl.taxation, hasPrior, -1)}
        <Row label="Profit for the financial year" hasPrior={hasPrior} bold rule current={pl.netProfit} prior={pl.netProfitPrior} />
      </StatementTable>

      <StatementTable title="Balance Sheet" period={`As at ${periodLabel.replace(/^.*to /i, '')}`} hasPrior={hasPrior} priorLabel={priorLabel}>
        {bs.fixedAssets.length > 0 && (
          <>
            <Row label="Fixed assets" hasPrior={hasPrior} muted current={null} prior={null} />
            {groupRows(bs.fixedAssets, hasPrior, 1)}
            <Row label="" hasPrior={hasPrior} bold rule current={bs.fixedAssetsTotal} prior={bs.fixedAssetsTotalPrior} />
          </>
        )}
        <Row label="Current assets" hasPrior={hasPrior} muted current={null} prior={null} />
        {groupRows(bs.currentAssets, hasPrior, 1)}
        <Row label="" hasPrior={hasPrior} current={bs.currentAssetsTotal} prior={bs.currentAssetsTotalPrior} />
        {bs.creditorsWithin.length > 0 && (
          <>
            <Row label="Creditors: amounts falling due within one year" hasPrior={hasPrior} muted current={null} prior={null} />
            {groupRows(bs.creditorsWithin, hasPrior, -1)}
          </>
        )}
        <Row label="Net current assets" hasPrior={hasPrior} bold rule current={bs.netCurrentAssets} prior={bs.netCurrentAssetsPrior} />
        <Row label="Total assets less current liabilities" hasPrior={hasPrior} bold current={bs.totalAssetsLessCurrent} prior={bs.totalAssetsLessCurrentPrior} />
        {bs.creditorsAfter.length > 0 && (
          <>
            <Row label="Creditors: amounts falling due after more than one year" hasPrior={hasPrior} muted current={null} prior={null} />
            {groupRows(bs.creditorsAfter, hasPrior, -1)}
          </>
        )}
        {bs.provisions.length > 0 && (
          <>
            <Row label="Provisions for liabilities" hasPrior={hasPrior} muted current={null} prior={null} />
            {groupRows(bs.provisions, hasPrior, -1)}
          </>
        )}
        <Row label="Net assets" hasPrior={hasPrior} bold rule current={bs.netAssets} prior={bs.netAssetsPrior} />
        <Row label="Capital and reserves" hasPrior={hasPrior} muted current={null} prior={null} />
        {groupRows(bs.capitalAndReserves, hasPrior, 1)}
        <Row label="Profit for the financial year" hasPrior={hasPrior} muted current={bs.profitForYear} prior={bs.profitForYearPrior} />
        <Row label="Total equity" hasPrior={hasPrior} bold rule current={bs.totalEquity} prior={bs.totalEquityPrior} />
      </StatementTable>
    </div>
  );
}
