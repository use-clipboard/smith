'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2, UsersRound, CalendarClock, Loader2, Plus, Trash2, Edit3, Check, X, AlertTriangle, Info, ShieldAlert, ClipboardList,
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
  pro_rata_first_year: boolean;
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
  bank_holidays_enabled: boolean;
  bank_holidays_region: 'england-and-wales' | 'scotland' | 'northern-ireland';
  bank_holidays_last_synced_at: string | null;
}

type Section = 'departments' | 'team' | 'holiday' | 'confidential' | 'onboarding';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function trimTime(t: string | undefined): string {
  if (!t) return '';
  // Trim '17:30:00' down to '17:30' for the <input type="time"> element.
  return t.length >= 5 ? t.slice(0, 5) : t;
}

/** ISO YYYY-MM-DD → dd-mm-yyyy. Returns '—' for null/empty. */
function fmtUkDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Pro-rata an annual entitlement to the slice of the holiday year still
 *  remaining from `startIso`. Both `yearStartIso` and `yearEndIso` describe
 *  the firm's current holiday window; `yearEndIso` is the day BEFORE the
 *  next reset (i.e. inclusive end). Rounds to the nearest half day so we
 *  match how everything else in the HR module talks about holidays. */
function proRataDays(opts: {
  startIso: string;
  yearStartIso: string;
  yearEndIso: string;
  annualDays: number;
}): number {
  const { startIso, yearStartIso, yearEndIso, annualDays } = opts;
  const startMs = new Date(startIso + 'T12:00:00Z').getTime();
  const yearStartMs = new Date(yearStartIso + 'T12:00:00Z').getTime();
  const yearEndMs = new Date(yearEndIso + 'T12:00:00Z').getTime();
  // Effective working start — never before the holiday year began.
  const effectiveStartMs = Math.max(startMs, yearStartMs);
  const totalDays = Math.max(1, Math.round((yearEndMs - yearStartMs) / 86_400_000) + 1);
  const remainingDays = Math.max(0, Math.round((yearEndMs - effectiveStartMs) / 86_400_000) + 1);
  const raw = (remainingDays / totalDays) * annualDays;
  return Math.round(raw * 2) / 2;
}

/** Current holiday year window given the firm's reset day/month. */
function currentHolidayYear(resetMonth: number, resetDay: number): { startIso: string; endIso: string } {
  const today = new Date();
  const y = today.getFullYear();
  const thisCycleStart = new Date(Date.UTC(y, resetMonth - 1, resetDay));
  // If today is before this calendar year's reset, the active window
  // actually started last year.
  const startDate = today >= thisCycleStart
    ? thisCycleStart
    : new Date(Date.UTC(y - 1, resetMonth - 1, resetDay));
  const endDate = new Date(startDate);
  endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return {
    startIso: startDate.toISOString().slice(0, 10),
    endIso: endDate.toISOString().slice(0, 10),
  };
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
          { id: 'onboarding' as Section,  label: 'Onboarding template', icon: ClipboardList },
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
      {section === 'onboarding'  && <OnboardingTemplateSection isAdmin={isAdmin} />}
    </div>
  );
}

// ── Onboarding template ──────────────────────────────────────────────────
interface OnboardingTemplateItem {
  id: string;
  title: string;
  description: string | null;
  default_assignee_role: 'admin' | 'manager' | 'staff' | null;
  due_days_after_start: number;
  display_order: number;
}

