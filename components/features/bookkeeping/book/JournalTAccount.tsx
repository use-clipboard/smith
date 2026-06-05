'use client';

/**
 * JournalTAccount — inline, read-only double-entry panel.
 *
 * Mirrors the purple transaction-preview bubble shown when a transaction ref
 * is hovered (see TxnRefLink in BookNavigationContext), but rendered inline
 * for use inside explanatory content — e.g. the AI Adviser illustrating how an
 * entry is made. Lines may carry a money amount OR just a direction marker
 * (for conceptual "Dr this / Cr that" explanations where no figure is known).
 */

import { formatMoneyAbs } from '@/lib/bookkeeping/formatMoney';

export interface JournalLine {
  ledger?: string | null;
  account: string;
  /** Money amount on the debit side. */
  debit?: number | null;
  /** Money amount on the credit side. */
  credit?: number | null;
  /** Direction-only marker when no figure is given. */
  drMark?: boolean;
  crMark?: boolean;
  detail?: string | null;
}

export default function JournalTAccount({
  title, refNo, date, lines,
}: {
  title?: string | null;
  refNo?: string | null;
  date?: string | null;
  lines: JournalLine[];
}) {
  return (
    <div className="my-2 inline-block w-full max-w-[420px] rounded-md border border-purple-300 shadow-sm bg-purple-50 overflow-hidden align-top">
      {/* Header — ref/title + date, Debit/Credit column labels */}
      <div className="px-2.5 py-1 border-b border-purple-200 bg-purple-200/80 flex items-center gap-2">
        {refNo
          ? <span className="font-mono text-[11px] text-indigo-700">{refNo}</span>
          : title && <span className="text-[11px] font-semibold text-purple-900 truncate">{title}</span>}
        {date && <span className="text-[10px] text-slate-500 tabular-nums">{date}</span>}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-purple-700/70 font-semibold flex items-center gap-3">
          <span className="w-[78px] text-right">Debit</span>
          <span className="w-[78px] text-right">Credit</span>
        </span>
      </div>

      {/* When a ref is shown, the title sits as a sub-line below it. */}
      {refNo && title && (
        <div className="px-2.5 py-0.5 text-[11px] text-purple-900/80 border-b border-purple-200/60">{title}</div>
      )}

      {/* T-account body */}
      <table className="text-[11px] w-full">
        <tbody>
          {lines.map((r, i) => (
            <tr key={i} className="border-t border-purple-200/60 first:border-t-0 align-top">
              <td className="px-2.5 py-0.5 text-slate-700 truncate" style={{ maxWidth: 90 }}>{r.ledger ?? ''}</td>
              <td className="px-1 py-0.5 text-slate-900">
                {r.account}
                {r.detail && <span className="block text-[10px] text-slate-400">{r.detail}</span>}
              </td>
              <td className="px-2.5 py-0.5 text-right tabular-nums text-slate-900" style={{ width: 86 }}>
                {typeof r.debit === 'number' && r.debit > 0 ? formatMoneyAbs(r.debit) : r.drMark ? '✓' : ''}
              </td>
              <td className="px-2.5 py-0.5 text-right tabular-nums text-red-600" style={{ width: 86 }}>
                {typeof r.credit === 'number' && r.credit > 0 ? formatMoneyAbs(r.credit) : r.crMark ? '✓' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
