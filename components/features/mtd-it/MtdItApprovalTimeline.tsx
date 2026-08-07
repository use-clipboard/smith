'use client';

/**
 * MtdItApprovalTimeline — the approval history for a single quarter, shown on
 * the Send-to-client step.
 *
 * Why this exists: the review screen only ever showed the LATEST approval, and
 * the "client requested changes" note only reached the person who emailed the
 * client (a per-user notification). So a colleague picking the job up couldn't
 * see what the client had asked for. Every send round is already persisted
 * (mtd_it_quarter_approvals, one row per send, firm-readable) — this surfaces
 * the whole lot to everyone: who sent each round and when, whether/when it was
 * approved, and, most importantly, the exact change-request text and its date.
 *
 * Read-only; data comes from GET /api/mtd-it/quarters/[id]/approvals.
 */

import { useEffect, useState } from 'react';
import {
  Mail, CheckCircle2, AlertTriangle, Loader2, ChevronDown, ChevronRight,
  BellRing, History,
} from 'lucide-react';

interface ApprovalRow {
  id: string;
  sent_at: string;
  sent_by: string | null;
  recipient_email: string | null;
  cover_note: string | null;
  approved_at: string | null;
  changes_requested_at: string | null;
  changes_note: string | null;
  voided_at: string | null;
  edited_since_approved_at: string | null;
  reminder_count: number;
  last_reminder_at: string | null;
  expires_at: string | null;
  sender: { full_name: string | null; email: string } | null;
}

// dd-mm-yyyy HH:mm — approval events are worth showing to the minute.
function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Outcome = 'approved' | 'changes_requested' | 'superseded' | 'pending';
function outcomeOf(r: ApprovalRow): Outcome {
  if (r.changes_requested_at) return 'changes_requested';
  if (r.approved_at) return 'approved';
  if (r.voided_at) return 'superseded';
  return 'pending';
}

const DOT: Record<Outcome, string> = {
  approved:          'bg-violet-500 border-violet-500',
  changes_requested: 'bg-amber-500 border-amber-500',
  superseded:        'bg-gray-300 border-gray-300',
  pending:           'bg-sky-500 border-sky-500',
};

function OutcomeLine({ r }: { r: ApprovalRow }) {
  const o = outcomeOf(r);
  if (o === 'approved') {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-violet-700">
        <CheckCircle2 size={13} className="shrink-0" /> Approved on {fmt(r.approved_at)}
      </p>
    );
  }
  if (o === 'changes_requested') {
    return (
      <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
          <AlertTriangle size={13} className="shrink-0" /> Changes requested on {fmt(r.changes_requested_at)}
        </p>
        {r.changes_note?.trim()
          ? <p className="mt-1 text-xs text-amber-900 whitespace-pre-wrap break-words">{r.changes_note}</p>
          : <p className="mt-1 text-xs italic text-amber-700/80">No note was left with the request.</p>}
      </div>
    );
  }
  if (o === 'superseded') {
    return <p className="text-xs text-gray-400">Superseded by a later send on {fmt(r.voided_at)}</p>;
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-sky-700">
      <Loader2 size={12} className="shrink-0 animate-spin" /> Awaiting the client&rsquo;s response
    </p>
  );
}

export default function MtdItApprovalTimeline({
  quarterId,
  reloadKey = 0,
  defaultOpen = true,
}: {
  quarterId: string;
  /** Bump to refetch — e.g. after a new approval email goes out. */
  reloadKey?: number;
  defaultOpen?: boolean;
}) {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    let aborted = false;
    setError(false);
    fetch(`/api/mtd-it/quarters/${quarterId}/approvals`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(j => { if (!aborted) setRows((j?.approvals ?? []) as ApprovalRow[]); })
      .catch(() => { if (!aborted) setError(true); });
    return () => { aborted = true; };
  }, [quarterId, reloadKey]);

  // Nothing has ever been sent — no timeline to show. Stay silent rather than
  // render an empty shell on a brand-new quarter.
  if (rows !== null && rows.length === 0) return null;

  const total = rows?.length ?? 0;
  // Any live (non-voided) change request is what the team most needs to see.
  const openChangeRequest = rows?.find(r => r.changes_requested_at && !r.voided_at) ?? null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        <History size={14} className="text-gray-500" />
        <span className="text-sm font-semibold text-gray-800">Approval history</span>
        {total > 0 && (
          <span className="text-[11px] text-gray-500">· {total} {total === 1 ? 'send' : 'sends'}</span>
        )}
        {openChangeRequest && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            <AlertTriangle size={11} /> Changes requested
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-3 py-3">
          {rows === null && !error && (
            <p className="flex items-center gap-2 py-2 text-xs text-gray-500">
              <Loader2 size={13} className="animate-spin" /> Loading history…
            </p>
          )}
          {error && (
            <p className="flex items-center gap-2 py-2 text-xs text-red-600">
              <AlertTriangle size={13} /> Couldn&rsquo;t load the approval history.
            </p>
          )}
          {rows && rows.length > 0 && (
            <ol className="relative space-y-4">
              {rows.map((r, i) => {
                const round = total - i; // rows are newest-first
                const o = outcomeOf(r);
                const sentBy = r.sender?.full_name?.trim() || r.sender?.email || 'a team member';
                return (
                  <li key={r.id} className="relative flex gap-3">
                    {/* rail */}
                    <div className="flex flex-col items-center">
                      <span className={`mt-0.5 h-2.5 w-2.5 rounded-full border ${DOT[o]}`} />
                      {i < rows.length - 1 && <span className="mt-0.5 w-px flex-1 bg-gray-200" />}
                    </div>
                    {/* content */}
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-baseline gap-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-gray-800">
                          <Mail size={12} className="shrink-0 text-gray-400" />
                          Sent for approval
                        </p>
                        <span className="text-[10px] uppercase tracking-wide text-gray-400">Round {round}</span>
                        <span className="ml-auto text-[11px] tabular-nums text-gray-500">{fmt(r.sent_at)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        by <span className="font-medium text-gray-700">{sentBy}</span>
                        {r.recipient_email && <> to <span className="font-medium text-gray-700">{r.recipient_email}</span></>}
                        {r.reminder_count > 0 && (
                          <> · <BellRing size={10} className="inline -mt-0.5" /> {r.reminder_count} reminder{r.reminder_count === 1 ? '' : 's'}{r.last_reminder_at ? ` (last ${fmt(r.last_reminder_at)})` : ''}</>
                        )}
                      </p>
                      {r.cover_note?.trim() && (
                        <p className="mt-0.5 text-[11px] text-gray-500 italic break-words">“{r.cover_note.trim()}”</p>
                      )}
                      <div className="mt-1.5">
                        <OutcomeLine r={r} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
