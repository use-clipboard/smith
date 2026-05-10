'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2, UsersRound, CalendarClock, Loader2, Plus, Trash2, Edit3, Check, X, AlertTriangle, Info, ShieldAlert,
} from 'lucide-react';

interface Props {
  isAdmin: boolean;
}

interface Department {
  id: string;
  name: string;
  description: string | null;
  parent_department_id: string | null;
  color: string | null;
  display_order: number | null;
}

interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: 'admin' | 'staff';
  department_id: string | null;
  manager_id: string | null;
  job_title: string | null;
  job_description: string | null;
  employment_start_date: string | null;
  holiday_entitlement_days_override: number | null;
}

interface HrSettings {
  holiday_reset_month: number;
  holiday_reset_day: number;
  default_annual_holiday_days: number;
  morning_start: string;
  morning_end: string;
  afternoon_start: string;
  afternoon_end: string;
  push_to_calendar_default: boolean;
  confidential_recipient_user_id: string | null;
}

type Section = 'departments' | 'team' | 'holiday' | 'confidential';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function trimTime(t: string | undefined): string {
  if (!t) return '';
  // Trim '17:30:00' down to '17:30' for the <input type="time"> element.
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export default function HrSettingsTab({ isAdmin }: Props) {
  const [section, setSection] = useState<Section>('departments');

  return (
    <div className="space-y-5 max-w-5xl">
      {!isAdmin && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>HR settings are admin-only. You can view but not change anything here.</div>
        </div>
      )}

      {/* Section sub-tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'departments' as Section, label: 'Departments', icon: Building2 },
          { id: 'team' as Section,        label: 'Team & Roles', icon: UsersRound },
          { id: 'holiday' as Section,     label: 'Holiday config', icon: CalendarClock },
          { id: 'confidential' as Section, label: 'Confidential channel', icon: ShieldAlert },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              section === id
                ? 'bg-[var(--accent)] text-white'
                : 'bg-white border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {section === 'departments'  && <DepartmentsSection isAdmin={isAdmin} />}
      {section === 'team'         && <TeamSection isAdmin={isAdmin} />}
      {section === 'holiday'      && <HolidayConfigSection isAdmin={isAdmin} />}
      {section === 'confidential' && <ConfidentialChannelSection isAdmin={isAdmin} />}
    </div>
  );
}

// ── Confidential channel ──────────────────────────────────────────────────
function ConfidentialChannelSection({ isAdmin }: { isAdmin: boolean }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tRes, sRes] = await Promise.all([
        fetch('/api/hr/team'),
        fetch('/api/hr/settings'),
      ]);
      if (tRes.ok) setMembers((await tRes.json()).members ?? []);
      if (sRes.ok) {
        const s = (await sRes.json()).settings;
        setRecipientId(s?.confidential_recipient_user_id ?? null);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/hr/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidential_recipient_user_id: recipientId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Confidential HR Recipient</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">Designate the person who receives confidential disclosures when a team member chooses the &ldquo;Confidential HR Recipient&rdquo; option (typically the senior partner or HR lead). This is the safe alternative when the issue might involve a manager.</p>
        </div>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
          <Info size={13} className="shrink-0 mt-0.5" />
          <div>
            Only the designated recipient sees disclosures sent to them. Firm admins do <strong>not</strong> get an override on confidential disclosures — that&apos;s deliberate, so the channel can be trusted even if the issue involves senior management. Pick someone who staff would feel safe approaching.
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin inline mr-1.5" />Loading…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Recipient</label>
              <select disabled={!isAdmin} value={recipientId ?? ''} onChange={e => setRecipientId(e.target.value || null)} className="input-base text-sm w-full">
                <option value="">— Not set —</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.email}{m.role === 'admin' ? ' (admin)' : ''}</option>)}
              </select>
              {!recipientId && (
                <p className="text-[11px] text-amber-700 mt-1">Until set, the &ldquo;Confidential HR Recipient&rdquo; option won&apos;t be available to staff.</p>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}
          </div>
        )}

        {isAdmin && (
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check size={13} />Saved</span>}
            <button onClick={() => void handleSave()} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Departments ───────────────────────────────────────────────────────────
function DepartmentsSection({ isAdmin }: { isAdmin: boolean }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editColor, setEditColor] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/hr/departments');
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      const data = await res.json();
      setDepartments(data.departments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/hr/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null, color: newColor || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Create failed');
      setNewName(''); setNewDescription(''); setNewColor('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed'); }
    finally { setBusy(false); }
  }

  function startEdit(d: Department) {
    setEditingId(d.id);
    setEditName(d.name);
    setEditDescription(d.description ?? '');
    setEditColor(d.color ?? '');
  }
  async function saveEdit(id: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/hr/departments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), description: editDescription.trim() || null, color: editColor || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      setEditingId(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this department? Users currently assigned to it will be unassigned (the user records are kept).')) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/hr/departments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Departments</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">Group people for the org chart and reporting. The colour picker controls how nodes appear when filtering by department.</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}
          </div>
        )}

        {/* Create form */}
        {isAdmin && (
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Department name (e.g. Bookkeeping)" className="input-base sm:col-span-4 text-sm" />
            <input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Description (optional)" className="input-base sm:col-span-5 text-sm" />
            <input type="color" value={newColor || '#6366f1'} onChange={e => setNewColor(e.target.value)} className="h-9 w-full sm:col-span-1 rounded-lg border border-[var(--border)]" title="Department colour" />
            <button onClick={() => void handleCreate()} disabled={busy || !newName.trim()} className="btn-primary sm:col-span-2 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-center py-6 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading…</div>
        ) : departments.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic text-center py-4">No departments yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 border border-[var(--border)] rounded-xl">
            {departments.map(d => (
              <div key={d.id} className="p-3 flex items-center gap-3">
                {editingId === d.id ? (
                  <>
                    <input value={editName} onChange={e => setEditName(e.target.value)} className="input-base text-sm flex-1 min-w-0" />
                    <input value={editDescription} onChange={e => setEditDescription(e.target.value)} className="input-base text-sm flex-[2] min-w-0" />
                    <input type="color" value={editColor || '#6366f1'} onChange={e => setEditColor(e.target.value)} className="h-9 w-9 rounded-lg border border-[var(--border)]" />
                    <button onClick={() => void saveEdit(d.id)} disabled={busy} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50"><Check size={14} /></button>
                    <button onClick={() => setEditingId(null)} disabled={busy} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50"><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ background: d.color || '#94a3b8' }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[var(--text-primary)] truncate">{d.name}</div>
                      {d.description && <div className="text-xs text-[var(--text-muted)] truncate">{d.description}</div>}
                    </div>
                    {isAdmin && (
                      <>
                        <button onClick={() => startEdit(d)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Edit3 size={13} /></button>
                        <button onClick={() => void handleDelete(d.id)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Team & Roles ──────────────────────────────────────────────────────────
function TeamSection({ isAdmin }: { isAdmin: boolean }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<TeamMember>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tRes, dRes] = await Promise.all([
        fetch('/api/hr/team'),
        fetch('/api/hr/departments'),
      ]);
      if (!tRes.ok) throw new Error('Failed to load team');
      if (!dRes.ok) throw new Error('Failed to load departments');
      setMembers((await tRes.json()).members ?? []);
      setDepartments((await dRes.json()).departments ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function startEdit(m: TeamMember) {
    setEditingId(m.id);
    setDraft({
      department_id: m.department_id,
      manager_id: m.manager_id,
      job_title: m.job_title,
      job_description: m.job_description,
      employment_start_date: m.employment_start_date,
      holiday_entitlement_days_override: m.holiday_entitlement_days_override,
    });
  }
  async function saveEdit(id: string) {
    setSavingId(id); setError(null);
    try {
      const payload = {
        department_id: draft.department_id ?? null,
        manager_id: draft.manager_id ?? null,
        job_title: draft.job_title ?? null,
        job_description: draft.job_description ?? null,
        employment_start_date: draft.employment_start_date ?? null,
        holiday_entitlement_days_override: draft.holiday_entitlement_days_override ?? null,
      };
      const res = await fetch(`/api/hr/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      setEditingId(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSavingId(null); }
  }

  const departmentName = (id: string | null) => id ? (departments.find(d => d.id === id)?.name ?? '—') : '—';
  const managerName = (id: string | null) => id ? (members.find(m => m.id === id)?.full_name ?? members.find(m => m.id === id)?.email ?? '—') : '—';

  return (
    <div className="space-y-4">
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Team & Roles</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">Set each team member&apos;s department, manager, job title and description. The org chart auto-draws from these values. Custom holiday entitlement (e.g. for part-time staff) overrides the firm default.</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-6 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading…</div>
        ) : (
          <div className="border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-[var(--border)]">
                <tr>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Name</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Job title</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Department</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Manager</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Start</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Holiday</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const editing = editingId === m.id;
                  const saving = savingId === m.id;
                  return (
                    <>
                      <tr key={m.id} className="border-b border-gray-100 last:border-0 align-top">
                        <td className="px-3 py-2">
                          <div className="text-sm font-medium text-[var(--text-primary)]">{m.full_name ?? m.email}</div>
                          <div className="text-[11px] text-gray-400">{m.email}{m.role === 'admin' && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold uppercase">Admin</span>}</div>
                        </td>
                        <td className="px-3 py-2">
                          {editing ? (
                            <input value={draft.job_title ?? ''} onChange={e => setDraft(d => ({ ...d, job_title: e.target.value }))} className="input-base text-xs" />
                          ) : <span className="text-xs text-[var(--text-secondary)]">{m.job_title || '—'}</span>}
                        </td>
                        <td className="px-3 py-2">
                          {editing ? (
                            <select value={draft.department_id ?? ''} onChange={e => setDraft(d => ({ ...d, department_id: e.target.value || null }))} className="input-base text-xs">
                              <option value="">—</option>
                              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                          ) : <span className="text-xs text-[var(--text-secondary)]">{departmentName(m.department_id)}</span>}
                        </td>
                        <td className="px-3 py-2">
                          {editing ? (
                            <select value={draft.manager_id ?? ''} onChange={e => setDraft(d => ({ ...d, manager_id: e.target.value || null }))} className="input-base text-xs">
                              <option value="">—</option>
                              {members.filter(o => o.id !== m.id).map(o => <option key={o.id} value={o.id}>{o.full_name ?? o.email}</option>)}
                            </select>
                          ) : <span className="text-xs text-[var(--text-secondary)]">{managerName(m.manager_id)}</span>}
                        </td>
                        <td className="px-3 py-2">
                          {editing ? (
                            <input type="date" value={draft.employment_start_date ?? ''} onChange={e => setDraft(d => ({ ...d, employment_start_date: e.target.value || null }))} className="input-base text-xs" />
                          ) : <span className="text-xs text-[var(--text-muted)]">{m.employment_start_date ?? '—'}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {editing ? (
                            <input type="number" min="0" max="366" step="0.5" value={draft.holiday_entitlement_days_override ?? ''} onChange={e => setDraft(d => ({ ...d, holiday_entitlement_days_override: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="default" className="input-base text-xs w-20 text-right" />
                          ) : <span className="text-xs text-[var(--text-muted)]">{m.holiday_entitlement_days_override ?? <span className="italic text-gray-400">default</span>}</span>}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {!isAdmin ? null : editing ? (
                            <>
                              <button onClick={() => void saveEdit(m.id)} disabled={saving} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}</button>
                              <button onClick={() => setEditingId(null)} disabled={saving} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50"><X size={14} /></button>
                            </>
                          ) : (
                            <button onClick={() => startEdit(m)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Edit3 size={13} /></button>
                          )}
                        </td>
                      </tr>
                      {editing && (
                        <tr className="border-b border-gray-100">
                          <td colSpan={7} className="px-3 pb-3">
                            <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase mt-1 mb-1">Job description</label>
                            <textarea
                              value={draft.job_description ?? ''}
                              onChange={e => setDraft(d => ({ ...d, job_description: e.target.value }))}
                              rows={2}
                              placeholder="Brief description of what this person does"
                              className="input-base w-full text-xs"
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Holiday config ────────────────────────────────────────────────────────
function HolidayConfigSection({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<HrSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/hr/settings');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setSettings(data.settings);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function update<K extends keyof HrSettings>(k: K, v: HrSettings[K]) {
    setSettings(s => s ? { ...s, [k]: v } : s);
  }

  async function handleSave() {
    if (!isAdmin || !settings) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/hr/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holiday_reset_month: settings.holiday_reset_month,
          holiday_reset_day: settings.holiday_reset_day,
          default_annual_holiday_days: settings.default_annual_holiday_days,
          morning_start: trimTime(settings.morning_start),
          morning_end: trimTime(settings.morning_end),
          afternoon_start: trimTime(settings.afternoon_start),
          afternoon_end: trimTime(settings.afternoon_end),
          push_to_calendar_default: settings.push_to_calendar_default,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  if (loading || !settings) {
    return <div className="text-center py-8 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="glass-solid rounded-xl p-5 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Holiday year & default entitlement</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">When the holiday year starts and how many days each team member gets by default. Individual overrides for part-time staff are set in the Team & Roles tab.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Reset month</label>
            <select disabled={!isAdmin} value={settings.holiday_reset_month} onChange={e => update('holiday_reset_month', Number(e.target.value))} className="input-base text-sm">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Reset day</label>
            <input disabled={!isAdmin} type="number" min="1" max="31" value={settings.holiday_reset_day} onChange={e => update('holiday_reset_day', Number(e.target.value))} className="input-base text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Default annual days</label>
            <input disabled={!isAdmin} type="number" min="0" max="366" step="0.5" value={settings.default_annual_holiday_days} onChange={e => update('default_annual_holiday_days', Number(e.target.value))} className="input-base text-sm" />
          </div>
        </div>
      </div>

      <div className="glass-solid rounded-xl p-5 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Half-day boundaries</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">Used when a team member books a morning or afternoon off. These times are firm-wide.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Morning start</label>
            <input disabled={!isAdmin} type="time" value={trimTime(settings.morning_start)} onChange={e => update('morning_start', e.target.value)} className="input-base text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Morning end</label>
            <input disabled={!isAdmin} type="time" value={trimTime(settings.morning_end)} onChange={e => update('morning_end', e.target.value)} className="input-base text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Afternoon start</label>
            <input disabled={!isAdmin} type="time" value={trimTime(settings.afternoon_start)} onChange={e => update('afternoon_start', e.target.value)} className="input-base text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Afternoon end</label>
            <input disabled={!isAdmin} type="time" value={trimTime(settings.afternoon_end)} onChange={e => update('afternoon_end', e.target.value)} className="input-base text-sm" />
          </div>
        </div>
      </div>

      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Calendar push</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1 flex items-start gap-1.5"><Info size={12} className="shrink-0 mt-0.5" />When a manager approves a holiday, this controls whether the &quot;Add to staff member&apos;s Google Calendar&quot; toggle starts on or off. Each manager can still flip it for individual approvals.</p>
        </div>
        <div className="flex items-center justify-between p-3 bg-[var(--bg-nav-hover)] rounded-xl border border-[var(--border)]">
          <span className="text-sm text-[var(--text-primary)]">Default approve toggle: push approved holidays to calendar</span>
          <button
            type="button"
            disabled={!isAdmin}
            onClick={() => update('push_to_calendar_default', !settings.push_to_calendar_default)}
            className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${settings.push_to_calendar_default ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'} disabled:opacity-50`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${settings.push_to_calendar_default ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}
        </div>
      )}

      {isAdmin && (
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check size={13} />Saved</span>}
          <button onClick={() => void handleSave()} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Save settings
          </button>
        </div>
      )}
    </div>
  );
}
