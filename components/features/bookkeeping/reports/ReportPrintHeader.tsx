'use client';

/**
 * ReportPrintHeader — the VT-style title block at the top of a printed
 * Trial Balance / Profit & Loss / Balance Sheet PDF.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ C&C Coms Limited                         │
 *   │ Profit and Loss Account                  │
 *   │ For the year ended 31 March 2026         │
 *   └──────────────────────────────────────────┘
 *
 * Hidden on screen (the page header bar does this job already) and shown
 * only via `@media print` rules in globals.css. Render this inside each
 * report's `.bk-print-area` wrapper so the printout has a proper title
 * block matching the VT PDFs.
 */

import { useEffect, useState } from 'react';

interface Props {
  /** Book id — used to fetch the firm + client name for the title block. */
  bookId: string;
  /** "Trial Balance" / "Profit and Loss Account" / "Balance Sheet". */
  reportTitle: string;
  /** Free-text period descriptor. Pass "For the year ended 31 March 2026",
   *  "As at 31 March 2026", etc. — matches VT's phrasing convention. */
  periodDescription: string;
}

interface BookHeaderData {
  client?: { name: string } | null;
  name?: string | null;
}

export default function ReportPrintHeader({ bookId, reportTitle, periodDescription }: Props) {
  const [book, setBook] = useState<BookHeaderData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setBook(d?.book ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  // Fall back to the book name when there's no linked client (which is the
  // common case for unallocated test books, but the print header should
  // still have something at the top).
  const entityName = book?.client?.name || book?.name || '';

  return (
    <div className="bk-print-only" style={{ marginBottom: '12pt' }}>
      <div style={{ fontWeight: 700, fontSize: '12pt' }}>{entityName}</div>
      <div style={{ fontSize: '11pt' }}>{reportTitle}</div>
      <div style={{ fontSize: '10pt' }}>{periodDescription}</div>
    </div>
  );
}
