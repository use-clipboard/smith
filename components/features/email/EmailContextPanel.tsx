'use client';

/**
 * EmailContextPanel — the collapsible right-hand panel in Email Triage.
 *
 * Phase 1 surfaces the per-thread context that used to be buried in the reader
 * toolbar: the allocated CLIENT(S) (with an at-a-glance snapshot of the primary
 * — open tasks, documents, last activity), any LINKED TASKS, and the thread's
 * TAGS (Gmail user labels). The reader keeps the *actions* (Allocate, Create
 * Task, Reply…); this panel owns the *context display*. AI Summary + suggested
 * actions land here in Phase 2.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  User, X, ExternalLink, CheckSquare, FileText, Clock, Tag, Plus, UserPlus, PanelRightClose,
  Sparkles, RefreshCw, ArrowRight, Loader2, Users,
} from 'lucide-react';
import { useTabContext, type Tab } from '@/components/ui/TabContext';
import { openTaskInTool } from '@/lib/notificationTarget';
import { iconFor, buildMetaMap, metaFor, type CategoryDef, type EmailCategory } from './emailCategories';

export type SummaryActionType = 'reply' | 'reply_all' | 'forward' | 'task' | 'allocate';
export interface SummaryAction { label: string; type: SummaryActionType; }
export interface AiSummary { state: 'loading' | 'error' | 'ready'; summary?: string; actions?: SummaryAction[]; }

export interface Allocation {
  client_id: string;
  clients: { id: string; name: string; client_ref: string | null; risk_rating: string | null } | null;
}
export interface TaskLink {
  task_id: string;
  tasks: { id: string; title: string; status: string } | null;
}

interface Snapshot {
  openTasks: number;
  /** Files in the `documents` table (uploaded through the AI tools / client
   *  portal) — available to every firm regardless of active modules. */
  documents: number;
  /** The client's last 3 AI-tool runs — same source as the dashboard's
   *  Recent Activity widget (the outputs table). Empty = section hidden. */
  recentActivity: { id: string; label: string; at: string }[];
}

interface Props {
  allocations: Allocation[];
  taskLinks: TaskLink[];
  threadLabelIds: string[];
  userLabels: { id: string; name: string }[];
  aiSummary?: AiSummary;
  /** The user's ordered category list (incl. the fixed anchors). */
  categories: CategoryDef[];
  category?: EmailCategory;
  onCategoryChange?: (c: EmailCategory) => void;
  onAllocate: () => void;
  onRemoveAllocation: (clientId: string) => void;
  onRemoveTaskLink: (taskId: string) => void;
  onAddLabel?: (labelId: string) => void;
  onRemoveLabel?: (labelId: string) => void;
  onRegenerateSummary?: () => void;
  onSummaryAction?: (action: SummaryAction) => void;
  onClose: () => void;
}

const RISK_BADGE: Record<string, string> = {
  Low:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  High:   'bg-red-50 text-red-700 border-red-200',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md bg-[var(--accent-light)] flex items-center justify-center">{icon}</span>
        <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
      </div>
      {action}
    </div>
  );
}

