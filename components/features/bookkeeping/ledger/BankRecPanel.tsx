'use client';

/**
 * BankRecPanel — the Bank-Rec sub-tab on a Bank account's ledger view.
 *
 * Two zones:
 *   • Top — "Start a new reconciliation" with four method buttons:
 *       Manual · CSV · PDF (coming soon) · Link (coming soon)
 *   • Below — a list of existing reconciliations for this account; click
 *     one to open the BankRecDetailModal lightbox.
 *
 * The actual matching workflow (statement lines ↔ ledger candidates) lives
 * in the detail modal, NOT here — the dashboard's job is to give the user
 * a clear picture of "what's been reconciled" + "how to start a new one".
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Upload, FileText, Pencil, FileScan, Cable, Check, ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import NewBankImportModal from './NewBankImportModal';
import BankRecDetailModal from './BankRecDetailModal';
import { useBookNavigation } from '../book/BookNavigationContext';

interface Props {
  bookId: string;
  accountId: string;
  accountName: string;
  /** Pre-loaded ledger entries from the parent — passed straight to the
   *  detail modal so it doesn't need to refetch. */
  entries: LedgerEntry[];
  /** Bumped whenever a rec changes so the parent's ledger view refreshes. */
  onReconciliationChanged: () => void;
}

interface LedgerEntry {
  split_id: string;
  transaction_id: string;
  ref_no: string;
  date: string;
  details: string | null;
  entry_details: string | null;
  debit: number;
  credit: number;
}

interface BankImport {
  id: string;
  account_id: string;
  file_name: string;
  display_label: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned';
  uploaded_at: string;
  reconciled_at: string | null;
}