function OnboardingTemplateSection({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<OnboardingTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', default_assignee_role: 'manager', due_days_after_start: '7', display_order: '0' });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/hr/onboarding/template');
    setItems((await res.json()).items ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function startEdit(item: OnboardingTemplateItem) {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      description: item.description ?? '',
      default_assignee_role: item.default_assignee_role ?? 'manager',
      due_days_after_start: String(item.due_days_after_start),
      display_order: String(item.display_order),
    });
  }

  function resetDraft() {
    setDraft({ title: '', description: '', default_assignee_role: 'manager', due_days_after_start: '7', display_order: '0' });
  }

  async function add() {
    if (!draft.title.trim()) return;
    await fetch('/api/hr/onboarding/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description || null,
        default_assignee_role: draft.default_assignee_role,
        due_days_after_start: Number(draft.due_days_after_start) || 0,
        display_order: Number(draft.display_order) || 0,
      }),
    });
    resetDraft();
    setAdding(false);
    void load();
  }

  async function saveEdit(id: string) {
    await fetch(`/api/hr/onboarding/template/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        description: draft.description || null,
        default_assignee_role: draft.default_assignee_role,
        due_days_after_start: Number(draft.due_days_after_start) || 0,
        display_order: Number(draft.display_order) || 0,
      }),
    });
    setEditingId(null);
    void load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this template item?')) return;
    await fetch(`/api/hr/onboarding/template/${id}`, { method: 'DELETE' });
    void load();
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--accent-light)] border border-[var(--accent)]/20 text-xs text-[var(--accent)]">
        <Info size={14} className="shrink-0 mt-0.5" />
        <p>These items become the default checklist for every new joiner. From Team Profiles, click <strong>Apply firm template</strong> on a new starter to materialise the list against their start date.</p>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin inline mr-1.5" />Loading…</div>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {items.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] italic px-4 py-6 text-center">No template items yet.</p>
          )}
          {items.map(item => {
            const isEditing = editingId === item.id;
            return (
              <div key={item.id} className="px-4 py-3">
                {isEditing ? (
                  <div className="space-y-2">
                    <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} className="input-base text-sm w-full" placeholder="Title" />
                    <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} rows={2} className="input-base text-sm w-full" placeholder="Description (optional)" />
                    <div className="grid grid-cols-3 gap-2">
                      <select value={draft.default_assignee_role} onChange={e => setDraft({ ...draft, default_assignee_role: e.target.value })} className="input-base text-sm">
                        <option value="admin">Admin</option>
                        <option value="manager">Line manager</option>
                        <option value="staff">Joiner themselves</option>
                      </select>
                      <input type="number" value={draft.due_days_after_start} onChange={e => setDraft({ ...draft, due_days_after_start: e.target.value })} className="input-base text-sm" placeholder="Due days after start" />
                      <input type="number" value={draft.display_order} onChange={e => setDraft({ ...draft, display_order: e.target.value })} className="input-base text-sm" placeholder="Order" />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="btn-secondary text-sm">Cancel</button>
                      <button onClick={() => void saveEdit(item.id)} className="btn-primary text-sm">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      {item.description && <p className="text-xs text-[var(--text-muted)] mt-0.5">{item.description}</p>}
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        Due day +{item.due_days_after_start}{item.default_assignee_role ? ` · Assignee: ${item.default_assignee_role}` : ''} · Order {item.display_order}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEdit(item)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Edit3 size={13} /></button>
                        <button onClick={() => void remove(item.id)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && !adding && (
        <button onClick={() => setAdding(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Plus size={13} />Add item</button>
      )}
      {isAdmin && adding && (
        <div className="border border-[var(--border)] rounded-xl p-4 space-y-2 bg-white">
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} className="input-base text-sm w-full" placeholder="Title (e.g. Issue laptop and access cards)" />
          <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} rows={2} className="input-base text-sm w-full" placeholder="Description (optional)" />
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Default assignee</span>
              <select value={draft.default_assignee_role} onChange={e => setDraft({ ...draft, default_assignee_role: e.target.value })} className="input-base text-sm w-full">
                <option value="admin">Admin</option>
                <option value="manager">Line manager</option>
                <option value="staff">Joiner themselves</option>
              </select>
            </label>
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Due (days after start)</span>
              <input type="number" min={0} value={draft.due_days_after_start} onChange={e => setDraft({ ...draft, due_days_after_start: e.target.value })} className="input-base text-sm w-full" />
            </label>
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Display order</span>
              <input type="number" value={draft.display_order} onChange={e => setDraft({ ...draft, display_order: e.target.value })} className="input-base text-sm w-full" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); resetDraft(); }} className="btn-secondary text-sm">Cancel</button>
            <button onClick={() => void add()} className="btn-primary text-sm">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bank holidays card (lives inside the Holiday config section) ──────────
function BankHolidaysCard({
  isAdmin, settings, update,
}: {
  isAdmin: boolean;
  settings: HrSettings;
  update: <K extends keyof HrSettings>(k: K, v: HrSettings[K]) => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ inserted: number; total_holidays: number; users: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true); setSyncError(null); setSyncResult(null);
    try {
      // The toggle + region live in client state until "Save settings" is clicked.
      // Persist them first so the sync endpoint reads the right values.
      const saveRes = await fetch('/api/hr/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_holidays_enabled: settings.bank_holidays_enabled,
          bank_holidays_region: settings.bank_holidays_region,
        }),
      });
      if (!saveRes.ok) throw new Error((await saveRes.json()).error ?? 'Could not save bank-holiday settings before sync');

      const res = await fetch('/api/hr/bank-holidays/sync', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Sync failed');
      setSyncResult(await res.json());
    } catch (e) { setSyncError(e instanceof Error ? e.message : 'Sync failed'); }
    finally { setSyncing(false); }
  }

  const lastSynced = settings.bank_holidays_last_synced_at
    ? new Date(settings.bank_holidays_last_synced_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="glass-solid rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">UK bank holidays</h3>
        <p className="text-xs text-[var(--text-muted)] mt-1 flex items-start gap-1.5">
          <Info size={12} className="shrink-0 mt-0.5" />
          When enabled, every team member gets approved holiday entries auto-created for upcoming UK bank holidays. New joiners are caught automatically the first time they open HR. Click Sync now to materialise the next 2 years for the whole team straight away.
        </p>
      </div>

      <div className="flex items-center justify-between p-3 bg-[var(--bg-nav-hover)] rounded-xl border border-[var(--border)]">
        <span className="text-sm text-[var(--text-primary)]">Treat UK bank holidays as firm holidays</span>
        <button
          type="button"
          disabled={!isAdmin}
          onClick={() => update('bank_holidays_enabled', !settings.bank_holidays_enabled)}
          className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${settings.bank_holidays_enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'} disabled:opacity-50`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${settings.bank_holidays_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {settings.bank_holidays_enabled && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Region</label>
            <select
              disabled={!isAdmin}
              value={settings.bank_holidays_region}
              onChange={e => update('bank_holidays_region', e.target.value as HrSettings['bank_holidays_region'])}
              className="input-base text-sm w-full sm:w-1/2"
            >
              <option value="england-and-wales">England &amp; Wales</option>
              <option value="scotland">Scotland</option>
              <option value="northern-ireland">Northern Ireland</option>
            </select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">UK bank holidays differ by region. Source: gov.uk/bank-holidays.json — always current.</p>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-[var(--border)]">
            <div className="text-xs text-[var(--text-secondary)]">
              {lastSynced ? <>Last synced: <strong className="text-[var(--text-primary)]">{lastSynced}</strong></> : <>Not yet synced.</>}
              {syncResult && (
                <span className="ml-2 text-emerald-600">
                  ✓ {syncResult.inserted} row{syncResult.inserted === 1 ? '' : 's'} added ({syncResult.total_holidays} bank holiday{syncResult.total_holidays === 1 ? '' : 's'} × {syncResult.users} user{syncResult.users === 1 ? '' : 's'})
                </span>
              )}
            </div>
            <button onClick={() => void handleSync()} disabled={!isAdmin || syncing} className="btn-secondary text-xs disabled:opacity-50 inline-flex items-center gap-1.5">
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Sync now
            </button>
          </div>

          {syncError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />{syncError}
            </div>
          )}
        </div>
      )}
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
  const [hrSettings, setHrSettings] = useState<Pick<HrSettings, 'holiday_reset_month' | 'holiday_reset_day' | 'default_annual_holiday_days'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<TeamMember>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tRes, dRes, sRes] = await Promise.all([
        fetch('/api/hr/team'),
        fetch('/api/hr/departments'),
        fetch('/api/hr/settings'),
      ]);
      if (!tRes.ok) throw new Error('Failed to load team');
      if (!dRes.ok) throw new Error('Failed to load departments');
      setMembers((await tRes.json()).members ?? []);
      setDepartments((await dRes.json()).departments ?? []);
      // Settings are nice-to-have for the pro-rata helper — failures here
      // shouldn't block editing roles.
      if (sRes.ok) {
        const s = (await sRes.json()).settings as HrSettings | null;
        if (s) setHrSettings({
          holiday_reset_month: s.holiday_reset_month,
          holiday_reset_day: s.holiday_reset_day,
          default_annual_holiday_days: s.default_annual_holiday_days,
        });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const holidayYear = hrSettings
    ? currentHolidayYear(hrSettings.holiday_reset_month, hrSettings.holiday_reset_day)
    : null;

  /** A team member qualifies for the pro-rata helper when their employment
   *  start date falls strictly inside the firm's current holiday year. */
  function isMidYearStarter(startIso: string | null | undefined): boolean {
    if (!startIso || !holidayYear) return false;
    return startIso > holidayYear.startIso && startIso <= holidayYear.endIso;
  }

  function startEdit(m: TeamMember) {
    setEditingId(m.id);
    setDraft({
      department_id: m.department_id,
      manager_id: m.manager_id,
      job_title: m.job_title,
      job_description: m.job_description,
      employment_start_date: m.employment_start_date,
      holiday_entitlement_days_override: m.holiday_entitlement_days_override,
      pro_rata_first_year: m.pro_rata_first_year,
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
        pro_rata_first_year: !!draft.pro_rata_first_year,
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

  /** Quick-toggle the pro-rata flag without entering full edit mode. Only
   *  available from the Mid Year Start column on a row that actually qualifies. */
  async function quickTogglePro_rata(id: string, next: boolean) {
    setSavingId(id); setError(null);
    // Optimistic flip so the toggle and "This year" column update instantly.
    setMembers(prev => prev.map(m => m.id === id ? { ...m, pro_rata_first_year: next } : m));
    try {
      const res = await fetch(`/api/hr/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pro_rata_first_year: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      // Revert on failure.
      setMembers(prev => prev.map(m => m.id === id ? { ...m, pro_rata_first_year: !next } : m));
    } finally { setSavingId(null); }
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
                  <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Mid Year Start
                  </th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Holiday</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">This Year</th>
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
                          ) : <span className="text-xs text-[var(--text-muted)]">{fmtUkDate(m.employment_start_date)}</span>}
                        </td>
                        {/* Mid-year start toggle — only meaningful for users whose
                            start date falls inside the current holiday year. Anyone
                            else shows a dash to make the column visually quiet. */}
                        <td className="px-3 py-2 text-center">
                          {(() => {
                            const startForRow = editing ? (draft.employment_start_date ?? null) : m.employment_start_date;
                            const qualifies = isMidYearStarter(startForRow);
                            if (!qualifies) {
                              return <span className="text-xs text-gray-300">—</span>;
                            }
                            const on = editing ? !!draft.pro_rata_first_year : m.pro_rata_first_year;
                            const onChange = editing
                              ? (next: boolean) => setDraft(d => ({ ...d, pro_rata_first_year: next }))
                              : (next: boolean) => { void quickTogglePro_rata(m.id, next); };
                            return (
                              <button
                                type="button"
                                disabled={!isAdmin || (savingId === m.id && !editing)}
                                onClick={() => onChange(!on)}
                                aria-pressed={on}
                                title={on ? 'Pro-rata applied for this holiday year only' : 'Toggle pro-rata for the first holiday year'}
                                className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-indigo-600' : 'bg-gray-300'}`}
                              >
                                <span
                                  aria-hidden
                                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`}
                                />
                              </button>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {editing ? (
                            <input type="number" min="0" max="366" step="0.5" value={draft.holiday_entitlement_days_override ?? ''} onChange={e => setDraft(d => ({ ...d, holiday_entitlement_days_override: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="default" className="input-base text-xs w-20 text-right" />
                          ) : <span className="text-xs text-[var(--text-muted)]">{m.holiday_entitlement_days_override ?? <span className="italic text-gray-400">default</span>}</span>}
                        </td>
                        {/* This-year entitlement — pro-rata applied only when the
                            user is a mid-year starter AND the toggle is on. Otherwise
                            equals the full holiday column. We surface this so admins
                            can see the effective figure that the balance API uses. */}
                        <td className="px-3 py-2 text-right">
                          {(() => {
                            const startForRow = editing ? (draft.employment_start_date ?? null) : m.employment_start_date;
                            const overrideForRow = editing
                              ? (draft.holiday_entitlement_days_override ?? null)
                              : m.holiday_entitlement_days_override;
                            const toggleOn = editing ? !!draft.pro_rata_first_year : m.pro_rata_first_year;
                            const annual = overrideForRow != null ? Number(overrideForRow) : hrSettings?.default_annual_holiday_days ?? null;
                            if (annual == null) return <span className="text-xs text-gray-300">—</span>;
                            const qualifies = isMidYearStarter(startForRow);
                            if (qualifies && toggleOn) {
                              const pro = proRataDays({
                                startIso: startForRow!,
                                yearStartIso: holidayYear!.startIso,
                                yearEndIso: holidayYear!.endIso,
                                annualDays: annual,
                              });
                              return (
                                <span className="text-xs font-semibold text-indigo-700" title={`Pro-rated from ${fmtUkDate(startForRow)} until ${fmtUkDate(holidayYear!.endIso)}`}>
                                  {pro}
                                </span>
                              );
                            }
                            return <span className="text-xs text-[var(--text-muted)]">{annual}</span>;
                          })()}
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
                          <td colSpan={9} className="px-3 pb-3 space-y-3">
                            {/* Mid-year starter footnote — the toggle in the
                                Mid Year Start column does the real work; this
                                just explains what'll happen. */}
                            {(() => {
                              const draftStart = draft.employment_start_date;
                              if (!holidayYear || !hrSettings || !draftStart || !isMidYearStarter(draftStart)) return null;
                              const annual = draft.holiday_entitlement_days_override ?? hrSettings.default_annual_holiday_days;
                              const suggested = proRataDays({
                                startIso: draftStart,
                                yearStartIso: holidayYear.startIso,
                                yearEndIso: holidayYear.endIso,
                                annualDays: annual,
                              });
                              return (
                                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 flex items-start gap-2 mt-1">
                                  <Info size={14} className="text-indigo-600 shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0 text-xs text-indigo-900 leading-relaxed">
                                    <span className="font-semibold">Mid-year starter.</span>{' '}
                                    Turn on the <em>Mid Year Start</em> toggle to pro-rata {annual} day{annual === 1 ? '' : 's'} from {fmtUkDate(draftStart)} —
                                    that works out to <span className="font-semibold">{suggested}</span> for the current holiday year ({fmtUkDate(holidayYear.startIso)} → {fmtUkDate(holidayYear.endIso)}).
                                    The toggle only applies to this first year; the full entitlement resumes automatically once the year rolls over.
                                  </div>
                                </div>
                              );
                            })()}

                            <div>
                              <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase mt-1 mb-1">Job description</label>
                              <textarea
                                value={draft.job_description ?? ''}
                                onChange={e => setDraft(d => ({ ...d, job_description: e.target.value }))}
                                rows={2}
                                placeholder="Brief description of what this person does"
                                className="input-base w-full text-xs"
                              />
                            </div>
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
          bank_holidays_enabled: settings.bank_holidays_enabled,
          bank_holidays_region: settings.bank_holidays_region,
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

      <BankHolidaysCard isAdmin={isAdmin} settings={settings} update={update} />

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
