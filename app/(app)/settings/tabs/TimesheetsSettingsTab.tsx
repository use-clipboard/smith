'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, GripVertical, Clock } from 'lucide-react';
import { useTimesheets } from '@/components/features/timesheets/TimesheetsProvider';

type ActType = 'billable' | 'non_billable' | 'internal';
interface Activity { id: string; label: string; type: ActType; department: string; }

const TYPE_OPTIONS: { value: ActType; label: string }[] = [
  { value: 'billable', label: 'Billable' },
  { value: 'non_billable', label: 'Non-billable' },
  { value: 'internal', label: 'Internal' },
];

const newId = () => `a-${Math.random().toString(36).slice(2, 9)}`;

export default function TimesheetsSettingsTab({ isAdmin = true }: { isAdmin?: boolean }) {
  const { reloadSettings } = useTimesheets();
  const [departments, setDepartments] = useState<string[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [defaultRate, setDefaultRate] = useState('120'); // pounds/hr
  const [dailyTarget, setDailyTarget] = useState('7.5');
  const [rounding, setRounding] = useState(15);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/timesheets/settings')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then(d => {
        if (cancelled) return;
        setDepartments((d.departments ?? []) as string[]);
        setActivities((d.activities ?? []) as Activity[]);
        setDefaultRate(String(Math.round((d.defaultRatePence ?? 12000) / 100)));
        setDailyTarget(String(d.dailyTargetHours ?? 7.5));
        setRounding(Number(d.roundingMinutes ?? 15));
      })
      .catch(() => { if (!cancelled) setError('Could not load Timesheets settings.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const setDept = (i: number, v: string) => setDepartments(d => d.map((x, j) => (j === i ? v : x)));
  const removeDept = (i: number) => setDepartments(d => d.filter((_, j) => j !== i));
  const addDept = () => setDepartments(d => [...d, '']);

  const setAct = (id: string, patch: Partial<Activity>) =>
    setActivities(a => a.map(x => (x.id === id ? { ...x, ...patch } : x)));
  const removeAct = (id: string) => setActivities(a => a.filter(x => x.id !== id));
  const addAct = () =>
    setActivities(a => [...a, { id: newId(), label: '', type: 'billable', department: departments[0] ?? 'General' }]);

  async function handleSave() {
    setError(null);
    const cleanDepts = departments.map(d => d.trim()).filter(Boolean);
    const cleanActs = activities
      .map(a => ({ ...a, label: a.label.trim() }))
      .filter(a => a.label);
    if (cleanDepts.length === 0) { setError('Add at least one department.'); return; }
    if (cleanActs.length === 0) { setError('Add at least one activity.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/timesheets/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departments: cleanDepts,
          activities: cleanActs,
          defaultRatePence: Math.max(0, Math.round(Number(defaultRate) || 0) * 100),
          dailyTargetHours: Math.max(0, Math.min(24, Number(dailyTarget) || 0)),
          roundingMinutes: rounding,
        }),
      });
      if (!res.ok) { setError('Failed to save. Please try again.'); return; }
      setDepartments(cleanDepts);
      setActivities(cleanActs);
      await reloadSettings();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="glass-solid rounded-xl p-10 text-center text-sm text-[var(--text-muted)]"><Loader2 size={16} className="mr-1.5 inline animate-spin" />Loading…</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-light)] text-[var(--accent)]"><Clock size={18} /></div>
        <div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">Timesheets</h3>
          <p className="text-sm text-[var(--text-muted)]">Set the departments and work activities your team logs time against. These appear in the Timesheets pickers and reports.</p>
        </div>
      </div>

      {/* General */}
      <div className="glass-solid rounded-xl p-6">
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">General</h4>
          <p className="text-xs text-[var(--text-muted)]">Firm defaults for rates, targets and time rounding.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Default charge-out rate</label>
            <div className="flex items-center rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2.5 py-2">
              <span className="text-sm text-[var(--text-muted)]">£</span>
              <input type="number" min={0} step={5} value={defaultRate} disabled={!isAdmin}
                onChange={e => setDefaultRate(e.target.value)}
                className="w-full bg-transparent px-1 text-sm font-semibold text-[var(--text-primary)] outline-none disabled:opacity-60" />
              <span className="text-sm text-[var(--text-muted)]">/ hr</span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Applied to team members without their own rate set.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Daily target hours</label>
            <div className="flex items-center rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2.5 py-2">
              <input type="number" min={0} max={24} step={0.5} value={dailyTarget} disabled={!isAdmin}
                onChange={e => setDailyTarget(e.target.value)}
                className="w-full bg-transparent text-sm font-semibold text-[var(--text-primary)] outline-none disabled:opacity-60" />
              <span className="text-sm text-[var(--text-muted)]">h</span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Drives the timeline target line + utilisation target.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Rounding increment</label>
            <select value={rounding} disabled={!isAdmin} onChange={e => setRounding(Number(e.target.value))} className="input-base">
              <option value={1}>1 min (off)</option>
              <option value={5}>5 min</option>
              <option value={6}>6 min</option>
              <option value={10}>10 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
            </select>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Timer + drag entries snap to this.</p>
          </div>
        </div>
      </div>

      {/* Departments */}
      <div className="glass-solid rounded-xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Departments</h4>
            <p className="text-xs text-[var(--text-muted)]">Service-line teams. Used for “Time by department” and per-person team.</p>
          </div>
          {isAdmin && <button onClick={addDept} className="btn-secondary"><Plus size={14} /> Add</button>}
        </div>
        <div className="space-y-2">
          {departments.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <GripVertical size={14} className="shrink-0 text-[var(--text-muted)]/50" />
              <input
                value={d}
                disabled={!isAdmin}
                onChange={e => setDept(i, e.target.value)}
                placeholder="Department name"
                className="input-base flex-1"
              />
              {isAdmin && (
                <button onClick={() => removeDept(i)} className="shrink-0 rounded-lg p-2 text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500" aria-label="Remove department">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {departments.length === 0 && <p className="py-3 text-center text-xs text-[var(--text-muted)]">No departments yet.</p>}
        </div>
      </div>

      {/* Activities */}
      <div className="glass-solid rounded-xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Work activities</h4>
            <p className="text-xs text-[var(--text-muted)]">What people select when logging time. Each has a billing type and a department.</p>
          </div>
          {isAdmin && <button onClick={addAct} className="btn-secondary"><Plus size={14} /> Add</button>}
        </div>

        <div className="space-y-2">
          {/* Column headers */}
          <div className="hidden grid-cols-[1fr_140px_150px_36px] gap-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] sm:grid">
            <span>Activity</span><span>Type</span><span>Department</span><span></span>
          </div>
          {activities.map(a => (
            <div key={a.id} className="grid grid-cols-1 gap-2 rounded-xl border border-black/5 bg-white/50 p-2 sm:grid-cols-[1fr_140px_150px_36px] sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
              <input value={a.label} disabled={!isAdmin} onChange={e => setAct(a.id, { label: e.target.value })} placeholder="Activity name" className="input-base" />
              <select value={a.type} disabled={!isAdmin} onChange={e => setAct(a.id, { type: e.target.value as ActType })} className="input-base">
                {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={a.department} disabled={!isAdmin} onChange={e => setAct(a.id, { department: e.target.value })} className="input-base">
                {[...new Set([a.department, ...departments])].filter(Boolean).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {isAdmin && (
                <button onClick={() => removeAct(a.id)} className="justify-self-start rounded-lg p-2 text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500 sm:justify-self-center" aria-label="Remove activity">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {activities.length === 0 && <p className="py-3 text-center text-xs text-[var(--text-muted)]">No activities yet.</p>}
        </div>
      </div>

      {error && <p className="text-sm font-medium text-rose-500">{error}</p>}

      {isAdmin && (
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save changes'}</button>
          {saved && <span className="text-xs font-medium text-green-500">Saved — live in the Timesheets tool.</span>}
        </div>
      )}
    </div>
  );
}
