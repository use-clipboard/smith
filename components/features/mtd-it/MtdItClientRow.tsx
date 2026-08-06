'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ChevronRight, Pencil, Check, Mail, CheckCircle2, Lock, AlertTriangle, Trash2,
  Briefcase, House, Globe2, StickyNote, Loader2, X, Search, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { collectFraudData } from '@/lib/hmrc/clientFraudData';
import { getQuartersForYear, type QuarterRange } from '@/lib/mtdIt/quarters';
import { evaluateThreshold } from '@/lib/mtdIt/thresholds';
import { formatDateUk } from '@/lib/mtdIt/dateFormat';
import ClientEmailLink from '@/components/features/email/ClientEmailLink';
import MtdItSubmissionSummaryModal from './MtdItSubmissionSummaryModal';
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
  /** Reload the dashboard after HMRC discovery/mapping changes a client's sources. */
  onRefresh?: () => void;
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

const SOURCE_TYPE_LABEL: Record<'self-employment' | 'uk-property' | 'foreign-property', string> = {
  'self-employment': 'Sole trade', 'uk-property': 'UK property', 'foreign-property': 'Foreign property',
};

// HMRC-setup status from income-source mapping progress.
function hmrcSetup(sources?: { total: number; mapped: number }): { key: 'ready' | 'unmapped' | 'not_discovered'; label: string; pill: string; dot: string } {
  const total = sources?.total ?? 0, mapped = sources?.mapped ?? 0;
  if (total > 0 && mapped === total) return { key: 'ready',         label: 'Ready',          pill: 'bg-green-100 text-green-700', dot: 'bg-green-500' };
  if (total > 0)                     return { key: 'unmapped',      label: 'Unmapped',       pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' };
  return                                    { key: 'not_discovered', label: 'Not discovered', pill: 'bg-rose-100 text-rose-700',  dot: 'bg-rose-500' };
}

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
    approved:  { bg: 'bg-violet-100 border-violet-300', icon: <CheckCircle2 className="w-2 h-2 text-violet-700" strokeWidth={3} />, label: 'Approved' },
    submitted: { bg: 'bg-green-500 border-green-600',   icon: <CheckCircle2 className="w-2 h-2 text-white" strokeWidth={3} />,  label: 'Submitted to HMRC' },
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
    approved:  { bg: 'bg-violet-50',     border: 'border-violet-300', icon: <CheckCircle2 className="w-5 h-5 text-violet-700" strokeWidth={2.5} />, ring: 'hover:ring-2 hover:ring-violet-300' },
    submitted: { bg: 'bg-green-500',     border: 'border-green-600', icon: <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={2.5} />,    ring: 'hover:ring-2 hover:ring-green-300' },
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
export default function MtdItClientRow({ client, taxYear, fallbackType = 'calendar', visibleCols, totalCols, unreadApprovals = 0, onOpenQuarter, onEdit, onRemove, onNotesSaved, onRefresh, forceExpand }: Props) {
  const [expanded, setExpanded] = useState(() => expandedIds.has(client.id) || !!forceExpand);
  const rowRef = useRef<HTMLTableRowElement>(null);
  const setup = hmrcSetup(client.sources);
  // Streams toggled on (manually) that have no linked HMRC source of that type.
  const sourceTypes = new Set((client.source_list ?? []).filter(s => s.business_id).map(s => s.type));
  const streamWarnings: string[] = [];
  if (client.mtd_it_streams.sole && !sourceTypes.has('self-employment')) streamWarnings.push('Sole Trader');
  if (client.mtd_it_streams.uk_rental && !sourceTypes.has('uk-property')) streamWarnings.push('UK Rental');
  if (client.mtd_it_streams.foreign_rental && !sourceTypes.has('foreign-property')) streamWarnings.push('Foreign Rental');

  // HMRC discover + auto-map, run from the expanded panel for this one client.
  const [hmrcBusy, setHmrcBusy] = useState(false);
  const [hmrcMsg, setHmrcMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Sandbox Gov-Test-Scenario for "List All Businesses" (Business Details v2.0).
  // Lets sandbox testing surface property businesses the default test user lacks.
  // Ignored by HMRC in production. Values are the exact scenario enums from the
  // Business Details API spec.
  const [discoverScenario, setDiscoverScenario] = useState('');
  // Filing-summary lightbox for an already-submitted quarter.
  const [summaryQuarter, setSummaryQuarter] = useState<{ id: string; label: string; quarter: 1 | 2 | 3 | 4 } | null>(null);
  const taxYearLabel = `${taxYear}/${String((taxYear + 1) % 100).padStart(2, '0')}`;
  async function discoverAndMap() {
    setHmrcBusy(true); setHmrcMsg(null);
    try {
      const fraudData = collectFraudData();
      const dr = await fetch('/api/mtd-it/agent/discover-businesses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds: [client.id], fraudData, testScenario: discoverScenario || undefined }),
      });
      const dd = await dr.json().catch(() => ({}));
      if (!dr.ok) { setHmrcMsg({ kind: 'err', text: dd.error ?? 'Discovery failed.' }); return; }
      const o = (dd.results ?? [])[0] as { status?: string; businesses?: { businessId?: string; typeOfBusiness?: string; tradingName?: string }[]; error?: string } | undefined;
      if (!o || o.status !== 'ok') {
        setHmrcMsg({ kind: 'err', text: o?.status === 'needs_auth' ? 'Not authorised for this client at HMRC.' : o?.status === 'missing_nino' ? 'Add a NINO first (edit pencil).' : (o?.error ?? 'No businesses found.') });
        return;
      }
      if (!o.businesses?.length) { setHmrcMsg({ kind: 'err', text: 'No HMRC businesses found for this client.' }); return; }
      const mr = await fetch('/api/mtd-it/agent/auto-map', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.id, businesses: o.businesses }),
      });
      const md = await mr.json().catch(() => ({}));
      if (!mr.ok) { setHmrcMsg({ kind: 'err', text: md.error ?? 'Mapping failed.' }); return; }
      const linked = md.linked?.length ?? 0, created = md.created?.length ?? 0, attn = md.mismatches?.length ?? 0;
      const parts = [linked ? `linked ${linked}` : '', created ? `created ${created}` : ''].filter(Boolean);
      setHmrcMsg({ kind: 'ok', text: `${parts.length ? parts.join(' · ') : 'Nothing to link'}${attn ? ` · ${attn} to review` : ''}.` });
      onRefresh?.();
    } finally { setHmrcBusy(false); }
  }
  // Drop this client's own connection so it falls back to the firm agent.
  async function switchToAgent() {
    setHmrcBusy(true); setHmrcMsg(null);
    try {
      const r = await fetch('/api/hmrc/disconnect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'mtd_it', kind: 'individual', clientId: client.id }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setHmrcMsg({ kind: 'err', text: d.error ?? 'Could not switch.' }); return; }
      setHmrcMsg({ kind: 'ok', text: 'Now using the firm agent connection.' });
      onRefresh?.();
    } finally { setHmrcBusy(false); }
  }

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
          <td className="px-3 py-2.5 text-gray-600 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-mono">{client.client_ref ?? '—'}</span>
              <Tooltip label={`Client status: ${statusStyle.label}`}>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${statusStyle.pill}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                  {statusStyle.label}
                </span>
              </Tooltip>
            </div>
          </td>
        )}
        {visibleCols.has('status') && (
          <td className="px-3 py-2.5">
            <Tooltip label={setup.key === 'ready' ? 'All income sources linked to HMRC — ready to file' : setup.key === 'unmapped' ? 'Has income sources not yet linked to an HMRC business — expand to map' : 'No HMRC businesses discovered/mapped yet — expand to discover'}>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${setup.pill}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${setup.dot}`} />
                {setup.label}{client.sources && client.sources.total > 0 ? ` ${client.sources.mapped}/${client.sources.total}` : ''}
              </span>
            </Tooltip>
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
                      onClick={() => {
                        // A submitted quarter opens its filing summary, not the editor.
                        const qid = client.quarter_ids?.[r.quarter];
                        if (client.quarters[r.quarter] === 'submitted' && qid) {
                          setSummaryQuarter({ id: qid, label: `Q${r.quarter}`, quarter: r.quarter });
                        } else {
                          onOpenQuarter(client.id, r.quarter);
                        }
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Right: details + income streams + HMRC + shared notes */}
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                {/* Client details (moved off the row to keep it uncluttered) */}
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2 font-semibold">Client details</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                    <div><span className="text-gray-400 block text-[10px] uppercase tracking-wide">UTR</span><span className="text-gray-700">{client.utr_number ?? '—'}</span></div>
                    <div><span className="text-gray-400 block text-[10px] uppercase tracking-wide">NI Number</span><span className="text-gray-700">{client.national_insurance_number ?? '—'}</span></div>
                    <div><span className="text-gray-400 block text-[10px] uppercase tracking-wide">DOB</span><span className="text-gray-700">{formatDob(client.date_of_birth)}</span></div>
                    <div className="min-w-0"><span className="text-gray-400 block text-[10px] uppercase tracking-wide">Email</span>
                      {client.contact_email
                        ? <ClientEmailLink email={client.contact_email} client={client} className="hover:underline text-[var(--accent)] text-left truncate block max-w-full" />
                        : <span className="text-gray-700">—</span>}
                    </div>
                  </div>
                </div>

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

                {/* HMRC mapping */}
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2 font-semibold flex items-center gap-1.5">
                    <ShieldCheck size={11} /> HMRC mapping
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${setup.pill}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${setup.dot}`} />
                      {setup.label}{client.sources && client.sources.total > 0 ? ` · ${client.sources.mapped}/${client.sources.total} sources` : ''}
                    </span>
                    {(setup.key !== 'ready' || discoverScenario) && (
                      <Tooltip label="Fetch this client's HMRC businesses and link them to their trades/properties. Requires the agent connection.">
                        <button
                          onClick={discoverAndMap}
                          disabled={hmrcBusy}
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                        >
                          {hmrcBusy ? <Loader2 size={12} className="animate-spin" /> : setup.key === 'unmapped' ? <Check size={12} /> : <Search size={12} />}
                          {setup.key === 'ready' ? 'Re-discover' : setup.key === 'unmapped' ? 'Map remaining' : 'Discover & map'}
                        </button>
                      </Tooltip>
                    )}
                    {/* Sandbox-only Gov-Test-Scenario for discovery — lets test users
                        surface property businesses. HMRC ignores it in production. */}
                    <Tooltip label="Sandbox only — sets HMRC's Gov-Test-Scenario so discovery returns test businesses (e.g. property). Ignored in production.">
                      <select
                        value={discoverScenario}
                        onChange={e => setDiscoverScenario(e.target.value)}
                        aria-label="Sandbox test scenario"
                        className="text-[11px] px-1.5 py-1 border border-slate-200 rounded bg-white text-slate-500"
                      >
                        <option value="">Sandbox: default (SE)</option>
                        <option value="BUSINESS_AND_PROPERTY">Sandbox: SE + UK + foreign property</option>
                        <option value="PROPERTY">Sandbox: UK property</option>
                        <option value="FOREIGN_PROPERTY">Sandbox: foreign property</option>
                      </select>
                    </Tooltip>
                  </div>

                  {/* Which income sources are linked to which HMRC business. */}
                  {(client.source_list && client.source_list.length > 0) && (
                    <ul className="mt-1.5 space-y-0.5">
                      {client.source_list.map((s, i) => (
                        <li key={i} className="text-[11px] flex items-center gap-1.5">
                          {s.business_id
                            ? <Check size={11} className="text-green-600 shrink-0" />
                            : <AlertTriangle size={11} className="text-amber-500 shrink-0" />}
                          <span className="text-gray-700">{s.name}</span>
                          <span className="text-gray-400">{SOURCE_TYPE_LABEL[s.type]}</span>
                          {s.business_id
                            ? <span className="font-mono text-gray-500">{s.business_id}</span>
                            : <span className="text-amber-700">not linked</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Streams switched on manually but with no linked HMRC source. */}
                  {streamWarnings.length > 0 && (
                    <p className="text-[11px] text-amber-700 mt-1 inline-flex items-start gap-1">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {streamWarnings.join(', ')} {streamWarnings.length === 1 ? 'is' : 'are'} switched on but not linked to an HMRC business.
                    </p>
                  )}
                  {hmrcMsg && (
                    <p className={`text-[11px] mt-1.5 inline-flex items-start gap-1 ${hmrcMsg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {hmrcMsg.kind === 'ok' ? <Check size={11} className="mt-0.5" /> : <AlertTriangle size={11} className="mt-0.5" />} {hmrcMsg.text}
                    </p>
                  )}
                  {/* Authorise via the firm agent connection, or this client's own login. */}
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                    <span>Authorise via:</span>
                    <span className="font-medium text-gray-700">{client.has_individual_connection ? 'This client’s own login' : 'Firm agent connection'}</span>
                    {client.has_individual_connection ? (
                      <button
                        onClick={switchToAgent}
                        disabled={hmrcBusy}
                        className="text-indigo-700 hover:underline disabled:opacity-50"
                      >Switch to firm agent</button>
                    ) : (
                      <a
                        href={`/api/hmrc/connect?service=mtd_it&kind=individual&clientId=${client.id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-indigo-700 hover:underline"
                      >Use this client’s own login</a>
                    )}
                  </div>
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
      {summaryQuarter && (
        <tr><td colSpan={totalCols} className="p-0" onClick={e => e.stopPropagation()}>
          <MtdItSubmissionSummaryModal
            quarterId={summaryQuarter.id}
            quarter={summaryQuarter.quarter}
            clientName={client.name}
            quarterLabel={summaryQuarter.label}
            taxYearLabel={taxYearLabel}
            onClose={() => setSummaryQuarter(null)}
            onReopen={(q) => { setSummaryQuarter(null); onOpenQuarter(client.id, q); }}
          />
        </td></tr>
      )}

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
