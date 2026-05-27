'use client';

/**
 * VirtualisedTxnList — high-performance scroller for the "All recent
 * transactions" modal. Renders only the rows currently in the viewport
 * (plus a small over-scan buffer) so a 2,500-row list feels as snappy as
 * a 25-row one.
 *
 * Layout: CSS grid that mimics the columns of the standard RecentTxnTable
 * exactly, so users can't tell visually that they're looking at a
 * virtualised list rather than a regular <table>. Sticky header row sits
 * above the scroll container.
 *
 * Trade-offs vs the original <table> version:
 *   • Rows are absolutely positioned inside a tall spacer. Standard.
 *   • Column widths use a fixed grid template — must stay in sync with
 *     RecentTxnTable's <th> widths to keep the inline (non-modal) and
 *     modal views visually identical.
 *   • Print is NOT taken from this DOM — it generates its own table from
 *     the data array (see buildTxnTableForPrint in BookHomeTab), so we
 *     don't sacrifice virtualisation just to capture rows for the popup.
 */

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Transaction, TransactionType } from '@/types/bookkeeping';
import type { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import { TxnRefLink } from './BookNavigationContext';
import { formatMoneyAbs } from '@/lib/bookkeeping/formatMoney';

interface Props {
  rows: Transaction[];
  vatRegistered: boolean;
  rowActions: ReturnType<typeof useTransactionRowActions>;
  onOpenAccount?: (account: { id: string; name: string; ledger: string | null }) => void;
  onOpenTypeList?: (type: TransactionType, txnId?: string) => void;
}

function formatDateUk(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Grid template — column widths in CSS so header + body stay aligned. Mirrors
// the <th> width utilities on RecentTxnTable (w-24 ≈ 6rem, w-28 ≈ 7rem, etc.).
const GRID_NO_VAT = '6rem 7rem minmax(0, 1fr) 6rem minmax(0, 14rem) minmax(0, 14rem) 2.5rem';
const GRID_WITH_VAT = '6rem 7rem minmax(0, 1fr) 6rem 5rem minmax(0, 14rem) minmax(0, 14rem) 2.5rem';

export default function VirtualisedTxnList({
  rows, vatRegistered, rowActions, onOpenAccount, onOpenTypeList,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    // Row height — matches the <tr> padding (py-1.5 → ~28px) plus a hair
    // for line-height. The list uses this for the spacer-height estimate;
    // tighter rows render fine but the scrollbar will be slightly off.
    estimateSize: () => 30,
    // How many extra rows to render above + below the viewport. Higher =
    // smoother fast-scroll, slightly more memory. 10 is a good balance.
    overscan: 10,
  });
  const gridTemplate = vatRegistered ? GRID_WITH_VAT : GRID_NO_VAT;

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header — sits OUTSIDE the scroll container so it doesn't
          virtualise with the rows. */}
      <div
        className="grid gap-0 px-0 py-1.5 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-b border-slate-200"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="px-2">Date</div>
        <div className="px-2">Ref</div>
        <div className="px-2">Details</div>
        <div className="px-2 text-right">{vatRegistered ? 'Total' : 'Amount'}</div>
        {vatRegistered && <div className="px-2 text-right">VAT</div>}
        <div className="px-2">Primary</div>
        <div className="px-2">Analysis</div>
        <div className="px-2 print-hidden" />
      </div>

      {/* Scrolling viewport — only this element scrolls; the spacer inside
          gives the scrollbar its full range. */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map(v => {
            const t = rows[v.index];
            const analysis = t.splits?.find(s => s.account_id !== t.primary_account_id);
            const rp = rowActions.rowProps(t);
            return (
              <div
                key={t.id}
                {...rp}
                className={`grid items-center border-b border-gray-100 hover:bg-indigo-50/30 text-sm ${rp.className ?? ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${v.start}px)`,
                  height: v.size,
                  gridTemplateColumns: gridTemplate,
                }}
              >
                <div className="px-2 text-gray-700 tabular-nums">{formatDateUk(t.date)}</div>
                <div
                  className="px-2 text-xs"
                  onClick={() => onOpenTypeList?.(t.type, t.id)}
                >
                  {/* TxnRefLink hover-shows a T-account popover with the
                      transaction's debit/credit splits — same UX as the
                      ledger views. The Transaction returned by the API
                      already carries `splits`, so the popover renders
                      instantly without a fetch.
                      The wrapping onClick is how the parent gets a chance
                      to close the modal after the link navigates — TxnRefLink
                      itself only knows about nav.openTypeList. */}
                  <TxnRefLink txn={t} className="text-xs" />
                </div>
                <div className="px-2 text-gray-900 truncate">{t.details ?? ''}</div>
                <div className="px-2 text-right tabular-nums">{formatMoneyAbs(Number(t.total))}</div>
                {vatRegistered && (
                  <div className="px-2 text-right tabular-nums text-gray-500">
                    {Number(t.vat_total) > 0 ? formatMoneyAbs(Number(t.vat_total)) : ''}
                  </div>
                )}
                <div className="px-2 truncate">
                  {t.primary_account && onOpenAccount ? (
                    <button
                      type="button"
                      onClick={() => onOpenAccount({
                        id: t.primary_account!.id,
                        name: t.primary_account!.name,
                        ledger: t.primary_account!.ledger,
                      })}
                      className="text-indigo-700 hover:underline hover:text-indigo-900 text-left"
                    >
                      {`${t.primary_account.ledger ?? ''}: ${t.primary_account.name}`}
                    </button>
                  ) : (
                    <span className="text-indigo-700">
                      {t.primary_account ? `${t.primary_account.ledger ?? ''}: ${t.primary_account.name}` : ''}
                    </span>
                  )}
                </div>
                <div className="px-2 truncate">
                  {analysis?.account && onOpenAccount ? (
                    <button
                      type="button"
                      onClick={() => onOpenAccount({
                        id: analysis.account!.id,
                        name: analysis.account!.name,
                        ledger: analysis.account!.ledger,
                      })}
                      className="text-indigo-700 hover:underline hover:text-indigo-900 text-left"
                    >
                      {`${analysis.account.ledger ?? ''}: ${analysis.account.name}`}
                    </button>
                  ) : (
                    <span className="text-indigo-700">
                      {analysis?.account ? `${analysis.account.ledger ?? ''}: ${analysis.account.name}` : ''}
                    </span>
                  )}
                </div>
                <div className="px-2 text-right print-hidden">{rowActions.renderActions(t)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
