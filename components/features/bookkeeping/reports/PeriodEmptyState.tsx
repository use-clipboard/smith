'use client';

/**
 * PeriodEmptyState — shown by every report when the book has no year-end
 * configured yet (so the active period in the header bar is "not ready").
 *
 * Keeps the messaging consistent across TB / P&L / BS / CF / VAT. Points
 * the user at the bar / Book Settings rather than letting them stare at
 * a blank table wondering why nothing's loading.
 */

import { Calendar } from 'lucide-react';

export default function PeriodEmptyState({ reportName }: { reportName: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-8 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 text-amber-700 mb-3">
        <Calendar size={18} />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">
        Pick a year and period to view the {reportName}
      </h3>
      <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
        Set the book&apos;s year-end (in Book Settings or by clicking the year-end button at the top of the page),
        then pick a year and period from the dropdowns in the header. Reports will then update automatically.
      </p>
    </div>
  );
}