export default function EmailContextPanel({
  allocations, taskLinks, threadLabelIds, userLabels, aiSummary, categories, category,
  onCategoryChange, onAllocate, onRemoveAllocation, onRemoveTaskLink, onAddLabel, onRemoveLabel,
  onRegenerateSummary, onSummaryAction, onClose,
}: Props) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Which allocation is currently shown in the Client panel. null = the real
  // primary (first allocation). Clicking an "Also allocated" client focuses it
  // here; the original then drops into the list as a green "primary" chip.
  const [focusedClientId, setFocusedClientId] = useState<string | null>(null);
  // "View client" must go through the tab system: a plain <Link> changes the
  // URL but the tab reconciler only MATCHES existing tabs mid-session — it
  // never creates one. So ensure the Clients workspace tab exists first, then
  // navigate to the specific client (the reconciler records the deep URL).
  const router = useRouter();
  const { openInNewTab } = useTabContext();
  function handleViewClient(clientId: string) {
    // If the tab limit blocked the Clients tab, do NOT navigate — the URL
    // would change with no tab matching it, leaving the sidebar highlighting
    // Clients while the content still shows the active tab.
    const opened = openInNewTab({ id: 'clients', title: 'Clients', route: '/clients', icon: Users as Tab['icon'] });
    if (opened) router.push(`/clients/${clientId}`);
  }
  // Add-tag menu is portalled to <body> with fixed coords so it floats over the
  // email instead of being clipped by the panel's scroll container.
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  function openAddMenu() {
    const r = addBtnRef.current?.getBoundingClientRect();
    if (r) {
      const width = 192;   // w-48
      const menuH = 248;   // max-h-60 + padding
      const left = Math.max(8, r.right - width);
      // Flip the menu up when there isn't room below (the Labels section sits
      // near the bottom of the panel, so it'd otherwise open off-screen).
      const top = (window.innerHeight - r.bottom) >= menuH + 8 ? r.bottom + 4 : Math.max(8, r.top - menuH - 4);
      setMenuPos({ top, left });
    }
    setAddOpen(true);
  }

  // De-duplicate allocations by client (a thread can carry per-message rows).
  const seen = new Set<string>();
  const uniqueAllocations = allocations.filter(a => {
    if (!a.clients || seen.has(a.client_id)) return false;
    seen.add(a.client_id);
    return true;
  });
  // The real (original) primary is always the first allocation; `focusedClientId`
  // can temporarily promote another allocation into the panel for viewing.
  const realPrimaryId = uniqueAllocations[0]?.client_id ?? null;
  const focusedAlloc =
    (focusedClientId && uniqueAllocations.find(a => a.client_id === focusedClientId)) ||
    uniqueAllocations[0] || null;
  const primary = focusedAlloc?.clients ?? null;
  // Everything except the one currently in the panel, original first.
  const extras = uniqueAllocations.filter(a => a.client_id !== focusedAlloc?.client_id);

  // Reset the focus when the email/allocation set changes so we don't carry a
  // stale focus onto a different thread.
  useEffect(() => { setFocusedClientId(null); }, [realPrimaryId, uniqueAllocations.length]);

  useEffect(() => {
    if (!primary) { setSnap(null); return; }
    let active = true;
    setSnap(null);
    fetch(`/api/clients/${primary.id}/snapshot`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active) setSnap(d); })
      .catch(() => {});
    return () => { active = false; };
  }, [primary?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagLabels = userLabels.filter(l => threadLabelIds.includes(l.id));
  const addableLabels = userLabels.filter(l => !threadLabelIds.includes(l.id));

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 space-y-4">
      {/* Collapse control */}
      <div className="flex justify-end -mb-2">
        <button
          onClick={onClose}
          aria-label="Hide panel"
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {/* ── AI Summary ─────────────────────────────────────────────────── */}
      {aiSummary && (
        <div className="glass rounded-xl p-4">
          <SectionHeader
            icon={<Sparkles size={13} className="text-[var(--accent)]" />}
            title="AI Summary"
            action={onRegenerateSummary && aiSummary.state !== 'loading' && (
              <button
                onClick={onRegenerateSummary}
                className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
              >
                <RefreshCw size={11} /> Regenerate
              </button>
            )}
          />

          {aiSummary.state === 'loading' ? (
            <div className="flex items-center gap-2 py-2 text-[var(--text-muted)]">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">Summarising thread…</span>
            </div>
          ) : aiSummary.state === 'error' ? (
            <div className="flex items-center justify-between gap-2 py-1">
              <p className="text-xs text-[var(--text-muted)]">Couldn&apos;t summarise this thread.</p>
              {onRegenerateSummary && (
                <button onClick={onRegenerateSummary} className="text-xs text-[var(--accent)] hover:underline shrink-0">Retry</button>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
                {aiSummary.summary || 'No summary available.'}
              </p>
              {(aiSummary.actions?.length ?? 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Suggested actions</p>
                  <div className="flex flex-wrap gap-2">
                    {aiSummary.actions!.map((a, i) => (
                      <button
                        key={i}
                        onClick={() => onSummaryAction?.(a)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/60 border border-[var(--border-card)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
                      >
                        {a.label} <ArrowRight size={11} className="text-[var(--accent)]" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Category (heuristic / AI, with manual override) ────────────── */}
      {category && onCategoryChange && (() => {
        const metaMap = buildMetaMap(categories);
        const current = metaFor(metaMap, category);
        const CatIcon = iconFor(current.iconName);
        return (
          <div className="glass rounded-xl p-4">
            <SectionHeader
              icon={<CatIcon size={13} style={{ color: current.color }} />}
              title="Category"
            />
            <select
              value={category}
              onChange={e => onCategoryChange(e.target.value as EmailCategory)}
              className="w-full text-sm rounded-lg border border-[var(--border-input)] bg-white/60 px-3 py-2 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            >
              {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        );
      })()}

      {/* ── Client ─────────────────────────────────────────────────────── */}
      <div className="glass rounded-xl p-4">
        <SectionHeader
          icon={<User size={13} className="text-[var(--accent)]" />}
          title="Client"
          action={primary && (
            <button onClick={() => handleViewClient(primary.id)} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
              View client <ExternalLink size={10} />
            </button>
          )}
        />

        {!primary ? (
          <div className="text-center py-4">
            <p className="text-xs text-[var(--text-muted)] mb-3">This email isn&apos;t allocated to a client yet.</p>
            <button
              onClick={onAllocate}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              <UserPlus size={12} /> Allocate to client
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate flex-1">{primary.name}</p>
              {primary.risk_rating && (
                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${RISK_BADGE[primary.risk_rating] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                  {primary.risk_rating}
                </span>
              )}
              <button
                onClick={() => onRemoveAllocation(primary.id)}
                aria-label="Remove allocation"
                className="shrink-0 p-0.5 rounded text-[var(--text-muted)] hover:text-red-500 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
            {primary.client_ref && (
              <p className="text-xs text-[var(--text-muted)] font-mono mb-3">{primary.client_ref}</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <SnapStat icon={<CheckSquare size={13} className="text-[var(--accent)]" />} value={snap?.openTasks} label="Open tasks" />
              <SnapStat icon={<FileText size={13} className="text-[var(--accent)]" />} value={snap?.documents} label="Documents" />
            </div>

            {(snap?.recentActivity?.length ?? 0) > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Recent activity</p>
                <div className="space-y-1.5">
                  {snap!.recentActivity.map(a => (
                    <div key={a.id} className="flex items-start gap-2">
                      <Clock size={13} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-[var(--text-primary)] truncate">{a.label}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{timeAgo(a.at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {extras.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Also allocated</p>
                <div className="flex flex-wrap gap-1.5">
                  {extras.map(a => a.clients && (
                    // Original allocation shows green (so you can spot it after
                    // swapping); others are neutral. Click the name to view that
                    // client in the panel above; the X still removes it.
                    <span
                      key={a.client_id}
                      className={`inline-flex items-center gap-1 text-[11px] font-medium pl-2 pr-1.5 py-0.5 rounded-md border ${
                        a.client_id === realPrimaryId
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-[var(--accent-light)] text-[var(--accent)] border-transparent'
                      }`}
                    >
                      <button
                        onClick={() => setFocusedClientId(a.client_id)}
                        aria-label={`View ${a.clients.name}`}
                        className="hover:underline"
                      >
                        {a.clients.name}
                        {a.clients.client_ref && <span className="opacity-70 font-mono"> · {a.clients.client_ref}</span>}
                      </button>
                      <button onClick={() => onRemoveAllocation(a.client_id)} aria-label={`Remove ${a.clients.name}`} className="hover:text-red-500"><X size={10} /></button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Linked tasks ───────────────────────────────────────────────── */}
      {taskLinks.length > 0 && (
        <div className="glass rounded-xl p-4">
          <SectionHeader icon={<CheckSquare size={13} className="text-[var(--accent)]" />} title="Linked tasks" />
          <ul className="space-y-1.5">
            {taskLinks.map(tl => (
              <li key={tl.task_id} className="flex items-center gap-2">
                <CheckSquare size={12} className="text-blue-600 shrink-0" />
                <button
                  type="button"
                  onClick={() => openTaskInTool(tl.task_id)}
                  aria-label={`Open task: ${tl.tasks?.title ?? 'Task'}`}
                  className="text-xs text-[var(--text-primary)] truncate flex-1 text-left hover:text-[var(--accent)] hover:underline transition-colors"
                >
                  {tl.tasks?.title ?? 'Task'}
                </button>
                <button onClick={() => onRemoveTaskLink(tl.task_id)} aria-label="Unlink task" className="shrink-0 text-[var(--text-muted)] hover:text-red-500 transition-colors"><X size={11} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Labels ─────────────────────────────────────────────────────── */}
      <div className="glass rounded-xl p-4">
        <SectionHeader icon={<Tag size={13} className="text-[var(--accent)]" />} title="Labels" />
        <div className="flex flex-wrap gap-1.5">
          {tagLabels.map(l => (
            <span key={l.id} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-[var(--accent-light)] text-[var(--accent)]">
              {l.name}
              {onRemoveLabel && (
                <button onClick={() => onRemoveLabel(l.id)} aria-label={`Remove ${l.name}`} className="hover:text-[var(--text-primary)]"><X size={10} /></button>
              )}
            </span>
          ))}

          {onAddLabel && addableLabels.length > 0 && (
            <>
              <button
                ref={addBtnRef}
                onClick={openAddMenu}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border border-dashed border-[var(--border-input)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
              >
                <Plus size={10} /> Add label
              </button>
              {addOpen && menuPos && typeof document !== 'undefined' && createPortal(
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setAddOpen(false)} />
                  <div
                    style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                    className="z-[61] w-48 max-h-60 overflow-y-auto scrollbar-thin bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl py-1"
                  >
                    {addableLabels.map(l => (
                      <button
                        key={l.id}
                        onClick={() => { onAddLabel(l.id); setAddOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] flex items-center gap-2"
                      >
                        <Tag size={11} className="text-[var(--text-muted)] shrink-0" /> {l.name}
                      </button>
                    ))}
                  </div>
                </>,
                document.body,
              )}
            </>
          )}

          {tagLabels.length === 0 && !onAddLabel && (
            <p className="text-xs text-[var(--text-muted)]">No labels.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SnapStat({ icon, value, label }: { icon: React.ReactNode; value: number | undefined; label: string }) {
  return (
    <div className="rounded-lg bg-white/40 border border-[var(--border-card)] px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1">{icon}</div>
      <p className="text-lg font-bold text-[var(--text-primary)] leading-none">{value ?? '—'}</p>
      <p className="text-[10px] text-[var(--text-muted)] mt-1">{label}</p>
    </div>
  );
}
