'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, AlertTriangle, Check, UserPlus } from 'lucide-react';
import type { TeamMember, Department } from './HrClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  team: TeamMember[];
  departments: Department[];
}

interface FormState {
  email: string;
  full_name: string;
  role: 'admin' | 'staff';
  send_invite: boolean;       // true = email invite; false = create with password
  password: string;
  job_title: string;
  job_description: string;
  department_id: string;
  manager_id: string;
  employment_start_date: string;
  holiday_entitlement_days_override: string;
  pro_rata_first_year: boolean;
  date_of_birth: string;
  // Probation
  add_probation: boolean;
  probation_end_date: string;
  // Onboarding template
  apply_template: boolean;
}

const EMPTY: FormState = {
  email: '', full_name: '', role: 'staff', send_invite: true, password: '',
  job_title: '', job_description: '', department_id: '', manager_id: '',
  employment_start_date: new Date().toISOString().slice(0, 10),
  holiday_entitlement_days_override: '',
  // Almost every new joiner is mid-year, so default this on. The flag is
  // a no-op for anyone whose start date doesn't fall inside the current
  // holiday year — leaving it on is therefore safe even for edge cases
  // like January-1st starts.
  pro_rata_first_year: true,
  date_of_birth: '',
  add_probation: true,
  probation_end_date: addMonths(new Date(), 3).toISOString().slice(0, 10),
  apply_template: true,
};

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export default function JoinerWizardModal({ isOpen, onClose, onCreated, team, departments }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) { setForm(EMPTY); setStep(1); setError(null); setProgress(null); }
  }, [isOpen]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(s => ({ ...s, [k]: v }));
  }

  function nextStep() {
    setError(null);
    if (step === 1) {
      if (!form.email.trim() || !form.full_name.trim()) { setError('Email and full name are required.'); return; }
      if (!form.send_invite && form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  }

  async function submit() {
    setSaving(true); setError(null);
    try {
      // 1. Invite / create user
      setProgress('Creating account…');
      const inviteRes = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          role: form.role,
          ...(form.send_invite ? {} : { password: form.password }),
        }),
      });
      const inviteData = await inviteRes.json();
      if (!inviteRes.ok || !inviteData.user_id) throw new Error(inviteData.error ?? 'Failed to create account');
      const userId: string = inviteData.user_id;

      // 2. Patch HR fields
      setProgress('Saving HR details…');
      const hrPatch: Record<string, unknown> = {
        full_name: form.full_name.trim(),
        job_title: form.job_title.trim() || null,
        job_description: form.job_description.trim() || null,
        department_id: form.department_id || null,
        manager_id: form.manager_id || null,
        employment_start_date: form.employment_start_date || null,
        holiday_entitlement_days_override: form.holiday_entitlement_days_override
          ? Number(form.holiday_entitlement_days_override)
          : null,
        pro_rata_first_year: form.pro_rata_first_year,
        date_of_birth: form.date_of_birth || null,
      };
      const patchRes = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hrPatch),
      });
      if (!patchRes.ok) throw new Error((await patchRes.json()).error ?? 'Failed to save HR fields');

      // 3. Probation (optional)
      if (form.add_probation && form.employment_start_date && form.probation_end_date) {
        setProgress('Recording probation period…');
        await fetch('/api/hr/personnel/probation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            start_date: form.employment_start_date,
            end_date: form.probation_end_date,
            status: 'active',
          }),
        });
      }

      // 4. Apply onboarding template (optional)
      if (form.apply_template) {
        setProgress('Applying onboarding checklist…');
        await fetch('/api/hr/onboarding/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'apply_template', user_id: userId }),
        });
      }

      setProgress('Done');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setProgress(null);
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <UserPlus size={16} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold">New joiner — step {step} of 3</h3>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Close" className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)] disabled:opacity-50"><X size={14} /></button>
        </div>

        {/* Step indicator */}
        <div className="px-5 pt-4">
          <div className="flex gap-1">
            {[1, 2, 3].map(n => (
              <div key={n} className={`flex-1 h-1 rounded-full ${n <= step ? 'bg-[var(--accent)]' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {step === 1 && (
            <>
              <p className="text-xs text-[var(--text-muted)]">Identity & login.</p>
              <Field label="Full name *">
                <input value={form.full_name} onChange={e => set('full_name', e.target.value)} className="input-base text-sm w-full" placeholder="Jane Smith" />
              </Field>
              <Field label="Email *">
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="input-base text-sm w-full" placeholder="jane@firm.co.uk" />
              </Field>
              <Field label="Role">
                <select value={form.role} onChange={e => set('role', e.target.value as 'admin' | 'staff')} className="input-base text-sm w-full">
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
              <Field label="How will they get access?">
                <div className="space-y-1.5 text-sm">
                  <label className="flex items-start gap-2">
                    <input type="radio" checked={form.send_invite} onChange={() => set('send_invite', true)} className="mt-1" />
                    <span>Email them an invitation link <span className="text-[var(--text-muted)]">(they set their own password)</span></span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="radio" checked={!form.send_invite} onChange={() => set('send_invite', false)} className="mt-1" />
                    <span>Set an initial password now <span className="text-[var(--text-muted)]">(share it with them privately)</span></span>
                  </label>
                </div>
              </Field>
              {!form.send_invite && (
                <Field label="Initial password (min 8 chars)">
                  <input type="text" value={form.password} onChange={e => set('password', e.target.value)} className="input-base text-sm w-full font-mono" />
                </Field>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-xs text-[var(--text-muted)]">Job and reporting line.</p>
              <Field label="Job title">
                <input value={form.job_title} onChange={e => set('job_title', e.target.value)} className="input-base text-sm w-full" placeholder="Senior bookkeeper" />
              </Field>
              <Field label="Job description">
                <textarea value={form.job_description} onChange={e => set('job_description', e.target.value)} rows={2} className="input-base text-sm w-full" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Department">
                  <select value={form.department_id} onChange={e => set('department_id', e.target.value)} className="input-base text-sm w-full">
                    <option value="">— None —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Line manager">
                  <select value={form.manager_id} onChange={e => set('manager_id', e.target.value)} className="input-base text-sm w-full">
                    <option value="">— None —</option>
                    {team.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start date">
                  <input type="date" value={form.employment_start_date} onChange={e => set('employment_start_date', e.target.value)} className="input-base text-sm w-full" />
                </Field>
                <Field label="Holiday days (override)">
                  <input type="number" min={0} max={366} value={form.holiday_entitlement_days_override} onChange={e => set('holiday_entitlement_days_override', e.target.value)} className="input-base text-sm w-full" placeholder="Use firm default" />
                </Field>
              </div>
              {/* Pro-rata toggle — most new joiners are mid-year so we
                  surface this right next to their entitlement. The flag
                  only kicks in for the first holiday year and silently
                  expires once that year rolls over (the balance API
                  re-evaluates each request). Safe to leave on even for
                  Jan-1 starters who happen to land on the reset day. */}
              <label className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.pro_rata_first_year}
                  onChange={e => set('pro_rata_first_year', e.target.checked)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">Pro-rata holiday for their first year</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    They&apos;ll only earn a slice of their annual holiday for the partial year between their start date and the next reset. Full entitlement resumes automatically once the holiday year rolls over.
                  </p>
                </div>
              </label>
              <Field label="Date of birth (optional)">
                <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className="input-base text-sm w-full" />
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-xs text-[var(--text-muted)]">Optional first-day setup.</p>
              <label className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200 cursor-pointer">
                <input type="checkbox" checked={form.add_probation} onChange={e => set('add_probation', e.target.checked)} className="mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Start a probation period</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Tracks their probation end date so you get a reminder before it lapses.</p>
                  {form.add_probation && (
                    <div className="mt-2">
                      <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Probation end date</span>
                        <input type="date" value={form.probation_end_date} onChange={e => set('probation_end_date', e.target.value)} className="input-base text-sm" />
                      </label>
                    </div>
                  )}
                </div>
              </label>
              <label className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200 cursor-pointer">
                <input type="checkbox" checked={form.apply_template} onChange={e => set('apply_template', e.target.checked)} className="mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Apply firm onboarding checklist</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Creates each template item against this joiner with due dates relative to their start.</p>
                </div>
              </label>
              <div className="text-[11px] text-[var(--text-muted)] italic">
                Right-to-work documentation, salary, emergency contacts and DSE assessment can be filled in from their Profile after creation.
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />{error}
            </div>
          )}
          {progress && !error && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <Loader2 size={12} className="animate-spin" />{progress}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between sticky bottom-0 bg-white">
          {step > 1 ? (
            <button onClick={() => setStep((step - 1) as 1 | 2 | 3)} disabled={saving} className="btn-secondary text-sm disabled:opacity-50">Back</button>
          ) : <span />}
          {step < 3 ? (
            <button onClick={nextStep} className="btn-primary text-sm">Next</button>
          ) : (
            <button onClick={() => void submit()} disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Create joiner
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</span>
      {children}
    </label>
  );
}