function formatDateUk(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function BankRecPanel({
  bookId, accountId, accountName, entries, onReconciliationChanged,
}: Props) {
  const [imports, setImports]     = useState<BankImport[]>([]);
  const [loading, setLoading]     = useState(true);
  const [uploadOpen, setUploadOpen]   = useState(false);
  const [detailImportId, setDetailImportId] = useState<string | null>(null);
  const nav = useBookNavigation();
  // Used by the detail modal's Reopen lock check. Fetched once on mount.
  const [periodLockDate, setPeriodLockDate] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        setPeriodLockDate(d?.book?.period_lock_date ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  // ── Load imports ────────────────────────────────────────────────────────
  const loadImports = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports?account_id=${accountId}`);
      if (!r.ok) return;
      const d = await r.json() as { imports: BankImport[] };
      setImports(d.imports);
    } finally {
      setLoading(false);
    }
  }, [bookId, accountId]);

  useEffect(() => { void loadImports(); }, [loadImports]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Top zone: start a new reconciliation ──────────────────────────── */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">Start a new reconciliation</h3>
          <span className="text-[11px] text-slate-500">{accountName}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <MethodButton
            icon={Pencil}
            label="Manual"
            description="Type rows in by hand — fast multi-type entry sheet for PAY / REC / CHQ / TRF."
            tone="indigo"
            onClick={() => nav?.openManualRec?.(accountId, accountName)}
          />
          <MethodButton
            icon={Upload}
            label="CSV"
            description="Drop in a CSV from your bank — we match against the ledger automatically."
            tone="indigo"
            onClick={() => setUploadOpen(true)}
          />
          <MethodButton
            icon={FileScan}
            label="PDF"
            description="Lift transactions out of a PDF statement using the Bank-to-CSV tool."
            tone="slate"
            disabled
            disabledLabel="Coming soon"
          />
          <MethodButton
            icon={Cable}
            label="Link"
            description="Connect a live feed from this bank account."
            tone="slate"
            disabled
            disabledLabel="Coming soon"
          />
        </div>
      </div>

      {/* ── Existing reconciliations ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-2 flex items-center gap-2 sticky top-0 bg-white z-10 border-b border-slate-100">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">Reconciliations</h3>
          <span className="text-[11px] text-slate-500">{imports.length}</span>
          {loading && <Loader2 size={10} className="animate-spin text-slate-400" />}
        </div>

        {!loading && imports.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6 text-slate-400">
            <p className="text-sm font-medium text-slate-600">No reconciliations yet on this account.</p>
            <p className="text-xs mt-1">Pick a method above to start your first one.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {imports.map(i => (
              <RecRow
                key={i.id}
                imp={i}
                onClick={() => setDetailImportId(i.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {uploadOpen && (
        <NewBankImportModal
          bookId={bookId}
          accountId={accountId}
          accountLabel={accountName}
          onClose={() => setUploadOpen(false)}
          onCreated={(id) => {
            setUploadOpen(false);
            void loadImports();
            // Drop the user straight into the matching workflow for the new rec.
            setDetailImportId(id);
          }}
        />
      )}

      {detailImportId && (
        <BankRecDetailModal
          bookId={bookId}
          importId={detailImportId}
          accountId={accountId}
          accountName={accountName}
          entries={entries}
          periodLockDate={periodLockDate}
          onClose={() => setDetailImportId(null)}
          onChanged={() => {
            void loadImports();
            onReconciliationChanged();
          }}
        />
      )}

      {/* Manual rec opens as its own dynamic rail tab via the BookNavigation
          context, not inline here. See BookView.openManualRecTab. */}
    </div>
  );
}

// ── Method button (top zone) ────────────────────────────────────────────────
function MethodButton({
  icon: Icon, label, description, tone, disabled, disabledLabel, onClick,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  tone: 'indigo' | 'slate';
  disabled?: boolean;
  disabledLabel?: string;
  onClick?: () => void;
}) {
  const tones = tone === 'indigo'
    ? 'border-indigo-200 hover:border-indigo-300 hover:bg-indigo-50 text-indigo-900 [&_svg.icon]:text-indigo-600 [&_svg.icon]:bg-indigo-100'
    : 'border-slate-200 text-slate-500 [&_svg.icon]:text-slate-400 [&_svg.icon]:bg-slate-100';
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`relative rounded-xl border bg-white px-3 py-3 text-left flex items-start gap-2.5 transition-colors ${tones} ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
    >
      <span className="icon w-7 h-7 rounded-lg flex items-center justify-center shrink-0">
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold mb-0.5">{label}</span>
        <span className="block text-[10px] leading-snug text-slate-500">{description}</span>
      </span>
      {disabled && disabledLabel && (
        <span className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
          {disabledLabel}
        </span>
      )}
    </button>
  );
}

// ── A row in the reconciliations list ──────────────────────────────────────
function RecRow({ imp, onClick }: { imp: BankImport; onClick: () => void }) {
  const statusTone = STATUS_TONES[imp.status];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
      >
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${statusTone.iconBg}`}>
          {imp.status === 'reconciled' ? <Check size={13} className={statusTone.iconColor} /> : <FileText size={13} className={statusTone.iconColor} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900 truncate">
              {imp.display_label || imp.file_name}
            </span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${statusTone.badgeBg} ${statusTone.badgeText}`}>
              {STATUS_LABEL[imp.status]}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {imp.period_start && imp.period_end && (
              <span>{formatDateUk(imp.period_start)} → {formatDateUk(imp.period_end)} · </span>
            )}
            uploaded {formatDateUk(imp.uploaded_at.slice(0, 10))}
            {imp.reconciled_at && <> · reconciled {formatDateUk(imp.reconciled_at.slice(0, 10))}</>}
          </div>
        </div>
        <ChevronRight size={14} className="text-slate-400 shrink-0" />
      </button>
    </li>
  );
}

const STATUS_LABEL: Record<BankImport['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  reconciled: 'Reconciled',
  abandoned: 'Abandoned',
};
const STATUS_TONES: Record<BankImport['status'], { iconBg: string; iconColor: string; badgeBg: string; badgeText: string }> = {
  pending:      { iconBg: 'bg-slate-100',   iconColor: 'text-slate-500',   badgeBg: 'bg-slate-100',   badgeText: 'text-slate-600' },
  in_progress:  { iconBg: 'bg-amber-50',    iconColor: 'text-amber-700',   badgeBg: 'bg-amber-100',   badgeText: 'text-amber-800' },
  reconciled:   { iconBg: 'bg-emerald-50',  iconColor: 'text-emerald-700', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-800' },
  abandoned:    { iconBg: 'bg-slate-100',   iconColor: 'text-slate-400',   badgeBg: 'bg-slate-100',   badgeText: 'text-slate-500' },
};

