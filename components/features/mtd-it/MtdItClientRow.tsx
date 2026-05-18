'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ChevronRight, Pencil, Check, Mail, CheckCircle2, Lock, AlertTriangle, Trash2,
  Briefcase, House, Globe2, StickyNote, Loader2, X, type LucideIcon,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { getQuartersForYear, type QuarterRange } from '@/lib/mtdIt/quarters';
import { evaluateThreshold } from '@/lib/mtdIt/thresholds';
import { formatDateUk } from '@/lib/mtdIt/dateFormat';
import ClientEmailLink from './ClientEmailLink';
import type { MtdItClientRow as Row, MtdItQuarterStatus, MtdItQuarterType } from '@/types';

// Module-level set so expanded state survives parent re-renders / prop updates.
const expandedIds = new Set<string>();

export type MtdItColumnKey = 'client_ref' | 'status' | 'utr_number' | 'national_insurance_number' | 'date_of_birth' | 'address' | 'contact_email';

interface Props {
  client: Row;
  taxYear: number;
  /** Default quarter type when the client has no preference set yet */
  fallbackType?: MtdItQuarterType;
  /** Columns currently visible — name/quarters/threshold/remove are always shown */
  visibleCols: Set<MtdItColumnKey>;
  /** Total visible cells (used to colSpan empty / expanded rows) */
  totalCols: number;
  /** Unread approval-notification count for this client. Drives the
   *  "NEW APPROVAL" row badge. */
  unreadApprovals?: number;
  onOpenQuarter: (clientId: string, quarter: 1 | 2 | 3 | 4) => void;
  onEdit:   (clientId: string) => void;
  onRemove: (clientId: string) => Promise<void>;
  /** Push the latest notes value back up so the dashboard's state stays in sync. */
  onNotesSaved: (clientId: string, notes: string | null) => void;
  /** When true, the row mounts expanded and scrolls into view. Used by the
   *  client → MTD IT deep-link so the user lands directly on the right
   *  expanded panel without scrolling + clicking. */
  forceExpand?: boolean;
}

const STATUS_STYLES: Record<NonNullable<Row['status']>, { pill: string; label: string; dot: string }> = {
  active:   { pill: 'bg-green-100 text-green-700', label: 'Active',   dot: 'bg-green-500'  },
  hold:     { pill: 'bg-amber-100 text-amber-700', label: 'On Hold',  dot: 'bg-amber-500'  },
  inactive: { pill: 'bg-gray-100 text-gray-500',   label: 'Inactive', dot: 'bg-gray-400'   },
};

// DOB display — defers to the shared dd-mm-yyyy helper.
function formatDob(iso: string | null): string {
  return formatDateUk(iso);
}

// ── Mini quarter square (status indicator inline on the row) ───────────────
function MiniSquare({ status, editedAfterApproval }: { status: MtdItQuarterStatus | undefined; editedAfterApproval?: boolean }) {
  if (!status || status === 'not_started') {
    return <span className="block w-3 h-3 rounded-sm border border-gray-300 bg-white" aria-label="Not started" />;
  }
  const map: Record<Exclude<MtdItQuarterStatus, 'not_started'>, { bg: string; icon: React.ReactNode; label: string }> = {
    draft:     { bg: 'bg-amber-100 border-amber-300',  icon: <Pencil className="w-2 h-2 text-amber-600" strokeWidth={3} />, label: 'Draft' },
    complete:  { bg: 'bg-green-100 border-green-300',  icon: <Check className="w-2 h-2 text-green-700" strokeWidth={4} />,   label: 'Complete' },
    sent:      { bg: 'bg-sky-100 border-sky-300',      icon: <Mail className="w-2 h-2 text-sky-700" strokeWidth={3} />,      label: 'Sent to client' },
    approved:  { bg: 'bg-blue-100 border-blue-300',    icon: <CheckCircle2 className="w-2 h-2 text-blue-700" strokeWidth={3} />, label: 'Approved' },
    submitted: { bg: 'bg-gray-200 border-gray-400',    icon: <Lock className="w-2 h-2 text-gray-700" strokeWidth={3} />,     label: 'Submitted' },
  };
  const s = map[status];
  const tooltipLabel = editedAfterApproval ? `${s.label} — edited since approval (consider re-sending)` : s.label;
  return (
    <Tooltip label={tooltipLabel}>
      <span className={`relative flex w-3 h-3 rounded-sm border items-center justify-center ${s.bg}`} aria-label={tooltipLabel}>
        {s.icon}
        {editedAfterApproval && (
          <span aria-hidden className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-amber-500 rounded-full ring-1 ring-white" />
        )}
      </span>
    </Tooltip>
  );
}

