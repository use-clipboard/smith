'use client';

import { useEffect, useState } from 'react';
import { Mail, Clock, Info, LayoutGrid, List, UserMinus, Loader2, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { DEFAULT_POLICY, type TaskClientStatusPolicy } from '@/lib/taskClientStatusPolicy';

const TASKS_DEFAULT_VIEW_KEY = 'smith:tasks_default_view';

interface Props {
  firmId: string;
  isAdmin: boolean;
  initialEmailFromName: string | null;
  initialEmailFromAddress: string | null;
}

export default function TasksSettingsTab({ firmId, isAdmin, initialEmailFromName, initialEmailFromAddress }: Props) {
  const supabase = createClient();

  // Email sender settings
  const [emailFromName, setEmailFromName] = useState(initialEmailFromName ?? '');
  const [emailFromAddress, setEmailFromAddress] = useState(initialEmailFromAddress ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Client-status policy — controls what happens to tasks when their
  // client is moved to On Hold / Inactive. Stored on firms.task_client_status_policy.
  const [policy, setPolicy]           = useState<TaskClientStatusPolicy>(DEFAULT_POLICY);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySaving, setPolicySaving]   = useState(false);
  const [policySaved, setPolicySaved]     = useState(false);
  const [policyError, setPolicyError]     = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/tasks/settings/client-status-policy')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Load failed (${r.status})`)))
      .then(j => setPolicy(j.policy))
      .catch(err => setPolicyError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPolicyLoading(false));
  }, []);

  async function savePolicy(next: TaskClientStatusPolicy) {
    if (!isAdmin) return;
    setPolicySaving(true);
    setPolicyError(null);
    setPolicy(next); // optimistic
    try {
      const r = await fetch('/api/tasks/settings/client-status-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setPolicyError(j.detail ?? j.error ?? `Save failed (${r.status})`);
        return;
      }
      setPolicy(j.policy);
      setPolicySaved(true);
      setTimeout(() => setPolicySaved(false), 2000);
    } finally {
      setPolicySaving(false);
    }
  }

  function updatePolicy<K extends keyof TaskClientStatusPolicy>(section: K, patch: Partial<TaskClientStatusPolicy[K]>) {
    void savePolicy({ ...policy, [section]: { ...policy[section], ...patch } });
  }

  // Default view preference (per-user, stored in localStorage)
  const [defaultView, setDefaultView] = useState<'list' | 'grid'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem(TASKS_DEFAULT_VIEW_KEY) as 'list' | 'grid') ?? 'list';
    }
    return 'list';
  });

  function handleSetDefaultView(view: 'list' | 'grid') {
    setDefaultView(view);
    if (typeof window !== 'undefined') {
      localStorage.setItem(TASKS_DEFAULT_VIEW_KEY, view);
      // Also clear the session override so the new default takes effect immediately
      sessionStorage.removeItem('tasks_view_mode');
    }
  }

  async function handleSaveEmailSettings() {
    if (!isAdmin) return;
    setEmailError(null);

    // Basic email format check
    const addr = emailFromAddress.trim();
    if (addr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setEmailError('Please enter a valid email address.');
      return;
    }

    setSavingEmail(true);
    try {
      const { error } = await supabase.from('firms').update({
        email_from_name: emailFromName.trim() || null,
        email_from_address: addr || null,
      }).eq('id', firmId);

      if (error) throw error;
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 2500);
    } catch (err) {
      console.error('Failed to save email settings:', err);
      setEmailError('Failed to save. Please try again.');
    } finally {
      setSavingEmail(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Client status policy — controls what happens to tasks when the
          associated client is moved to On Hold or Inactive */}
      <div className="glass-solid rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 mt-0.5">
            <UserMinus size={16} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">When a client is On Hold or Inactive</h3>
              {policySaving && <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />}
              {policySaved && <span className="text-[10px] text-green-500 font-medium">Saved</span>}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Choose how SMITH should react to a client status change. Defaults match common practice — leave as-is unless you need different behaviour.
            </p>
          </div>
        </div>

        {policyError && (
          <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>{policyError}</span>
          </div>
        )}
        {!isAdmin && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>You can view these settings but only admins can change them.</span>
          </div>
        )}

        {/* On Hold subsection */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">When a client is On Hold</p>
          <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            <PolicyToggleRow
              label="Hide their tasks from default views"
              hint="On-hold tasks are excluded from the default 'Open' filter. Users can toggle 'Show on-hold' to peek without changing the firm setting."
              checked={policy.on_hold.hide_from_default}
              disabled={!isAdmin || policyLoading}
              onChange={v => updatePolicy('on_hold', { hide_from_default: v })}
            />
            <PolicyToggleRow
              label="Pause recurrence"
              hint="Don't spawn the next cycle when an on-hold client's recurring task is completed. Resumes automatically when the client is reactivated."
              checked={policy.on_hold.pause_recurrence}
              disabled={!isAdmin || policyLoading}
              onChange={v => updatePolicy('on_hold', { pause_recurrence: v })}
            />
            <PolicyToggleRow
              label="Exclude from overdue counts"
              hint="On-hold tasks won't show up in the Overdue / Due-in-7d / Next-due headline chips."
              checked={policy.on_hold.exclude_from_overdue}
              disabled={!isAdmin || policyLoading}
              onChange={v => updatePolicy('on_hold', { exclude_from_overdue: v })}
            />
            <PolicyToggleRow
              label="Grey out the row"
              hint="Visually de-emphasise on-hold tasks in lists and cards."
              checked={policy.on_hold.grey_out_rows}
              disabled={!isAdmin || policyLoading}
              onChange={v => updatePolicy('on_hold', { grey_out_rows: v })}
            />
          </div>
        </div>

        {/* Inactive subsection */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">When a client is made Inactive</p>
          <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            <PolicyToggleRow
              label="Auto-cancel open tasks"
              hint="On transition to Inactive, every open task for that client is set to 'cancelled' with an audit note recording the date."
              checked={policy.inactive.auto_cancel_open}
              disabled={!isAdmin || policyLoading}
              onChange={v => updatePolicy('inactive', { auto_cancel_open: v })}
            />
            <PolicyToggleRow
              label="Break CH-deadline links"
              hint="Any CH Secretarial deadline links on the client's tasks are marked broken — no more automatic syncing of due dates."
              checked={policy.inactive.break_ch_links}
              disabled={!isAdmin || policyLoading}
              onChange={v => updatePolicy('inactive', { break_ch_links: v })}
            />
            <PolicyToggleRow
              label="Hide their tasks from default views"
              hint="Inactive client tasks are omitted from default task views. Visible in History."
              checked={policy.inactive.hide_from_default}
              disabled={!isAdmin || policyLoading}
              onChange={v => updatePolicy('inactive', { hide_from_default: v })}
            />
          </div>
        </div>
      </div>

      {/* Email reminders section */}
      <div className="glass-solid rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 mt-0.5">
            <Mail size={16} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Email Reminder Sender</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Customise the name and address used when SMITH sends task reminder emails to your team and clients.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Sender Name
            </label>
            <input
              type="text"
              value={emailFromName}
              onChange={e => setEmailFromName(e.target.value)}
              placeholder="e.g. Acme Accountants"
              className="input-base mt-1"
              disabled={!isAdmin}
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Shown as the "from" name in the recipient's inbox. Leave blank to use "SMITH".
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Sender Email Address
            </label>
            <input
              type="email"
              value={emailFromAddress}
              onChange={e => { setEmailFromAddress(e.target.value); setEmailError(null); }}
              placeholder="e.g. reminders@yourdomain.co.uk"
              className={`input-base mt-1 ${emailError ? 'border-red-400 focus:border-red-400' : ''}`}
              disabled={!isAdmin}
            />
            {emailError ? (
              <p className="text-xs text-red-500 mt-1">{emailError}</p>
            ) : (
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Leave blank to use the SMITH default address. Custom domains must be verified in your Resend account first.
              </p>
            )}
          </div>
        </div>

        {/* Resend verification note */}
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/15 border border-blue-200 dark:border-blue-800/40">
          <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            To send from a custom domain, add and verify the domain in your{' '}
            <a
              href="https://resend.com/domains"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium"
            >
              Resend dashboard
            </a>
            . Unverified domains will be rejected and reminders will fail to send.
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3 pt-1 border-t border-[var(--border)]">
            <button
              onClick={handleSaveEmailSettings}
              disabled={savingEmail}
              className="btn-primary disabled:opacity-50"
            >
              {savingEmail ? 'Saving…' : 'Save Email Settings'}
            </button>
            {emailSaved && <span className="text-xs text-green-500 font-medium">Saved!</span>}
          </div>
        )}
      </div>

      {/* Default view preference */}
      <div className="glass-solid rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 mt-0.5">
            <List size={16} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Default Task View</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Choose whether the task tool opens in list or card view by default. You can still switch between views at any time.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => handleSetDefaultView('list')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
              defaultView === 'list'
                ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            <List size={16} />
            List View
            {defaultView === 'list' && <span className="text-[10px] font-semibold uppercase tracking-wide bg-[var(--accent)] text-white px-1.5 py-0.5 rounded-full ml-1">Default</span>}
          </button>
          <button
            onClick={() => handleSetDefaultView('grid')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
              defaultView === 'grid'
                ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            <LayoutGrid size={16} />
            Card View
            {defaultView === 'grid' && <span className="text-[10px] font-semibold uppercase tracking-wide bg-[var(--accent)] text-white px-1.5 py-0.5 rounded-full ml-1">Default</span>}
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          This preference is saved per browser. Each team member can set their own default.
        </p>
      </div>

      {/* Reminder schedule info */}
      <div className="glass-solid rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 mt-0.5">
            <Clock size={16} className="text-[var(--text-secondary)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Reminder Schedule</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              How task email reminders are processed and delivered.
            </p>
          </div>
        </div>

        <div className="space-y-2 text-sm text-[var(--text-secondary)]">
          <div className="flex items-center justify-between py-2 border-b border-[var(--border)]">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Processing time</span>
            <span className="text-sm font-medium text-[var(--text-primary)]">Daily at 8:00 AM UTC</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-[var(--border)]">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Reminder timings</span>
            <span className="text-sm text-[var(--text-secondary)]">Set per step when building a task</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Recipients</span>
            <span className="text-sm text-[var(--text-secondary)]">Step assignee and/or client</span>
          </div>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          Reminder timing options (day before, day of, day after) are configured on individual task steps in the template builder or task creator.
        </p>
      </div>

    </div>
  );
}

interface PolicyToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

function PolicyToggleRow({ label, hint, checked, disabled, onChange }: PolicyToggleRowProps) {
  return (
    <label className={`flex items-start justify-between gap-3 px-3 py-2.5 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--bg-nav-hover)]'} transition-colors`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--text-primary)]">{label}</p>
        {hint && <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors mt-0.5
          ${checked ? 'bg-[var(--accent)]' : 'bg-gray-300 dark:bg-gray-600'}
          ${disabled ? '' : 'hover:opacity-90'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}
