'use client';

import { useState } from 'react';
import { Mail, Clock, Info } from 'lucide-react';
import { createClient } from '@/lib/supabase';

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