// ── Big quarter square (in the expanded panel) ─────────────────────────────
function BigSquare({
  range, status, editedAfterApproval, onClick,
}: {
  range: QuarterRange;
  status: MtdItQuarterStatus | undefined;
  editedAfterApproval?: boolean;
  onClick: () => void;
}) {
  const colour: Record<Exclude<MtdItQuarterStatus, 'not_started'> | 'empty', { bg: string; border: string; icon: React.ReactNode; ring: string }> = {
    empty:     { bg: 'bg-white',         border: 'border-gray-200',  icon: null,                                                                ring: 'hover:ring-2 hover:ring-[var(--accent)]/30' },
    draft:     { bg: 'bg-amber-50',      border: 'border-amber-300', icon: <Pencil className="w-4 h-4 text-amber-600" />,                       ring: 'hover:ring-2 hover:ring-amber-300' },
    complete:  { bg: 'bg-green-50',      border: 'border-green-300', icon: <Check className="w-5 h-5 text-green-700" strokeWidth={3} />,        ring: 'hover:ring-2 hover:ring-green-300' },
    sent:      { bg: 'bg-sky-50',        border: 'border-sky-300',   icon: <Mail className="w-4 h-4 text-sky-700" />,                           ring: 'hover:ring-2 hover:ring-sky-300' },
    approved:  { bg: 'bg-blue-50',       border: 'border-blue-300',  icon: <CheckCircle2 className="w-5 h-5 text-blue-700" strokeWidth={2.5} />, ring: 'hover:ring-2 hover:ring-blue-300' },
    submitted: { bg: 'bg-gray-100',      border: 'border-gray-400',  icon: <Lock className="w-4 h-4 text-gray-700" />,                          ring: 'hover:ring-2 hover:ring-gray-300' },
  };
  const key: Exclude<MtdItQuarterStatus, 'not_started'> | 'empty' = (!status || status === 'not_started') ? 'empty' : status;
  const c = colour[key];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex-1 flex flex-col items-center justify-center rounded-lg border ${c.border} ${c.bg} ${c.ring} transition px-2 py-1.5 min-h-[58px] max-w-[180px]`}
    >
      <div className="text-[10px] font-semibold text-gray-500 leading-none mb-0.5">Q{range.quarter}</div>
      <div className="flex items-center justify-center h-5">
        {c.icon ?? <span className="text-base font-light text-gray-300 group-hover:text-gray-400 leading-none">+</span>}
      </div>
      <div className="text-[10px] text-gray-500 leading-none mt-0.5">{range.monthsLabel}</div>
      {editedAfterApproval && (
        <Tooltip label="Approved but edited since — consider re-sending for approval">
          <span aria-hidden className="absolute top-1 right-1 inline-flex items-center justify-center w-4 h-4 bg-amber-500 text-white rounded-full ring-2 ring-white shadow-sm">
            <AlertTriangle size={9} strokeWidth={3} />
          </span>
        </Tooltip>
      )}
    </button>
  );
}

// ── Main row ───────────────────────────────────────────────────────────────
export default function MtdItClientRow({ client, taxYear, fallbackType = 'calendar', visibleCols, totalCols, unreadApprovals = 0, onOpenQuarter, onEdit, onRemove, onNotesSaved, forceExpand }: Props) {
  const [expanded, setExpanded] = useState(() => expandedIds.has(client.id) || !!forceExpand);
  const rowRef = useRef<HTMLTableRowElement>(null);

  // Honour forceExpand on first mount and any time it flips true. Also
  // scroll the row into view so the user sees the deep-linked client
  // without having to hunt for it in a long list.
  useEffect(() => {
    if (forceExpand) {
      expandedIds.add(client.id);
      setExpanded(true);
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceExpand]);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // ── Notes inline editor ────────────────────────────────────────────────
  const [notesDraft, setNotesDraft]   = useState<string>(client.mtd_it_notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesError,  setNotesError]  = useState<string | null>(null);
  const savedNotesRef = useRef<string>(client.mtd_it_notes ?? '');
  // Keep local draft in sync if the client prop changes (e.g. after a refetch)
  useEffect(() => {
    setNotesDraft(client.mtd_it_notes ?? '');
    savedNotesRef.current = client.mtd_it_notes ?? '';
  }, [client.mtd_it_notes]);
  async function saveNotes() {
    if (notesDraft === savedNotesRef.current) return; // nothing to do
    setNotesSaving(true); setNotesError(null);
    try {
      const res = await fetch(`/api/mtd-it/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mtd_it_notes: notesDraft || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to save notes');
      }
      savedNotesRef.current = notesDraft;
      onNotesSaved(client.id, notesDraft || null);
    } catch (e) {
      setNotesError(e instanceof Error ? e.message : 'Failed to save notes');
    } finally {
      setNotesSaving(false);
    }
  }

  function toggle() {
    setExpanded(prev => {
      const next = !prev;
      if (next) expandedIds.add(client.id);
      else      expandedIds.delete(client.id);
      return next;
    });
  }

  const quarterType = client.mtd_it_quarter_type ?? fallbackType;
  const ranges = getQuartersForYear(taxYear, quarterType);
  const threshold = evaluateThreshold(client.mtd_it_prior_year_income, taxYear);
  const statusStyle = STATUS_STYLES[client.status] ?? STATUS_STYLES.active;

  async function handleRemove() {
    setRemoving(true);
    try { await onRemove(client.id); }
    finally { setRemoving(false); setConfirmRemove(false); }
  }

  return (
    <>
      <tr
        ref={rowRef}
        onClick={toggle}
        className="border-b border-gray-100 hover:bg-gray-50/70 cursor-pointer"
      >
        <td className="px-3 py-2.5 w-8">
          <ChevronRight
            size={16}
            className={`text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </td>
        <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[260px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate">{client.name}</span>
            {unreadApprovals > 0 && (
              <Tooltip label={`${unreadApprovals} new approval${unreadApprovals === 1 ? '' : 's'} — open the quarter to clear`}>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-[var(--accent)] text-white shrink-0 animate-pulse">
                  NEW
                </span>
              </Tooltip>
            )}
          </div>
        </td>
        {visibleCols.has('client_ref') && (
          <td className="px-3 py-2.5 text-gray-600 text-xs font-mono">{client.client_ref ?? '—'}</td>
        )}
        {visibleCols.has('status') && (
          <td className="px-3 py-2.5">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusStyle.pill}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
              {statusStyle.label}
            </span>
          </td>
        )}
        {visibleCols.has('utr_number') && (
          <td className="px-3 py-2.5 text-gray-600 text-xs">{client.utr_number ?? '—'}</td>
        )}
        {visibleCols.has('national_insurance_number') && (
          <td className="px-3 py-2.5 text-gray-600 text-xs">{client.national_insurance_number ?? '—'}</td>
        )}
        {visibleCols.has('date_of_birth') && (
          <td className="px-3 py-2.5 text-gray-600 text-xs">{formatDob(client.date_of_birth)}</td>
        )}
        {visibleCols.has('address') && (
          <td className="px-3 py-2.5 text-gray-600 text-xs max-w-[260px] truncate">{client.address ?? '—'}</td>
        )}
        {visibleCols.has('contact_email') && (
          <td className="px-3 py-2.5 text-gray-600 text-xs max-w-[220px] truncate">
            {client.contact_email
              ? <ClientEmailLink email={client.contact_email} client={client} className="hover:underline text-[var(--accent)] text-left truncate max-w-full" />
              : '—'}
          </td>
        )}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            {([1,2,3,4] as const).map(q => (
              <MiniSquare
                key={q}
                status={client.quarters[q]}
                editedAfterApproval={client.quarters_edited_after_approval?.[q] ?? false}
              />
            ))}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            {client.mtd_it_streams.sole && (
              <Tooltip label="Sole Trader"><span className="inline-flex"><Briefcase size={14} className="text-orange-600" aria-label="Sole Trader" /></span></Tooltip>
            )}
            {client.mtd_it_streams.uk_rental && (
              <Tooltip label="UK Rental"><span className="inline-flex"><House size={14} className="text-blue-600" aria-label="UK Rental" /></span></Tooltip>
            )}
            {client.mtd_it_streams.foreign_rental && (
              <Tooltip label="Foreign Rental"><span className="inline-flex"><Globe2 size={14} className="text-emerald-600" aria-label="Foreign Rental" /></span></Tooltip>
            )}
            {!client.mtd_it_streams.sole && !client.mtd_it_streams.uk_rental && !client.mtd_it_streams.foreign_rental && (
              <span className="text-[10px] text-gray-400">—</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 w-8">
          {threshold.belowThreshold && (
            <Tooltip label={`Prior-year income £${client.mtd_it_prior_year_income?.toLocaleString() ?? '?'} is below the ${taxYear}/${String((taxYear+1)%100).padStart(2,'0')} threshold of £${threshold.threshold.toLocaleString()}`}>
              <span className="inline-flex"><AlertTriangle size={14} className="text-amber-500" aria-label="Below MTD threshold" /></span>
            </Tooltip>
          )}
        </td>
        <td className="px-3 py-2.5 w-8" onClick={e => e.stopPropagation()}>
          <Tooltip label="Edit client details">
            <button
              onClick={() => onEdit(client.id)}
              aria-label="Edit client details"
              className="text-gray-400 hover:text-[var(--accent)] p-1 rounded hover:bg-[var(--accent-light)]/50"
            ><Pencil size={14} /></button>
          </Tooltip>
        </td>
        <td className="px-3 py-2.5 w-8" onClick={e => e.stopPropagation()}>
          <Tooltip label="Remove from MTD IT list">
            <button
              onClick={() => setConfirmRemove(true)}
              aria-label="Remove client from MTD IT list"
              className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
            ><Trash2 size={14} /></button>
          </Tooltip>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-purple-200 bg-purple-50">
          <td colSpan={totalCols} className="px-6 py-5" onClick={e => e.stopPropagation()}>
            <div className="flex gap-5">
              {/* Left: quarter squares */}
              <div className="shrink-0">
                <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2 font-semibold">
                  {taxYear}/{String((taxYear+1)%100).padStart(2,'0')} Quarters — {quarterType === 'calendar' ? 'Calendar' : 'Standard'}
                </div>
                <div className="flex gap-3">
                  {ranges.map(r => (
                    <BigSquare
                      key={r.quarter}
                      range={r}
                      status={client.quarters[r.quarter]}
                      editedAfterApproval={client.quarters_edited_after_approval?.[r.quarter] ?? false}
                      onClick={() => onOpenQuarter(client.id, r.quarter)}
                    />
                  ))}
                </div>
              </div>

              {/* Right: income streams + shared notes */}
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                {/* Income streams */}
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2 font-semibold">Income streams</div>
                  <div className="flex flex-wrap gap-1.5">
                    <StreamBadge icon={Briefcase} label="Sole Trader"     active={client.mtd_it_streams.sole} />
                    <StreamBadge icon={House}     label="UK Rental"       active={client.mtd_it_streams.uk_rental} />
                    <StreamBadge icon={Globe2}    label="Foreign Rental"  active={client.mtd_it_streams.foreign_rental} />
                  </div>
                  {!client.mtd_it_streams.sole && !client.mtd_it_streams.uk_rental && !client.mtd_it_streams.foreign_rental && (
                    <p className="text-[11px] text-gray-500 mt-1.5">
                      No streams selected yet — set them via the <Pencil size={10} className="inline -mt-0.5" /> edit pencil.
                    </p>
                  )}
                </div>

                {/* Shared notes */}
                <div className="flex-1 flex flex-col min-h-[110px]">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1.5">
                      <StickyNote size={11} /> Shared notes
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      {notesSaving && <span className="text-gray-500 inline-flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Saving…</span>}
                      {!notesSaving && notesDraft !== savedNotesRef.current && (
                        <button onClick={saveNotes} className="px-2 py-0.5 text-[var(--accent)] hover:bg-[var(--accent-light)] rounded">Save</button>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={notesDraft}
                    onChange={e => setNotesDraft(e.target.value)}
                    onBlur={saveNotes}
                    placeholder="Anything the whole firm should know about this client's MTD IT prep — visible to everyone."
                    rows={4}
                    className="flex-1 w-full px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 resize-none"
                  />
                  {notesError && (
                    <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1"><AlertTriangle size={10} /> {notesError}</p>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* ── Remove-confirm modal (rendered alongside the row, outside the table) ── */}
      {confirmRemove && (
        <tr><td colSpan={totalCols} className="p-0">
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !removing && setConfirmRemove(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                    <AlertTriangle size={18} className="text-red-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Remove from MTD IT list?</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{client.name}</p>
                  </div>
                </div>
                <button onClick={() => !removing && setConfirmRemove(false)} aria-label="Close" className="p-1 rounded hover:bg-gray-100">
                  <X size={18} className="text-gray-500" />
                </button>
              </div>
              <div className="px-5 py-4 text-sm text-gray-700 space-y-2">
                <p>This will untick the MTD IT flag on this client. The client record itself stays put.</p>
                <p>Any draft or completed quarters for this client will be hidden from the dashboard but kept in the database — they'll reappear if you re-add the client later.</p>
              </div>
              <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
                <button onClick={() => setConfirmRemove(false)} disabled={removing} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-60">Cancel</button>
                <button onClick={handleRemove} disabled={removing} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-1">
                  {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Remove client
                </button>
              </div>
            </div>
          </div>
        </td></tr>
      )}
    </>
  );
}

// ── Income-stream badge used in the expanded panel ─────────────────────────
function StreamBadge({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        active
          ? 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/40'
          : 'bg-white text-gray-400 border-gray-200'
      }`}
      aria-label={`${label} ${active ? 'enabled' : 'disabled'}`}
    >
      <Icon size={11} />
      {label}
      {!active && <span className="text-[10px] opacity-60">— off</span>}
    </span>
  );
}
