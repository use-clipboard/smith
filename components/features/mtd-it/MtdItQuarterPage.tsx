'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarCheck, ArrowLeft, Briefcase, House, Globe2, Pencil, Sparkles,
  AlertTriangle, Loader2, CheckCircle2, X, FileText, RefreshCw,
  User, Hash, FileBadge, IdCard, Cake, AtSign, MapPin, Check, FastForward,
  FilePlus2, MoreVertical, Trash2, Users, BookCopy,
  type LucideIcon,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import ToolLayout from '@/components/ui/ToolLayout';
import { fileToBase64, compressImage } from '@/utils/fileUtils';
import { spreadsheetToText, isSpreadsheetFile } from '@/utils/spreadsheetText';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import EditMtdClientModal from './EditMtdClientModal';
import MtdItPropertiesEditor from './MtdItPropertiesEditor';
import MtdItTradesEditor from './MtdItTradesEditor';
import MtdItWizardStepper, { type WizardStep } from './MtdItWizardStepper';
import MtdItReviewPhase from './MtdItReviewPhase';
import MtdItDeleteQuarterModal from './MtdItDeleteQuarterModal';
import ClientEmailLink from '@/components/features/email/ClientEmailLink';
import MtdItCoOwnerImportModal, { type ImportableSource } from './MtdItCoOwnerImportModal';
import MtdItBookkeepingImportModal from './MtdItBookkeepingImportModal';
import MtdItLandlordImportModal from './MtdItLandlordImportModal';
import { getQuarterDates, taxYearLabel } from '@/lib/mtdIt/quarters';
import { formatDateUk } from '@/lib/mtdIt/dateFormat';
import type { MtdItClientRow as Row, MtdItStream, MtdItStreams, MtdItProperty } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────
interface Props {
  clientId: string;
  taxYear: number;
  quarter: 1 | 2 | 3 | 4;
}

interface QuarterRow {
  id: string;
  client_id: string;
  tax_year: number;
  quarter: 1 | 2 | 3 | 4;
  streams_snapshot: MtdItStreams;
  consolidated: boolean;
  fx_rates: Record<string, number>;
  status: 'not_started' | 'draft' | 'complete' | 'sent' | 'approved' | 'submitted';
  notes: string | null;
}

type FileStatus = 'queued' | 'scanning' | 'done' | 'failed';
interface PendingFile {
  id:    string;
  file:  File;
  stream: MtdItStream;
  status: FileStatus;
  error?: string;
  /** Entries extracted when scanned, for the post-analyse summary */
  entryCount?: number;
}

// Phase names match the wizard stepper one-to-one once we cross into the
// review editor:
//   'done'  → stage 3 "Review & adjust" (legacy name kept for backwards-compat
//              across older imports / callbacks)
//   'send'  → stage 4 "Send to client"
//   'save'  → stage 5 "Save quarter"
// 'send' and 'save' all render the same MtdItReviewPhase component with a
// different `view` prop — keeps the loaded-once entries/trades/properties
// data centralised so each stage has the figures it needs without re-fetching.
type Phase = 'setup' | 'analysing' | 'partial' | 'done' | 'send' | 'save';

// ── Per-stream summary used by the SetupPhase header chip ───────────────
// Only counts CLEAN (non-flagged) entries so the headline numbers match
// what the review editor shows post-Save.
interface StreamSummary { income: number; expense: number; count: number; }
function emptyStreamSummary(): StreamSummary { return { income: 0, expense: 0, count: 0 }; }

// Minimal raw-entry shape returned by /api/mtd-it/entries (only the fields
// we need for the summary calculation).
interface RawEntry {
  stream: MtdItStream;
  entry_type: 'income' | 'expense';
  gross_amount: number;
  net_amount: number | null;
  vat_amount: number | null;
  currency: string;
  fx_rate: number | null;
  gbp_amount: number | null;
  flagged_reason: string | null;
  flag_dismissed: boolean | null;
}

// GBP equivalent for a single entry, applying its fx_rate (or the quarter-
// level fallback for foreign rows). Mirrors the logic in lib/mtdIt/pnl.ts.
function toGbp(e: RawEntry, fxRates: Record<string, number>): number {
  const gross = e.gross_amount || 0;
  if (e.currency === 'GBP') return gross;
  if (typeof e.gbp_amount === 'number') return e.gbp_amount;
  const rate = e.fx_rate ?? fxRates[e.currency];
  if (!rate || !Number.isFinite(rate)) return 0;
  return gross * rate;
}

function fmtMoneyGbp(amount: number): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: 'GBP',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
  } catch { return `£${amount.toFixed(2)}`; }
}

