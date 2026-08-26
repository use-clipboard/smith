'use client';

/**
 * ClientServicesPanel — the client "Services" tab. Lists the services the firm
 * provides to this client with an (informational) fee + frequency, derived
 * next-due and health, links to tasks (click through to the Tasks tool), a
 * KPI strip, and a right rail (Service Health / Upcoming Renewals / Notes).
 * Admins can add/edit/remove services; everyone can read + add notes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, MoreHorizontal, X, ExternalLink, StickyNote, Trash2, Pause, Play, Ban, Pencil, ListChecks, CalendarClock, Package, Sparkles, Loader2, Lightbulb } from 'lucide-react';
import { openTaskInTool } from '@/lib/notificationTarget';
import { serviceIcon } from './serviceIcons';
import ServiceEditModal from './ServiceEditModal';
import {
  FREQUENCY_LABEL, FREQUENCY_UNIT, HEALTH_COLOR, HEALTH_LABEL, vatSuffix,
  monthlyRecurringPence, annualValuePence,
  type ClientService, type ClientServiceNote, type ServiceFrequency, type ServiceHealth, type ServiceStatus,
} from '@/lib/services/serviceTypes';

function fmtMoney(pence: number | null | undefined): string {
  if (pence == null) return '—';
  return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDateUk(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function relative(iso: string | null): { label: string; overdue: boolean } | null {
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${iso}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)} days overdue`, overdue: true };
  if (days === 0) return { label: 'due today', overdue: true };
  if (days <= 45) return { label: `in ${days} day${days === 1 ? '' : 's'}`, overdue: false };
  const months = Math.round(days / 30);
  return { label: `in ${months} month${months === 1 ? '' : 's'}`, overdue: false };
}

const STATUS_PILL: Record<ServiceStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  paused: 'bg-amber-50 text-amber-700 border border-amber-100',
  ended: 'bg-slate-100 text-slate-500 border border-slate-200',
};

export default function ClientServicesPanel({ clientId, isAdmin }: { clientId: string; isAdmin: boolean }) {
  const [services, setServices] = useState<ClientService[] | null>(null);
  const [notes, setNotes] = useState<ClientServiceNote[]>([]);
  const [editTarget, setEditTarget] = useState<{ mode: 'add' | 'edit'; service?: ClientService } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [taskPopover, setTaskPopover] = useState<string | null>(null);
  // Row popups are portaled to <body> so the table's overflow containers can't
  // clip them; we anchor each to its trigger button's on-screen position.
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const [taskAnchor, setTaskAnchor] = useState<{ top: number; right: number } | null>(null);
  const [endTarget, setEndTarget] = useState<ClientService | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientService | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; catalogueIds: string[] }[]>([]);
  const [templateMenu, setTemplateMenu] = useState(false);
  const [opps, setOpps] = useState<{ title: string; detail: string }[] | null>(null);
  const [optimising, setOptimising] = useState(false);
  const [optErr, setOptErr] = useState<string | null>(null);

  async function runOptimise() {
    setOptimising(true); setOptErr(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/services/optimise`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setOptErr(d.error || 'Could not review services.'); return; }
      setOpps(d.opportunities ?? []);
    } catch { setOptErr('Could not review services.'); }
    finally { setOptimising(false); }
  }

  const load = useCallback(() => {
    fetch(`/api/clients/${clientId}/services`).then(r => (r.ok ? r.json() : { services: [] }))
      .then(d => setServices(d.services ?? [])).catch(() => setServices([]));
    fetch(`/api/clients/${clientId}/service-notes`).then(r => (r.ok ? r.json() : { notes: [] }))
      .then(d => setNotes(d.notes ?? [])).catch(() => setNotes([]));
  }, [clientId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    // Bundles come from the shared catalogue's packages (proposal_packages).
    fetch('/api/proposals/packages').then(r => (r.ok ? r.json() : { packages: [] }))
      .then(d => setTemplates((d.packages ?? []).map((p: { id: string; name: string; items?: { service_id: string }[] }) => ({
        id: p.id, name: p.name, catalogueIds: (p.items ?? []).map(it => it.service_id),
      }))))
      .catch(() => {});
  }, [isAdmin]);

  async function applyTemplate(t: { catalogueIds: string[] }) {
    setTemplateMenu(false);
    if (t.catalogueIds.length === 0) return;
    await fetch(`/api/clients/${clientId}/services/from-template`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogue_ids: t.catalogueIds }),
    }).catch(() => {});
    load();
  }

  // ── Derived KPIs + health ────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const s = services ?? [];
    const active = s.filter(x => x.status === 'active');
    const healthCounts: Record<ServiceHealth, number> = { active: 0, at_risk: 0, overdue: 0, inactive: 0 };
    for (const x of s) healthCounts[x.health] += 1;
    const healthy = active.length ? Math.round((healthCounts.active / active.length) * 100) : 100;
    return {
      total: active.length,
      monthly: monthlyRecurringPence(s),
      annual: annualValuePence(s),
      linkedTasks: s.filter(x => x.tasks.length > 0).length,
      linkedBilling: s.filter(x => x.linkedRecurringInvoiceId).length,
      healthCounts, healthy,
    };
  }, [services]);

  const renewals = useMemo(() => {
    return (services ?? [])
      .filter(x => x.status === 'active' && x.nextDue)
      .sort((a, b) => (a.nextDue! < b.nextDue! ? -1 : 1))
      .slice(0, 4);
  }, [services]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function setStatus(svc: ClientService, status: ServiceStatus) {
    await fetch(`/api/clients/${clientId}/services/${svc.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }).catch(() => {});
    load();
  }
  async function confirmEnd(alsoDeleteTasks: boolean) {
    if (!endTarget) return;
    await fetch(`/api/clients/${clientId}/services/${endTarget.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ended', also_delete_tasks: alsoDeleteTasks }),
    }).catch(() => {});
    setEndTarget(null); load();
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    await fetch(`/api/clients/${clientId}/services/${deleteTarget.id}`, { method: 'DELETE' }).catch(() => {});
    setDeleteTarget(null); load();
  }
  async function addNote() {
    const body = noteDraft.trim();
    if (!body) return;
    setAddingNote(true);
    try {
      await fetch(`/api/clients/${clientId}/service-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      });
      setNoteDraft('');
      fetch(`/api/clients/${clientId}/service-notes`).then(r => r.json()).then(d => setNotes(d.notes ?? []));
    } finally { setAddingNote(false); }
  }
  async function deleteNote(id: string) {
    setNotes(prev => prev.filter(n => n.id !== id));
    await fetch(`/api/clients/${clientId}/service-notes/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  // Handle end-request: skip the cross-warning when there are no linked tasks.
  function requestEnd(svc: ClientService) {
    setMenuFor(null);
    if (svc.tasks.length === 0) { void setStatus(svc, 'ended'); return; }
    setEndTarget(svc);
  }

  if (services === null) {
    return <div className="glass rounded-xl p-10 text-center text-sm text-[var(--text-muted)]">Loading services…</div>;
  }

  return (
    <div className="flex flex-col xl:flex-row gap-4 items-start">
      {/* ── Main column ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 w-full space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Services</h2>
            <p className="text-sm text-[var(--text-muted)]">Manage the services you provide for this client — pricing, frequency, and links to tasks.</p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              {templates.length > 0 && (
                <div className="relative">
                  <button onClick={() => setTemplateMenu(v => !v)} className="btn-secondary inline-flex items-center gap-1.5 text-sm">
                    <Package size={15} /> From template
                  </button>
                  {templateMenu && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setTemplateMenu(false)} />
                      <div className="absolute right-0 top-10 z-30 w-56 bg-white rounded-lg shadow-xl border border-[var(--border)] py-1">
                        {templates.map(t => (
                          <button key={t.id} onClick={() => void applyTemplate(t)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--accent-light)] flex items-center justify-between gap-2">
                            <span className="truncate">{t.name}</span>
                            <span className="text-[11px] text-[var(--text-muted)] shrink-0">{t.catalogueIds.length}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button onClick={() => setEditTarget({ mode: 'add' })} className="btn-primary inline-flex items-center gap-1.5 text-sm">
                <Plus size={15} /> Add Service
              </button>
            </div>
          )}
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="Active services" value={String(kpis.total)} />
          <Kpi label="Monthly recurring" value={fmtMoney(kpis.monthly)} sub="excl VAT" />
          <Kpi label="Annual value" value={fmtMoney(kpis.annual)} sub="excl VAT" />
          <Kpi label="Linked to tasks" value={String(kpis.linkedTasks)} sub="services" />
          <Kpi label="Linked to billing" value={String(kpis.linkedBilling)} sub="services" />
        </div>

        {/* Services table */}
        <div className="glass rounded-xl overflow-hidden">
          {services.length === 0 ? (
            <div className="py-14 text-center">
              <ListChecks size={26} className="mx-auto text-[var(--text-muted)] opacity-40 mb-2" />
              <p className="text-sm text-[var(--text-muted)]">No services yet.</p>
              {isAdmin && <button onClick={() => setEditTarget({ mode: 'add' })} className="mt-3 text-sm text-[var(--accent)] font-medium hover:underline">Add the first service</button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border-card)]">
                    <th className="px-4 py-2.5 font-semibold">Service</th>
                    <th className="px-3 py-2.5 font-semibold">Frequency</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Price (excl VAT)</th>
                    <th className="px-3 py-2.5 font-semibold">Next due</th>
                    <th className="px-3 py-2.5 font-semibold">Tasks</th>
                    <th className="px-3 py-2.5 font-semibold">Billing</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-2 py-2.5 font-semibold w-8" />
                  </tr>
                </thead>
                <tbody>
                  {services.map(svc => {
                    const Icon = serviceIcon(svc.icon);
                    const rel = relative(svc.nextDue);
                    return (
                      <tr key={svc.id} className="border-b border-[var(--border-card)] last:border-0 hover:bg-black/[0.015]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="grid place-items-center h-8 w-8 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] shrink-0"><Icon size={15} /></span>
                            <div className="min-w-0">
                              <p className="font-medium text-[var(--text-primary)] truncate">
                                {svc.name}
                                {svc.tierLabel && <span className="ml-1.5 align-middle text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)]">{svc.tierLabel}</span>}
                              </p>
                              {svc.description && <p className="text-xs text-[var(--text-muted)] truncate max-w-[260px]">{svc.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {svc.frequency
                            ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{FREQUENCY_LABEL[svc.frequency as ServiceFrequency] ?? svc.frequency}</span>
                            : <span className="text-[var(--text-muted)]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className="font-medium text-[var(--text-primary)]">{fmtMoney(svc.pricePence)}</span>
                          {svc.pricePence != null && (
                            <span className="block text-[11px] text-[var(--text-muted)]">
                              {svc.frequency ? FREQUENCY_UNIT[svc.frequency as ServiceFrequency] : ''}
                              {vatSuffix(svc.vatTreatment) && <> · {vatSuffix(svc.vatTreatment)}</>}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-[var(--text-secondary)] tabular-nums">{fmtDateUk(svc.nextDue)}</span>
                          {rel && <span className={`block text-[11px] ${rel.overdue ? 'text-red-600 font-medium' : 'text-[var(--text-muted)]'}`}>{rel.label}</span>}
                        </td>
                        <td className="px-3 py-3">
                          {svc.tasks.length === 0
                            ? <span className="text-[var(--text-muted)]">—</span>
                            : (
                              <button onClick={e => {
                                const open = taskPopover === svc.id;
                                setMenuFor(null);
                                setTaskPopover(open ? null : svc.id);
                                if (!open) { const r = e.currentTarget.getBoundingClientRect(); setTaskAnchor({ top: r.bottom + 4, right: window.innerWidth - r.right }); }
                              }} className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                                <ListChecks size={13} /> {svc.tasks.length} task{svc.tasks.length === 1 ? '' : 's'}
                              </button>
                            )}
                        </td>
                        <td className="px-3 py-3">
                          {svc.linkedRecurringInvoiceId
                            ? <span className="text-xs text-emerald-700">Linked</span>
                            : <span className="text-xs text-[var(--text-muted)]">Not linked</span>}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[svc.status]}`}>{svc.status === 'active' ? 'Active' : svc.status === 'paused' ? 'Paused' : 'Ended'}</span>
                        </td>
                        <td className="px-2 py-3">
                          {isAdmin && (
                            <button onClick={e => {
                              const open = menuFor === svc.id;
                              setTaskPopover(null);
                              setMenuFor(open ? null : svc.id);
                              if (!open) { const r = e.currentTarget.getBoundingClientRect(); setMenuAnchor({ top: r.bottom + 4, right: window.innerWidth - r.right }); }
                            }} aria-label="Service actions" className="p-1 rounded text-[var(--text-muted)] hover:bg-slate-100">
                              <MoreHorizontal size={16} />
                            </button>
                          )}
                          {menuFor === svc.id && menuAnchor && createPortal(
                            <>
                              <div className="fixed inset-0 z-[80]" onClick={() => setMenuFor(null)} />
                              <div className="fixed z-[81] w-44 bg-white rounded-lg shadow-xl border border-[var(--border)] py-1 text-sm" style={{ top: menuAnchor.top, right: menuAnchor.right }}>
                                <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenuFor(null); setEditTarget({ mode: 'edit', service: svc }); }} />
                                {svc.status === 'active' && <MenuItem icon={Pause} label="Pause" onClick={() => { setMenuFor(null); void setStatus(svc, 'paused'); }} />}
                                {svc.status === 'paused' && <MenuItem icon={Play} label="Resume" onClick={() => { setMenuFor(null); void setStatus(svc, 'active'); }} />}
                                {svc.status !== 'ended' && <MenuItem icon={Ban} label="End service" onClick={() => requestEnd(svc)} />}
                                {svc.status === 'ended' && <MenuItem icon={Play} label="Reactivate" onClick={() => { setMenuFor(null); void setStatus(svc, 'active'); }} />}
                                <MenuItem icon={Trash2} label="Delete" danger onClick={() => { setMenuFor(null); setDeleteTarget(svc); }} />
                              </div>
                            </>, document.body)}
                          {taskPopover === svc.id && taskAnchor && svc.tasks.length > 0 && createPortal(
                            <>
                              <div className="fixed inset-0 z-[80]" onClick={() => setTaskPopover(null)} />
                              <div className="fixed z-[81] w-64 bg-white rounded-lg shadow-xl border border-[var(--border)] py-1 text-sm" style={{ top: taskAnchor.top, right: taskAnchor.right }}>
                                <p className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">Linked tasks</p>
                                {svc.tasks.map(t => (
                                  <button key={t.id} onClick={() => { setTaskPopover(null); openTaskInTool(t.id); }} className="w-full text-left px-3 py-1.5 hover:bg-[var(--accent-light)] flex items-center gap-2">
                                    <ExternalLink size={12} className="text-[var(--accent)] shrink-0" />
                                    <span className="truncate">{t.title}</span>
                                  </button>
                                ))}
                              </div>
                            </>, document.body)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* AI review & optimise */}
        <div className="rounded-xl p-4 bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid place-items-center h-9 w-9 rounded-lg bg-white/15 shrink-0"><Sparkles size={17} /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Review &amp; optimise</p>
              <p className="text-xs text-white/80">Let SMITH review this client&rsquo;s services and suggest opportunities.</p>
              {optErr && <p className="text-xs mt-2 bg-white/15 rounded px-2 py-1">{optErr}</p>}
              {opps && opps.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {opps.map((o, i) => (
                    <li key={i} className="bg-white/10 rounded-lg px-3 py-2">
                      <p className="text-sm font-medium flex items-center gap-1.5"><Lightbulb size={13} /> {o.title}</p>
                      {o.detail && <p className="text-xs text-white/85 mt-0.5">{o.detail}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {opps && opps.length === 0 && <p className="text-xs mt-2 text-white/85">Nothing to flag — this client&rsquo;s services look well covered. 👍</p>}
            </div>
            <button onClick={() => void runOptimise()} disabled={optimising} className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium bg-white text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-white/90 disabled:opacity-60">
              {optimising ? <><Loader2 size={13} className="animate-spin" /> Reviewing…</> : (opps ? 'Review again' : 'Review services')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Right rail ─────────────────────────────────────────────────────── */}
      <div className="w-full xl:w-[300px] shrink-0 space-y-4">
        {/* Service health */}
        <div className="glass rounded-xl p-5">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">Service Health</p>
          <div className="flex items-center gap-4">
            <HealthDonut counts={kpis.healthCounts} healthy={kpis.healthy} />
            <div className="flex-1 space-y-1.5 text-xs">
              <HealthRow color={HEALTH_COLOR.active} label={HEALTH_LABEL.active} n={kpis.healthCounts.active} />
              <HealthRow color={HEALTH_COLOR.at_risk} label={HEALTH_LABEL.at_risk} n={kpis.healthCounts.at_risk} />
              <HealthRow color={HEALTH_COLOR.overdue} label={HEALTH_LABEL.overdue} n={kpis.healthCounts.overdue} />
              <HealthRow color={HEALTH_COLOR.inactive} label={HEALTH_LABEL.inactive} n={kpis.healthCounts.inactive} />
            </div>
          </div>
        </div>

        {/* Upcoming renewals */}
        <div className="glass rounded-xl p-5">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">Upcoming Renewals</p>
          {renewals.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No upcoming renewals.</p>
          ) : (
            <ul className="space-y-2.5">
              {renewals.map(svc => {
                const Icon = serviceIcon(svc.icon);
                const rel = relative(svc.nextDue);
                return (
                  <li key={svc.id} className="flex items-center gap-2.5">
                    <span className="grid place-items-center h-7 w-7 rounded-lg bg-slate-100 text-slate-500 shrink-0"><Icon size={13} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--text-primary)] truncate">{svc.name}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{fmtDateUk(svc.nextDue)}{rel ? ` · ${rel.label}` : ''}</p>
                    </div>
                    <CalendarClock size={13} className="text-[var(--text-muted)] shrink-0" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Service notes */}
        <div className="glass rounded-xl p-5">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">Service Notes</p>
          <div className="flex items-start gap-2 mb-3">
            <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addNote(); }} placeholder="Add an internal note…" className="input-base flex-1 text-xs" />
            <button onClick={() => void addNote()} disabled={!noteDraft.trim() || addingNote} className="btn-primary text-xs px-2.5 disabled:opacity-50">Add</button>
          </div>
          {notes.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map(n => (
                <li key={n.id} className="group text-xs bg-white/50 border border-[var(--border-card)] rounded-lg px-2.5 py-2 relative">
                  <p className="text-[var(--text-secondary)] whitespace-pre-wrap pr-4">{n.body}</p>
                  {n.createdByName && <p className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center gap-1"><StickyNote size={9} /> {n.createdByName}</p>}
                  <button onClick={() => void deleteNote(n.id)} aria-label="Delete note" className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-600"><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Edit / add modal */}
      {editTarget && (
        <ServiceEditModal
          clientId={clientId}
          mode={editTarget.mode}
          service={editTarget.service}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      )}

      {/* End-service cross-warning */}
      {endTarget && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setEndTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">End “{endTarget.name}”?</h3>
            <p className="text-sm text-[var(--text-secondary)]">This service has <strong>{endTarget.tasks.length} linked task{endTarget.tasks.length === 1 ? '' : 's'}</strong>. Do you also want to delete the linked task{endTarget.tasks.length === 1 ? '' : 's'}?</p>
            <div className="flex justify-end gap-2 mt-4 flex-wrap">
              <button onClick={() => setEndTarget(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={() => void confirmEnd(false)} className="btn-secondary text-xs">End service only</button>
              <button onClick={() => void confirmEnd(true)} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">End &amp; delete tasks</button>
            </div>
          </div>
        </div>, document.body)}

      {/* Delete confirm */}
      {deleteTarget && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Delete “{deleteTarget.name}”?</h3>
            <p className="text-sm text-[var(--text-secondary)]">The service is removed for this client. Any linked tasks are kept (just un-linked).</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDeleteTarget(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={() => void confirmDelete()} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass rounded-xl p-3.5">
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="text-xl font-bold text-[var(--text-primary)] mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 ${danger ? 'text-red-600' : 'text-[var(--text-primary)]'}`}>
      <Icon size={13} /> {label}
    </button>
  );
}

function HealthRow({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
      <span className="font-semibold text-[var(--text-primary)]">{n}</span>
    </div>
  );
}

function HealthDonut({ counts, healthy }: { counts: Record<ServiceHealth, number>; healthy: number }) {
  const total = counts.active + counts.at_risk + counts.overdue + counts.inactive;
  const order: ServiceHealth[] = ['active', 'at_risk', 'overdue', 'inactive'];
  let acc = 0;
  const stops: string[] = [];
  if (total === 0) {
    stops.push(`${HEALTH_COLOR.inactive} 0 100%`);
  } else {
    for (const k of order) {
      const pct = (counts[k] / total) * 100;
      if (pct <= 0) continue;
      stops.push(`${HEALTH_COLOR[k]} ${acc}% ${acc + pct}%`);
      acc += pct;
    }
  }
  return (
    <div className="relative h-24 w-24 shrink-0" style={{ background: `conic-gradient(${stops.join(', ')})`, borderRadius: '9999px' }}>
      <div className="absolute inset-[10px] bg-white rounded-full grid place-items-center">
        <div className="text-center leading-none">
          <p className="text-lg font-bold text-[var(--text-primary)]">{healthy}%</p>
          <p className="text-[9px] text-[var(--text-muted)]">Healthy</p>
        </div>
      </div>
    </div>
  );
}