// ── Stream metadata for headings/icons ────────────────────────────────────
const STREAM_META: Record<MtdItStream, { label: string; Icon: typeof Briefcase; colour: string }> = {
  sole:           { label: 'Sole Trader',     Icon: Briefcase, colour: 'text-orange-700 bg-orange-50 border-orange-200' },
  uk_rental:      { label: 'UK Rental',       Icon: House,     colour: 'text-blue-700 bg-blue-50 border-blue-200' },
  foreign_rental: { label: 'Foreign Rental',  Icon: Globe2,    colour: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
};

let _id = 0;
const nextId = () => `pf_${++_id}`;

// Two-letter initials used in the identity-strip avatar. Falls back to "??".
function clientInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function MtdItQuarterPage({ clientId, taxYear, quarter }: Props) {
  const router = useRouter();
  // Deep-link from the approval notification: /mtd-it/.../<q>?submit=1 opens the
  // review with the Submit-to-HMRC modal ready. Consumed once on mount.
  const searchParams = useSearchParams();
  const autoOpenSubmit = searchParams?.get('submit') === '1';

  // Load client + quarter
  const [client,  setClient]  = useState<Row | null>(null);
  const [qrow,    setQrow]    = useState<QuarterRow | null>(null);
  // Importable co-owner sources for the setup-phase banner. Populated when
  // the quarter loads — empty = no banner shown.
  const [coOwnerSources, setCoOwnerSources] = useState<ImportableSource[]>([]);
  const [coOwnerImportOpen, setCoOwnerImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  // Caller's role — used to gate the admin-only Delete action in the header.
  const [userRole, setUserRole] = useState<'admin' | 'staff' | null>(null);

  const reloadClient = useCallback(async () => {
    const res = await fetch(`/api/mtd-it/clients?tax_year=${taxYear}`);
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.clients ?? []) as Row[];
    setClient(list.find(c => c.id === clientId) ?? null);
  }, [clientId, taxYear]);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        // Run in parallel: client list (already firm-scoped + RLS) + quarter create/fetch
        const [listRes, qRes] = await Promise.all([
          fetch(`/api/mtd-it/clients?tax_year=${taxYear}`),
          fetch(`/api/mtd-it/quarters?client_id=${clientId}&tax_year=${taxYear}&quarter=${quarter}`),
        ]);
        if (!listRes.ok) throw new Error('Failed to load client list');
        if (!qRes.ok)    throw new Error('Failed to load quarter');
        const listJson = await listRes.json();
        const qJson    = await qRes.json();
        const target   = ((listJson.clients ?? []) as Row[]).find(c => c.id === clientId) ?? null;
        if (!target) throw new Error('Client not found or not marked as MTD IT');
        setClient(target);
        setQrow(qJson.quarter as QuarterRow);
        setUserRole((listJson.user_role as 'admin' | 'staff') ?? 'staff');

        // A filed or client-approved quarter opens straight into the review
        // editor (which renders read-only with a "view only" banner) rather
        // than the setup screen — the user is almost always re-opening it to
        // look at the figures, not to start over.
        const qStatus = (qJson.quarter as QuarterRow).status;
        if (qStatus === 'submitted' || qStatus === 'approved') setPhase('done');

        // Look up co-owner imports for this quarter — if any linked
        // properties already have clean entries on another MTD IT client
        // for the same period, the banner offers a one-click import.
        void fetch(`/api/mtd-it/quarters/${qJson.quarter.id}/co-owner-import`)
          .then(r => r.ok ? r.json() : null)
          .then(j => { if (j && Array.isArray(j.sources)) setCoOwnerSources(j.sources as ImportableSource[]); })
          .catch(() => {});

        // Clear any unread approval notifications for this quarter as soon
        // as the preparer opens it. Best-effort — non-fatal if it fails.
        void fetch('/api/mtd-it/approvals/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quarter_id: (qJson.quarter as { id?: string })?.id }),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId, taxYear, quarter]);

  const range = useMemo(() => getQuarterDates(taxYear, quarter, client?.mtd_it_quarter_type ?? 'calendar'), [taxYear, quarter, client]);

  // ── Editor: client info ────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);

  // ── Header overflow menu (⋮) + Delete-quarter modal ───────────────────
  // The menu houses admin-only actions like "Delete quarter". Closes on
  // outside click via a ref the menu listens to.
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  // ── Phase state machine ────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('setup');

  // ── Sidebar tab indicator + browser-close warning while analysing ─────
  // useTabActivitySync drives the sidebar tab icon (spinner during processing,
  // tick when complete) and powers the in-app "this tab is still processing"
  // confirm() prompt in TabBar when the user tries to close the tab.
  const routeKey = `/mtd-it/${clientId}/${taxYear}/${quarter}`;
  const appState =
    phase === 'analysing' ? 'loading' :
    (phase === 'done' || phase === 'send' || phase === 'save') ? 'success' :
    'idle';
  useTabActivitySync(routeKey, appState);

  // Browser-level close / refresh / nav-away protection — only active while
  // analysing. Returning a string from beforeunload triggers the browser's
  // standard "Leave site? Changes you made may not be saved." dialog.
  useEffect(() => {
    if (phase !== 'analysing') return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);

  // Per-stream pending files
  const [pending, setPending] = useState<PendingFile[]>([]);
  const filesByStream = useMemo(() => {
    const m: Record<MtdItStream, PendingFile[]> = { sole: [], uk_rental: [], foreign_rental: [] };
    for (const pf of pending) m[pf.stream].push(pf);
    return m;
  }, [pending]);

  // Detected foreign currencies (driven by foreign properties)
  const [foreignProperties, setForeignProperties] = useState<MtdItProperty[]>([]);
  const detectedCurrencies = useMemo(
    () => Array.from(new Set(foreignProperties.map(p => p.currency).filter(c => c && c !== 'GBP'))),
    [foreignProperties],
  );

  // ── Existing-entries summary per stream ─────────────────────────────
  // Drives the totals chip in each StreamPanel header on the setup screen.
  // Excludes flagged (non-dismissed) entries so the headline numbers match
  // what the review editor shows after Save.
  const [streamSummary, setStreamSummary] = useState<Record<MtdItStream, StreamSummary>>({
    sole:           emptyStreamSummary(),
    uk_rental:      emptyStreamSummary(),
    foreign_rental: emptyStreamSummary(),
  });
  const loadStreamSummary = useCallback(async (quarterId: string, fxRates: Record<string, number>) => {
    try {
      const res = await fetch(`/api/mtd-it/entries?quarter_id=${quarterId}`);
      if (!res.ok) return;
      const data = await res.json();
      const next: Record<MtdItStream, StreamSummary> = {
        sole:           emptyStreamSummary(),
        uk_rental:      emptyStreamSummary(),
        foreign_rental: emptyStreamSummary(),
      };
      for (const e of (data.entries ?? []) as RawEntry[]) {
        // Exclude flagged-and-not-dismissed entries so the header total
        // mirrors the editor's "clean" totals.
        if (e.flagged_reason && !e.flag_dismissed) continue;
        const s = e.stream as MtdItStream;
        if (!next[s]) continue;
        const gbp = toGbp(e, fxRates);
        if (e.entry_type === 'income')  next[s].income  += gbp;
        if (e.entry_type === 'expense') next[s].expense += gbp;
        next[s].count += 1;
      }
      setStreamSummary(next);
    } catch { /* non-fatal — header just shows zeros */ }
  }, []);
  // Refresh whenever the quarter loads or the user comes back into Setup
  // from any later phase (Save in the review editor changes the entries).
  useEffect(() => {
    if (qrow && phase === 'setup') void loadStreamSummary(qrow.id, qrow.fx_rates ?? {});
  }, [qrow, phase, loadStreamSummary]);

  // ── Stream toggle (writes back to quarter row) ─────────────────────────
  // Turning a stream OFF that already has entries would orphan them (the editor
  // only shows active streams, yet the entries still leak into the client
  // approval page / a filing). So we confirm, then DELETE that stream's entries
  // before toggling it off. Turning a stream ON, or off when empty, is direct.
  const [streamToRemove, setStreamToRemove] = useState<{ stream: MtdItStream; count: number } | null>(null);
  const [removingStream, setRemovingStream] = useState(false);

  function applyStreamToggle(s: MtdItStream, on: boolean) {
    if (!qrow) return;
    const next = { ...qrow.streams_snapshot, [s]: on };
    setQrow({ ...qrow, streams_snapshot: next });
    void fetch(`/api/mtd-it/quarters/${qrow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streams_snapshot: next }),
    });
  }

  function toggleStream(s: MtdItStream) {
    if (!qrow) return;
    const currentlyOn = qrow.streams_snapshot[s];
    if (currentlyOn && (streamSummary[s]?.count ?? 0) > 0) {
      setStreamToRemove({ stream: s, count: streamSummary[s].count });
      return;
    }
    applyStreamToggle(s, !currentlyOn);
  }

  async function confirmStreamRemoval() {
    if (!qrow || !streamToRemove) return;
    const s = streamToRemove.stream;
    setRemovingStream(true);
    try {
      await fetch(`/api/mtd-it/entries?quarter_id=${qrow.id}&stream=${s}`, { method: 'DELETE' });
      applyStreamToggle(s, false);
      void loadStreamSummary(qrow.id, qrow.fx_rates ?? {});
    } finally {
      setRemovingStream(false);
      setStreamToRemove(null);
    }
  }

  // ── FX rates (per-quarter, per currency) ──────────────────────────────
  function setFxRate(currency: string, rate: number) {
    if (!qrow) return;
    const next = { ...qrow.fx_rates, [currency]: rate };
    setQrow({ ...qrow, fx_rates: next });
    void fetch(`/api/mtd-it/quarters/${qrow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fx_rates: next }),
    });
  }

  // ── File uploads ───────────────────────────────────────────────────────
  function addFiles(stream: MtdItStream, files: FileList | null) {
    if (!files || files.length === 0) return;
    const additions: PendingFile[] = [];
    for (let i = 0; i < files.length; i++) {
      additions.push({ id: nextId(), file: files[i], stream, status: 'queued' });
    }
    setPending(prev => [...prev, ...additions]);
  }
  function removeFile(id: string) {
    setPending(prev => prev.filter(p => p.id !== id));
  }

  // ── Analyse pipeline ───────────────────────────────────────────────────
  const activeStreams = useMemo<MtdItStream[]>(() => {
    if (!qrow) return [];
    const out: MtdItStream[] = [];
    if (qrow.streams_snapshot.sole)           out.push('sole');
    if (qrow.streams_snapshot.uk_rental)      out.push('uk_rental');
    if (qrow.streams_snapshot.foreign_rental) out.push('foreign_rental');
    return out;
  }, [qrow]);

  const totalFiles = pending.length;
  const filesToScanCount = pending.filter(p => p.status === 'queued' || p.status === 'failed').length;

  const analyseControllerRef = useRef<AbortController | null>(null);

  async function uploadOne(pf: PendingFile, abort: AbortController): Promise<void> {
    if (!qrow) return;
    setPending(prev => prev.map(p => p.id === pf.id ? { ...p, status: 'scanning', error: undefined } : p));
    try {
      const isImage = pf.file.type.startsWith('image/');
      const file = isImage ? await compressImage(pf.file) : pf.file;
      // Spreadsheets/CSV: send the original base64 (preserves the source doc for
      // the viewer) plus the converted text (what Claude actually reads).
      const filePayload = isSpreadsheetFile(pf.file)
        ? { name: pf.file.name, mimeType: pf.file.type || 'text/csv', base64: await fileToBase64(file), text: await spreadsheetToText(pf.file) }
        : { name: pf.file.name, mimeType: pf.file.type || 'application/octet-stream', base64: await fileToBase64(file) };
      const res = await fetch('/api/mtd-it/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          quarter_id: qrow.id,
          stream: pf.stream,
          file: filePayload,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Analyse failed');
      setPending(prev => prev.map(p => p.id === pf.id ? { ...p, status: 'done', entryCount: j.entry_count ?? 0 } : p));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setPending(prev => prev.map(p => p.id === pf.id ? { ...p, status: 'failed', error: e instanceof Error ? e.message : 'Failed' } : p));
    }
  }

  async function runAnalyse() {
    if (!qrow || filesToScanCount === 0) return;
    setPhase('analysing');
    const abort = new AbortController();
    analyseControllerRef.current = abort;

    // Fire all queued/failed files in parallel (across streams)
    const targets = pending.filter(p => p.status === 'queued' || p.status === 'failed');
    await Promise.all(targets.map(t => uploadOne(t, abort)));

    // Decide next phase: partial if any failed, done otherwise
    setPending(prev => {
      const anyFailed = prev.some(p => p.status === 'failed');
      setPhase(anyFailed ? 'partial' : 'done');
      return prev;
    });
  }

  function cancelAnalyse() {
    analyseControllerRef.current?.abort();
    setPending(prev => prev.map(p => p.status === 'scanning' ? { ...p, status: 'queued', error: undefined } : p));
    setPhase('setup');
  }

  // ── Stage B exit: save as draft + go back to dashboard ────────────────
  // The quarter row was created with status='draft' on first visit; we PATCH
  // it again here so the timestamp on the row gets bumped (the dashboard
  // sorts by recent activity later in Stage C). The full review/edit screen
  // lives in Stage C — for now finishing just gets the user back to a
  // familiar place with the orange-pencil indicator on the quarter square.
  async function finishQuarter() {
    if (!qrow) return;
    try {
      await fetch(`/api/mtd-it/quarters/${qrow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
    } catch { /* non-fatal — quarter already exists as draft */ }
    router.push('/mtd-it');
  }

  // ── Skip analyse: jump straight to the review/save step ───────────────
  // Used when the user has no documents to scan (manual entry only) or the
  // quarter is empty. The proper review/manual-entry editor is Stage C; for
  // now we mark the quarter as draft and route back to the dashboard so the
  // orange-pencil indicator appears and the user can come back later.
  async function skipToReview() {
    if (!qrow) return;
    // Move the wizard forward visually before the network hop
    setPhase('done');
    try {
      await fetch(`/api/mtd-it/quarters/${qrow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
    } catch { /* non-fatal */ }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return <ToolLayout title="MTD IT — Quarter" icon={CalendarCheck} iconColor="#2563eb" wide>
      <div className="py-16 text-center text-sm text-gray-500"><Loader2 size={16} className="inline animate-spin mr-2" /> Loading…</div>
    </ToolLayout>;
  }
  if (error || !client || !qrow) {
    return <ToolLayout title="MTD IT — Quarter" icon={CalendarCheck} iconColor="#2563eb" wide>
      <div className="py-16 text-center text-sm text-red-600 flex items-center justify-center gap-2">
        <AlertTriangle size={16} /> {error ?? 'Failed to load'}
      </div>
    </ToolLayout>;
  }

  return (
    <ToolLayout
      title={`MTD IT — ${client.name} — Q${quarter} ${taxYearLabel(taxYear)}`}
      description={`${formatDateUk(range.from)} → ${formatDateUk(range.to)}`}
      icon={CalendarCheck}
      iconColor="#2563eb"
      wide
      headerRight={
        <div className="flex items-center gap-1">
          <button
            onClick={() => router.push('/mtd-it')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] rounded-lg"
          ><ArrowLeft size={14} /> Back to dashboard</button>
          {/* Admin-only overflow menu — Delete quarter (and future admin
              actions) live here. Non-admins don't see the button at all. */}
          {userRole === 'admin' && (
            <div className="relative" ref={menuRef}>
              <Tooltip label="Quarter actions">
                <button
                  onClick={() => setMenuOpen(o => !o)}
                  aria-label="Quarter actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] rounded-lg"
                ><MoreVertical size={16} /></button>
              </Tooltip>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  <button
                    onClick={() => { setMenuOpen(false); setShowDeleteModal(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50 text-left"
                  >
                    <Trash2 size={14} /> Delete quarter…
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      }
    >
      {/* ── Client details + wizard, in one card ──────────────────────────
          The identity strip + wizard stepper share a single bordered card
          with a thin divider between them. Always visible regardless of
          phase, so the user can refer to or edit client details at any
          stage of the workflow. */}
      <div className="relative bg-white/85 backdrop-blur-md border border-gray-200 rounded-xl mb-4 shadow-sm overflow-hidden">
        {/* Left accent stripe — full height of the merged card */}
        <div aria-hidden className="absolute left-0 top-0 bottom-0 w-1" style={{ background: 'var(--accent)' }} />

        {/* Identity strip */}
        <div className="flex items-start gap-4 pl-3 pr-4 py-4">
          {/* Initials avatar */}
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 70%, black) 100%)' }}
            aria-hidden
          >
            {clientInitials(client.name)}
          </div>
          <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-3">
            <Cell icon={User}     label="Name"      value={client.name} />
            <Cell icon={Hash}     label="Code"      value={client.client_ref} mono />
            <Cell icon={FileBadge} label="UTR"      value={client.utr_number} />
            <Cell icon={IdCard}   label="NI Number" value={client.national_insurance_number} />
            <Cell icon={Cake}     label="DOB"       value={formatDateUk(client.date_of_birth, '')} />
            <Cell icon={AtSign}   label="Email"     value={client.contact_email} emailClient={client} cols={2} />
            <Cell icon={MapPin}   label="Address"   value={client.address} cols={3} />
          </div>
          <Tooltip label="Edit client details">
            <button
              onClick={() => setEditing(true)}
              aria-label="Edit client details"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--accent)] bg-[var(--accent-light)] hover:bg-[var(--accent-light)]/80 border border-[var(--accent)]/30 rounded-lg shrink-0"
            ><Pencil size={12} /> Edit</button>
          </Tooltip>
        </div>

        {/* Faint divider */}
        <div aria-hidden className="border-t border-gray-100 ml-3" />

        {/* Wizard stepper — same card, lower section */}
        <div className="px-3 pt-3 pb-2">
          <MtdItWizardStepper
            current={(
              phase === 'setup'     ? 'setup'   :
              phase === 'analysing' ? 'analyse' :
              phase === 'partial'   ? 'analyse' :
              phase === 'send'      ? 'send'    :
              phase === 'save'      ? 'save'    :
              /* done */              'review'
            ) as WizardStep}
            notYetAvailable={[]}
            navigable={['setup', 'analyse', 'review', 'send', 'save']}
            onStepClick={(step) => {
              // Step navigation — covers Stages A/B/C/D/E.
              //   setup   → setPhase('setup')
              //   analyse → kicks off a scan if anything's queued, else
              //             drops to setup so the user can add files
              //   review  → jumps to the review editor (phase 'done')
              //   send    → jumps to the send-to-client preview
              //   save    → jumps to the final save / complete stage
              // 'submit' stays locked.
              if (step === 'setup') {
                setPhase('setup');
              } else if (step === 'analyse') {
                if (filesToScanCount > 0) runAnalyse();
                else setPhase('setup');
              } else if (step === 'review') {
                setPhase('done');
              } else if (step === 'send') {
                setPhase('send');
              } else if (step === 'save') {
                setPhase('save');
              }
            }}
          />
        </div>
      </div>

      {/* Co-owner import banner — only on setup phase, only when we found
          importable sources, and only before the user has started analysing.
          The banner sits above the setup card so it's the first thing they
          see when opening a shared-property client. */}
      {phase === 'setup' && coOwnerSources.length > 0 && (
        <div className="mb-3 flex items-center gap-3 px-4 py-3 bg-[var(--accent-light)] border border-[var(--accent)]/30 rounded-xl">
          <div className="w-8 h-8 rounded-full bg-white text-[var(--accent)] flex items-center justify-center shrink-0">
            <Users size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              Co-owner data available for import
            </div>
            <div className="text-xs text-gray-700 mt-0.5">
              {coOwnerSources.length} shared propert{coOwnerSources.length !== 1 ? 'ies' : 'y'} already analysed for this quarter by{' '}
              {Array.from(new Set(coOwnerSources.map(s => s.source_client_name))).slice(0, 2).join(', ')}
              {Array.from(new Set(coOwnerSources.map(s => s.source_client_name))).length > 2 && ' + others'}
              . Skip rescanning — pull their clean entries across with one click.
            </div>
          </div>
          <button
            onClick={() => setCoOwnerImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 shrink-0"
          >
            Review import
          </button>
          <button
            onClick={() => setCoOwnerSources([])}
            className="text-xs text-gray-500 hover:text-gray-700 shrink-0"
            aria-label="Dismiss"
          >Dismiss</button>
        </div>
      )}

      {phase === 'setup' && (
        <SetupPhase
          qrow={qrow}
          clientId={clientId}
          activeStreams={activeStreams}
          filesByStream={filesByStream}
          detectedCurrencies={detectedCurrencies}
          streamSummary={streamSummary}
          onToggleStream={toggleStream}
          onFxChange={setFxRate}
          onAddFiles={addFiles}
          onRemoveFile={removeFile}
          onForeignPropertiesChange={setForeignProperties}
          onImported={() => { void loadStreamSummary(qrow.id, qrow.fx_rates ?? {}); }}
          onAnalyse={runAnalyse}
          onSkip={skipToReview}
        />
      )}

      {(phase === 'analysing' || phase === 'partial') && (
        <ProgressPhase
          phase={phase}
          pending={pending}
          activeStreams={activeStreams}
          totalFiles={totalFiles}
          filesToScanCount={filesToScanCount}
          onCancel={cancelAnalyse}
          onReplaceFile={(id, newFile) => setPending(prev => prev.map(p => p.id === id ? { ...p, file: newFile, status: 'queued', error: undefined } : p))}
          onRemoveFailed={removeFile}
          onCarryOn={() => setPhase('done')}
          onRescan={runAnalyse}
          onBackToSetup={() => setPhase('setup')}
          onFinish={finishQuarter}
        />
      )}

      {/* Stages C / D / E: review editor + send-to-client preview + save
          quarter. All three render the same MtdItReviewPhase component with
          a `view` prop so the underlying entries/trades/properties stay
          loaded once and the user can hop between them via the wizard. */}
      {(phase === 'done' || phase === 'send' || phase === 'save') && (
        <MtdItReviewPhase
          quarterId={qrow.id}
          clientId={clientId}
          rangeFrom={range.from}
          rangeTo={range.to}
          streams={qrow.streams_snapshot}
          fxRates={qrow.fx_rates}
          initialConsolidated={qrow.consolidated}
          clientName={client.name}
          clientRef={client.client_ref}
          clientEmail={client.contact_email}
          quarterLabel={`Q${quarter}`}
          taxYearLabel={taxYearLabel(taxYear)}
          quarter={quarter}
          taxYear={taxYear}
          quarterStatus={qrow.status}
          autoOpenSubmit={autoOpenSubmit}
          view={phase === 'send' ? 'send' : phase === 'save' ? 'save' : 'edit'}
          onProceedToSend={() => setPhase('send')}
          onProceedToSave={() => setPhase('save')}
          onBackToReview={() => setPhase('done')}
          onBackToSend={() => setPhase('send')}
          onBackToSetup={() => setPhase('setup')}
          onFinished={() => { router.push('/mtd-it'); }}
        />
      )}

      {/* ── Edit modal ───────────────────────────────────────────────── */}
      {editing && (
        <EditMtdClientModal
          client={client}
          onClose={() => setEditing(false)}
          onSaved={() => { void reloadClient(); }}
        />
      )}

      {/* Co-owner import modal — opened from the setup-phase banner. After
          a successful import we refresh the stream summary so the "already
          saved" totals reflect the new entries, and clear the sources so
          the banner doesn't keep nudging the user. */}
      {coOwnerImportOpen && qrow && (
        <MtdItCoOwnerImportModal
          quarterId={qrow.id}
          sources={coOwnerSources}
          quarterLabel={`Q${quarter}`}
          taxYearLabel={taxYearLabel(taxYear)}
          onClose={() => setCoOwnerImportOpen(false)}
          onImported={() => {
            setCoOwnerSources([]);
            if (qrow) void loadStreamSummary(qrow.id, qrow.fx_rates ?? {});
          }}
        />
      )}

      {/* ── Delete quarter (admin only) ─────────────────────────────────
          Server enforces the admin check as well; this UI gate is just to
          keep the option hidden for staff users. */}
      {showDeleteModal && qrow && (
        <MtdItDeleteQuarterModal
          quarterId={qrow.id}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            // Quarter gone — return to the dashboard so the user can't keep
            // poking at a now-invalid record.
            router.push('/mtd-it');
          }}
        />
      )}

      {/* Confirm removing a stream that still has entries. */}
      {streamToRemove && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-start gap-3 p-5">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900">Remove {STREAM_META[streamToRemove.stream].label}?</h2>
                <p className="mt-1 text-sm text-gray-600">
                  This stream has <strong>{streamToRemove.count}</strong> {streamToRemove.count === 1 ? 'entry' : 'entries'}. Removing it will <strong>permanently delete</strong> {streamToRemove.count === 1 ? 'it' : 'them'} from this quarter. This can&apos;t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setStreamToRemove(null)}
                disabled={removingStream}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >Cancel</button>
              <button
                onClick={() => void confirmStreamRemoval()}
                disabled={removingStream}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {removingStream ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Remove &amp; delete entries
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolLayout>
  );
}

// ── Identity-strip cell ────────────────────────────────────────────────
// Each cell renders a tiny lucide icon next to its label so the strip reads
// at a glance. The icon prop is optional so existing call sites without an
// icon still work.
function Cell({ icon: Icon, label, value, mono, fullSpan, cols, emailClient }: { icon?: LucideIcon; label: string; value: string | null; mono?: boolean; fullSpan?: boolean; cols?: 2 | 3 | 4; emailClient?: { id: string; name: string; client_ref: string | null; contact_email: string | null } }) {
  const spanCls = fullSpan
    ? 'col-span-2 md:col-span-5'
    : cols === 4 ? 'col-span-2 md:col-span-4'
    : cols === 3 ? 'col-span-2 md:col-span-3'
    : cols === 2 ? 'col-span-2 md:col-span-2'
    : '';
  return (
    <div className={spanCls}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
        {Icon && <Icon size={10} className="text-gray-400" />}
        {label}
      </div>
      <div className={`text-sm text-gray-800 truncate mt-0.5 ${mono ? 'font-mono' : ''}`}>
        {value
          ? (emailClient
              ? <ClientEmailLink email={value} client={emailClient} className="hover:underline text-[var(--accent)] text-left truncate max-w-full" />
              : value)
          : <span className="text-gray-300">—</span>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SETUP PHASE — toggles + per-stream panels + sticky action bar
// ──────────────────────────────────────────────────────────────────────────
// Layout:
//   1. Stream selector — three big toggle cards, click to activate a stream.
//   2. One panel per active stream, fading in below. Each panel groups
//      everything relevant to that stream: trades (sole) or properties (UK /
//      foreign), FX rates (foreign), and the file uploader.
//   3. Sticky action bar at the bottom with the primary Analyse CTA and a
//      secondary "Skip to review & adjust" link for empty / manual quarters.
function SetupPhase(props: {
  qrow: QuarterRow;
  clientId: string;
  activeStreams: MtdItStream[];
  filesByStream: Record<MtdItStream, PendingFile[]>;
  detectedCurrencies: string[];
  /** Per-stream clean-entries summary (income, expense, count). Surfaces in
   *  the StreamPanel header so the user can tell at a glance that work has
   *  already been done on this quarter. */
  streamSummary: Record<MtdItStream, StreamSummary>;
  onToggleStream: (s: MtdItStream) => void;
  onFxChange: (currency: string, rate: number) => void;
  onAddFiles: (s: MtdItStream, files: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  onForeignPropertiesChange: (props: MtdItProperty[]) => void;
  onImported: () => void;
  onAnalyse: () => void;
  onSkip: () => void;
}) {
  const { qrow, clientId, activeStreams, filesByStream, detectedCurrencies, streamSummary, onToggleStream, onFxChange, onAddFiles, onRemoveFile, onForeignPropertiesChange, onImported, onAnalyse, onSkip } = props;
  const totalActiveFiles = activeStreams.reduce((acc, s) => acc + filesByStream[s].length, 0);
  const canAnalyse = activeStreams.length > 0 && totalActiveFiles > 0;

  return (
    <>
      {/* ── Stream selector ──────────────────────────────────────────── */}
      <Section
        title="Income streams"
        hint="Pick which apply for this quarter. Defaults come from the client record — toggling here only changes this quarter."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(['sole', 'uk_rental', 'foreign_rental'] as MtdItStream[]).map(s => {
            const M = STREAM_META[s];
            const active = qrow.streams_snapshot[s];
            return (
              <button
                key={s}
                onClick={() => onToggleStream(s)}
                aria-pressed={active}
                className={`group relative flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-200 ${
                  active
                    ? `${M.colour} shadow-sm`
                    : 'bg-white/85 backdrop-blur-md border-gray-200 text-gray-700 hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${active ? 'bg-white/70' : 'bg-gray-50 group-hover:bg-gray-100'}`}>
                  <M.Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight">{M.label}</div>
                  <div className="text-[11px] opacity-70 mt-0.5">{STREAM_DESCRIPTION[s]}</div>
                </div>
                {/* Active-state tick — always uses the SMITH accent purple so
                    the white check is guaranteed visible regardless of the
                    stream's accent colour. */}
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${active ? 'border-2 border-transparent' : 'border-2 border-gray-300 bg-white'}`}
                  style={active ? { background: 'var(--accent)' } : undefined}
                >
                  {active && <Check size={12} strokeWidth={3} className="text-white" />}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── Per-stream panels ─────────────────────────────────────────────
          Each active stream collapses its trades/properties/FX/uploads into
          a single coloured panel so the user thinks in terms of streams, not
          individual config sections. */}
      <div className="space-y-3">
        {(['sole', 'uk_rental', 'foreign_rental'] as MtdItStream[]).map(s => {
          if (!qrow.streams_snapshot[s]) return null;
          return (
            <StreamPanel
              key={s}
              stream={s}
              qrow={qrow}
              clientId={clientId}
              files={filesByStream[s]}
              summary={streamSummary[s]}
              detectedCurrencies={detectedCurrencies}
              onFxChange={onFxChange}
              onAddFiles={onAddFiles}
              onRemoveFile={onRemoveFile}
              onForeignPropertiesChange={onForeignPropertiesChange}
              onImported={onImported}
            />
          );
        })}

        {activeStreams.length === 0 && (
          <div className="bg-white/85 backdrop-blur-md border border-dashed border-gray-300 rounded-xl px-6 py-10 text-center">
            <p className="text-sm text-gray-500">Pick at least one income stream above to configure this quarter.</p>
          </div>
        )}
      </div>

      {/* ── Sticky action bar ─────────────────────────────────────────────
          Pinned to the bottom-left of the viewport. Width hugs its contents
          and the bar is anchored with `mr-auto` so it never collides with
          the bottom-right Ask Smith floating button. */}
      <div className="sticky bottom-0 z-10 -mx-6 px-6 py-3 mt-6 pointer-events-none">
        <div className="flex items-center gap-3 bg-white/85 backdrop-blur-md border border-gray-200 rounded-xl p-3 shadow-lg pointer-events-auto w-fit max-w-[min(640px,calc(100%-9rem))] mr-auto">
          {/* Status block */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 leading-tight">Ready when you are</div>
              <div className="text-xs text-gray-500 mt-0.5 truncate">
                {activeStreams.length === 0
                  ? 'Pick at least one stream to begin.'
                  : totalActiveFiles === 0
                    ? 'Add a document, or skip if there\'s nothing to scan.'
                    : `${totalActiveFiles} file${totalActiveFiles === 1 ? '' : 's'} · ${activeStreams.length} stream${activeStreams.length === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>
          {/* Primary CTA */}
          <button
            disabled={!canAnalyse}
            onClick={onAnalyse}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
          >
            <Sparkles size={14} /> Analyse
          </button>
          {/* Skip — symmetric padding so the icon is centred at rest (creates
              a ~34×36 near-circle) and the label slides out cleanly from the
              right via a max-width transition. The gap between icon and label
              lives inside the expanding span so it collapses with it. */}
          <button
            onClick={onSkip}
            aria-label="Skip to review & adjust"
            title="Skip to review & adjust"
            className="group inline-flex items-center h-9 pl-2.5 pr-2.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shrink-0 overflow-hidden whitespace-nowrap"
          >
            <FastForward size={14} className="shrink-0" />
            <span className="max-w-0 group-hover:max-w-[10rem] group-focus-visible:max-w-[10rem] overflow-hidden transition-[max-width] duration-200 ease-out">
              <span className="pl-2 pr-1">Skip to review & adjust</span>
            </span>
          </button>
        </div>
      </div>
    </>
  );
}

// One-line strapline shown under each stream's name in the selector cards.
const STREAM_DESCRIPTION: Record<MtdItStream, string> = {
  sole:           'Trading income & business expenses',
  uk_rental:      'Income & costs from UK property',
  foreign_rental: 'Property income & costs outside the UK',
};

// ── Per-stream panel ───────────────────────────────────────────────────
// Wraps everything for one income stream into a single bordered card.
// The body keeps its plain white background so editors / inputs stay
// readable, but the coloured header strip is anchored to its own border
// colour and the whole card sits with a tinted outer shadow / accent stripe.
const STREAM_BORDER: Record<MtdItStream, string> = {
  sole:           'border-orange-200',
  uk_rental:      'border-blue-200',
  foreign_rental: 'border-emerald-200',
};
function StreamPanel(props: {
  stream: MtdItStream;
  qrow: QuarterRow;
  clientId: string;
  files: PendingFile[];
  /** Clean (non-flagged) entry totals already saved on the quarter. Empty
   *  zeros when there are no existing entries — header just shows file count. */
  summary: StreamSummary;
  detectedCurrencies: string[];
  onFxChange: (currency: string, rate: number) => void;
  onAddFiles: (s: MtdItStream, files: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  onForeignPropertiesChange: (props: MtdItProperty[]) => void;
  onImported: () => void;
}) {
  const { stream, qrow, clientId, files, summary, detectedCurrencies, onFxChange, onAddFiles, onRemoveFile, onForeignPropertiesChange, onImported } = props;
  const [showImport, setShowImport] = useState(false);
  const [showLandlordImport, setShowLandlordImport] = useState(false);
  const M = STREAM_META[stream];
  const net = summary.income - summary.expense;
  const hasEntries = summary.count > 0;

  return (
    <section className={`bg-white/85 backdrop-blur-md border-2 ${STREAM_BORDER[stream]} rounded-xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200`}>
      {/* Panel header — full coloured stripe so each stream's section reads
          as a distinct visual zone, not just another white card. When the
          stream already has entries saved on it, we add an inline totals
          strip so the user sees at a glance that work has been done. */}
      <header className={`flex items-center gap-2.5 px-4 py-2.5 ${M.colour}`}>
        <div className="w-8 h-8 rounded-lg bg-white/80 flex items-center justify-center shadow-sm shrink-0">
          <M.Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{M.label}</div>
          <div className="text-[11px] opacity-70">{STREAM_DESCRIPTION[stream]}</div>
        </div>
        {hasEntries && (
          <Tooltip label="These are the totals from entries already analysed or manually added on this quarter — not the files queued below.">
            <div className="hidden md:flex items-stretch gap-3 mr-2 cursor-help">
              {/* Small chip prefixing the totals so the user knows these are
                  figures from work already on the quarter, not the queued
                  uploads waiting to be analysed. */}
              <span className="self-center text-[9px] font-semibold uppercase tracking-wider bg-white/80 text-gray-700 px-2 py-1 rounded-full">
                Already saved
              </span>
              <SummaryStat label="Income"  value={fmtMoneyGbp(summary.income)}  tone="text-green-700" />
              <span aria-hidden className="w-px bg-white/50 self-stretch" />
              <SummaryStat label="Expense" value={fmtMoneyGbp(summary.expense)} tone="text-red-700" />
              <span aria-hidden className="w-px bg-white/50 self-stretch" />
              <SummaryStat label="Net"     value={fmtMoneyGbp(net)}              tone={net >= 0 ? '' : 'text-red-700'} />
            </div>
          </Tooltip>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          {hasEntries && (
            <Tooltip label="Transactions already saved on this quarter (analysed or added manually)">
              <div className="text-[11px] font-medium opacity-80 px-2 py-0.5 bg-white/60 rounded-full cursor-help">
                {summary.count} saved
              </div>
            </Tooltip>
          )}
          <Tooltip label="Files queued for the next Analyse run (not yet scanned)">
            <div className="text-[11px] font-medium opacity-80 px-2 py-0.5 bg-white/60 rounded-full cursor-help">
              {files.length} queued
            </div>
          </Tooltip>
        </div>
      </header>

      {/* When the stream has saved entries, also surface a compact mobile-friendly
          totals row below the header (since the inline strip above is hidden on
          narrow widths). */}
      {hasEntries && (
        <div className="md:hidden px-4 py-2 border-b border-gray-100 bg-white">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Already saved on this quarter</div>
          <div className="grid grid-cols-3 gap-2">
            <SummaryStat label="Income"  value={fmtMoneyGbp(summary.income)}  tone="text-green-700" centered />
            <SummaryStat label="Expense" value={fmtMoneyGbp(summary.expense)} tone="text-red-700"   centered />
            <SummaryStat label="Net"     value={fmtMoneyGbp(net)}              tone={net >= 0 ? '' : 'text-red-700'} centered />
          </div>
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Trades / Properties */}
        {stream === 'sole' && (
          <SubSection title="Trades" hint="Add each separate business — figures get split per HMRC's per-trade rules.">
            <MtdItTradesEditor clientId={clientId} />
          </SubSection>
        )}
        {stream === 'uk_rental' && (
          <SubSection title="Properties" hint="Tag each UK property with its ownership % so shared portfolios get applied automatically.">
            <MtdItPropertiesEditor clientId={clientId} filter="uk" />
          </SubSection>
        )}
        {stream === 'foreign_rental' && (
          <>
            <SubSection title="Properties" hint="Set the currency on each property — amounts stay in source currency until you set the FX rate below.">
              <MtdItPropertiesEditor clientId={clientId} filter="foreign" onChange={onForeignPropertiesChange} />
            </SubSection>
            {detectedCurrencies.length > 0 && (
              <SubSection title="FX rates" hint="1 unit of foreign currency → GBP. Used at quarter-close to consolidate totals.">
                <div className="flex flex-wrap gap-2">
                  {detectedCurrencies.map(c => (
                    <label key={c} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                      <span className="font-mono text-xs w-10 text-amber-900">{c}</span>
                      <span className="text-gray-400 text-xs">→ GBP</span>
                      <input
                        type="number"
                        step="0.0001"
                        min={0}
                        defaultValue={qrow.fx_rates[c] ?? ''}
                        onBlur={e => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v > 0) onFxChange(c, v);
                        }}
                        placeholder="0.0000"
                        className="w-24 px-2 py-1 text-sm border border-amber-300 bg-white rounded focus:outline-none focus:ring-2 focus:ring-amber-300/50"
                      />
                    </label>
                  ))}
                </div>
              </SubSection>
            )}
          </>
        )}

        {/* Import from Bookkeeping — sole trader only. Greyed-out / coming-soon
            until the Bookkeeping module is fully released; once live this will
            pull the trade's income & expenses for the period straight from its
            ledger instead of (or alongside) uploading documents. */}
        {stream === 'sole' && (
          <SubSection title="Import" hint="Pull figures straight from another SMITH tool instead of uploading documents.">
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-50 transition-colors text-left"
            >
              <BookCopy size={15} className="shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold">Import from Bookkeeping</div>
                <div className="text-[11px] text-indigo-600/80">Pull this trade&apos;s income &amp; expenses for the quarter from its ledger.</div>
              </div>
            </button>
            <MtdItBookkeepingImportModal
              quarterId={qrow.id}
              open={showImport}
              onClose={() => setShowImport(false)}
              onImported={() => { setShowImport(false); onImported(); }}
            />
          </SubSection>
        )}

        {/* Import from Landlord — UK property. Pulls a saved Landlord Analysis's
            transactions that fall in this quarter into the property entries. */}
        {stream === 'uk_rental' && (
          <SubSection title="Import" hint="Pull figures straight from another SMITH tool instead of uploading documents.">
            <button
              type="button"
              onClick={() => setShowLandlordImport(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50/50 text-amber-800 hover:bg-amber-50 transition-colors text-left"
            >
              <House size={15} className="shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold">Import from Landlord</div>
                <div className="text-[11px] text-amber-700/80">Pull this client&apos;s rental income &amp; expenses for the quarter from a saved Landlord Analysis.</div>
              </div>
            </button>
            <MtdItLandlordImportModal
              quarterId={qrow.id}
              open={showLandlordImport}
              onClose={() => setShowLandlordImport(false)}
              onImported={() => { setShowLandlordImport(false); onImported(); }}
            />
          </SubSection>
        )}

        {/* Documents */}
        <SubSection title="Documents" hint="PDFs, images, spreadsheets, or WhatsApp exports. Each file is scanned on its own.">
          <UploadZone
            accept=".pdf,image/*,.csv,.xls,.xlsx,.txt"
            onFiles={fl => onAddFiles(stream, fl)}
          />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map(pf => (
                <li
                  key={pf.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  <FileText size={12} className="text-gray-400 shrink-0" />
                  <span className="flex-1 truncate text-gray-700">{pf.file.name}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{formatBytes(pf.file.size)}</span>
                  <button
                    onClick={() => onRemoveFile(pf.id)}
                    aria-label="Remove file"
                    className="p-0.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  ><X size={11} /></button>
                </li>
              ))}
            </ul>
          )}
        </SubSection>
      </div>
    </section>
  );
}

// ── Upload zone with drag-drop visual cue ──────────────────────────────
function UploadZone({ accept, onFiles }: { accept: string; onFiles: (files: FileList | null) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <label
      onDragOver={e => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={e => { e.preventDefault(); setHover(false); onFiles(e.dataTransfer.files); }}
      className={`flex flex-col items-center justify-center gap-1.5 px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer text-sm transition-all ${
        hover
          ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
          : 'border-gray-200 bg-gray-50/50 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <input
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={e => { onFiles(e.target.files); e.target.value = ''; }}
      />
      <FilePlus2 size={20} className={hover ? 'text-[var(--accent)]' : 'text-gray-400'} />
      <span className="font-medium">
        {hover ? 'Drop to add' : 'Click or drag files here'}
      </span>
      <span className="text-[11px] text-gray-500">PDF · images · CSV / Excel · WhatsApp text</span>
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Section heading with optional hint — used both at the top of the page and
// inside per-stream panels (for trades, properties, FX, documents).
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
        {hint && <p className="text-xs text-[var(--text-muted)] mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function SubSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5">
        <h4 className="text-[11px] uppercase tracking-wide font-semibold text-gray-700">{title}</h4>
        {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// Small stat block used in the StreamPanel header to surface income/expense/net
// totals when the stream already has saved entries. `centered` swaps to a
// stacked, text-centred layout for the mobile fallback row below the header.
function SummaryStat({ label, value, tone, centered }: { label: string; value: string; tone?: string; centered?: boolean }) {
  return (
    <div className={`flex ${centered ? 'flex-col items-center' : 'flex-col items-start'} justify-center leading-tight`}>
      <span className="text-[9px] uppercase tracking-wide opacity-70">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// PROGRESS / PARTIAL / DONE PHASE
// ──────────────────────────────────────────────────────────────────────────
function ProgressPhase(props: {
  phase: 'analysing' | 'partial' | 'done';
  pending: PendingFile[];
  activeStreams: MtdItStream[];
  totalFiles: number;
  filesToScanCount: number;
  onCancel: () => void;
  onReplaceFile: (id: string, newFile: File) => void;
  onRemoveFailed: (id: string) => void;
  onCarryOn: () => void;
  onRescan: () => void;
  onBackToSetup: () => void;
  onFinish: () => void;
}) {
  const { phase, pending, activeStreams, onCancel, onReplaceFile, onRemoveFailed, onCarryOn, onRescan, onBackToSetup, onFinish } = props;
  const filesByStream = useMemo(() => {
    const m: Record<MtdItStream, PendingFile[]> = { sole: [], uk_rental: [], foreign_rental: [] };
    for (const pf of pending) m[pf.stream].push(pf);
    return m;
  }, [pending]);

  const done = pending.filter(p => p.status === 'done').length;
  const failed = pending.filter(p => p.status === 'failed').length;
  const scanning = pending.filter(p => p.status === 'scanning').length;
  const totalEntries = pending.reduce((acc, p) => acc + (p.entryCount ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Header / progress summary */}
      <div className={`rounded-xl border p-4 ${phase === 'done' ? 'bg-green-50 border-green-200' : phase === 'partial' ? 'bg-amber-50 border-amber-200' : 'bg-purple-50 border-purple-200'}`}>
        <div className="flex items-center gap-3">
          {phase === 'analysing' && <Loader2 size={18} className="text-[var(--accent)] animate-spin" />}
          {phase === 'partial'   && <AlertTriangle size={18} className="text-amber-600" />}
          {phase === 'done'      && <CheckCircle2 size={18} className="text-green-700" />}
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">
              {phase === 'analysing' && `Analysing — ${done}/${pending.length} done${scanning ? `, ${scanning} scanning` : ''}${failed ? `, ${failed} failed` : ''}`}
              {phase === 'partial'   && `${failed} file${failed === 1 ? '' : 's'} failed`}
              {phase === 'done'      && `Analysis complete — ${totalEntries} entr${totalEntries === 1 ? 'y' : 'ies'} extracted across ${activeStreams.length} stream${activeStreams.length === 1 ? '' : 's'}.`}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">
              {phase === 'analysing' && 'Each file is scanned independently. You can cancel at any time.'}
              {phase === 'partial'   && 'Choose to carry on with what worked, or replace the failed files and rescan only those.'}
              {phase === 'done'      && 'Entries are saved to the database. The full review / edit screen lands in the next stage.'}
            </div>
          </div>
          {phase === 'analysing' && (
            <button onClick={onCancel} className="text-xs px-2.5 py-1 rounded text-gray-600 hover:bg-gray-100">Cancel</button>
          )}
          {phase === 'partial' && (
            <div className="flex gap-2">
              <button onClick={onCarryOn} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Carry on without them</button>
              <button onClick={onRescan} className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 inline-flex items-center gap-1"><RefreshCw size={12} /> Rescan failed</button>
            </div>
          )}
          {phase === 'done' && (
            <div className="flex gap-2">
              <button onClick={onBackToSetup} className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Add more files</button>
              <button onClick={onFinish} className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 inline-flex items-center gap-1">
                <CheckCircle2 size={14} /> Save as draft &amp; back to dashboard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Per-stream columns */}
      <div className={`grid gap-3 ${activeStreams.length === 3 ? 'md:grid-cols-3' : activeStreams.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
        {activeStreams.map(s => {
          const M = STREAM_META[s];
          const files = filesByStream[s];
          return (
            <div key={s} className={`rounded-xl border p-3 ${M.colour}`}>
              <div className="flex items-center gap-1.5 text-xs font-semibold mb-2">
                <M.Icon size={14} /> {M.label}
                <span className="ml-auto text-[11px] text-gray-500 font-normal">{files.filter(f => f.status === 'done').length}/{files.length} done</span>
              </div>
              {files.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No files for this stream.</p>
              ) : (
                <ul className="space-y-1">
                  {files.map(pf => <FileRow key={pf.id} pf={pf} onReplaceFile={onReplaceFile} onRemoveFailed={onRemoveFailed} canEdit={phase !== 'analysing'} />)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileRow({ pf, onReplaceFile, onRemoveFailed, canEdit }: {
  pf: PendingFile;
  onReplaceFile: (id: string, newFile: File) => void;
  onRemoveFailed: (id: string) => void;
  canEdit: boolean;
}) {
  return (
    <li className="flex items-center gap-1.5 px-2 py-1.5 bg-white border border-gray-200 rounded text-xs">
      <FileText size={11} className="text-gray-400 shrink-0" />
      <span className="flex-1 truncate text-gray-700">{pf.file.name}</span>
      {pf.status === 'queued'   && <span className="text-[10px] text-gray-500">Queued</span>}
      {pf.status === 'scanning' && <span className="inline-flex items-center gap-1 text-[10px] text-[var(--accent)]"><Loader2 size={9} className="animate-spin" /> Scanning…</span>}
      {pf.status === 'done'     && (
        <span className="inline-flex items-center gap-1 text-[10px] text-green-700">
          <CheckCircle2 size={10} /> {pf.entryCount ?? 0} entr{(pf.entryCount ?? 0) === 1 ? 'y' : 'ies'}
        </span>
      )}
      {pf.status === 'failed' && (
        <Tooltip label={pf.error ?? 'Failed'}>
          <span className="inline-flex items-center gap-1 text-[10px] text-red-700"><AlertTriangle size={10} /> Failed</span>
        </Tooltip>
      )}
      {pf.status === 'failed' && canEdit && (
        <>
          <label className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer">
            Replace
            <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onReplaceFile(pf.id, f); e.target.value = ''; }} />
          </label>
          <button onClick={() => onRemoveFailed(pf.id)} aria-label="Remove" className="p-0.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50">
            <X size={10} />
          </button>
        </>
      )}
    </li>
  );
}
