'use client';

// Settings → Billing → Statements: what a statement shows, when it goes out,
// and the email that carries it.

import { FileText, CalendarClock, Mail, Info } from 'lucide-react';
import { GlassCard, SectionHeader } from '@/components/features/timesheets/shared/ui';
import { STATEMENT_MERGE_TAGS } from '@/lib/billing/statementMergeTags';
import type { StatementMode } from '@/lib/billing/types';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export interface StatementFormValues {
  statementMode: StatementMode;
  statementPeriodMonths: number;
  statementAutoEnabled: boolean;
  statementFrequency: 'weekly' | 'monthly';
  statementDay: number;
  statementMinBalancePence: number;
  statementEmailSubject: string;
  statementEmailBody: string;
}

interface Props {
  form: StatementFormValues;
  disabled: boolean;
  /** Whether a sending mailbox is set — statements share the invoice mailbox. */
  mailboxId: string | null;
  /** Patch-style so the parent can merge without per-key generics. */
  onChange: (patch: Partial<StatementFormValues>) => void;
}

export default function StatementSettingsCard({ form, disabled, mailboxId, onChange }: Props) {
  return (
    <div className="space-y-4">
      {/* What a statement shows */}
      <GlassCard>
        <SectionHeader title="What statements show" subtitle="Applies to the emailed statement, the PDF and the client's portal" />
        <div className="space-y-2">
          <ModeRow
            label="Outstanding invoices only"
            desc="An open-item statement: every unpaid invoice and what's still owed on it. What most practices send."
            active={form.statementMode === 'outstanding'}
            disabled={disabled}
            onClick={() => onChange({ statementMode: 'outstanding' })}
          />
          <ModeRow
            label="All invoices and payments"
            desc="A full statement of account: a brought-forward balance, then every invoice and payment in the period, with a running balance."
            active={form.statementMode === 'activity'}
            disabled={disabled}
            onClick={() => onChange({ statementMode: 'activity' })}
          />
        </div>

        {form.statementMode === 'activity' && (
          <div className="mt-3 border-t border-black/5 pt-3">
            <label className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">
              <CalendarClock size={13} className="text-[var(--text-muted)]" />Period covered
            </label>
            <div className="flex items-center gap-2">
              <select
                value={form.statementPeriodMonths}
                onChange={e => onChange({ statementPeriodMonths: Number(e.target.value) })}
                disabled={disabled}
                className="h-9 rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60"
              >
                {[1, 2, 3, 6, 12].map(m => <option key={m} value={m}>Last {m} month{m === 1 ? '' : 's'}</option>)}
              </select>
              <span className="text-[11px] text-[var(--text-muted)]">Anything older is netted into the brought-forward balance.</span>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Automatic runs */}
      <GlassCard>
        <SectionHeader title="Automatic statement runs" subtitle="Send statements on a schedule, without anyone pressing a button" />

        <label className={`flex items-start gap-3 rounded-xl border p-3 ${form.statementAutoEnabled ? 'border-[var(--accent)] bg-[var(--accent)]/[0.05]' : 'border-black/10'} ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={form.statementAutoEnabled}
            onChange={e => onChange({ statementAutoEnabled: e.target.checked })}
            disabled={disabled}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span>
            <span className="block text-[13.5px] font-semibold text-[var(--text-primary)]">Send statements automatically</span>
            <span className="mt-0.5 block text-[11.5px] text-[var(--text-muted)]">
              Only clients with an outstanding balance are sent one — nobody is emailed to be told they owe nothing.
            </span>
          </span>
        </label>

        {form.statementAutoEnabled && (
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">How often</label>
                <select
                  value={form.statementFrequency}
                  onChange={e => {
                    // Day means different things per frequency — reset it with the
                    // same patch so the two can never be briefly inconsistent.
                    onChange({ statementFrequency: e.target.value as 'weekly' | 'monthly', statementDay: 1 });
                  }}
                  disabled={disabled}
                  className="h-9 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">
                  {form.statementFrequency === 'weekly' ? 'On which day' : 'On which date'}
                </label>
                <select
                  value={form.statementDay}
                  onChange={e => onChange({ statementDay: Number(e.target.value) })}
                  disabled={disabled}
                  className="h-9 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60"
                >
                  {form.statementFrequency === 'weekly'
                    ? WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)
                    : Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{ordinal(i + 1)} of the month</option>)}
                </select>
              </div>
            </div>

            {form.statementFrequency === 'monthly' && form.statementDay > 28 && (
              <p className="flex items-start gap-1 text-[11px] text-[var(--text-muted)]">
                <Info size={11} className="mt-0.5 shrink-0" />
                <span>Short months don&rsquo;t have a {ordinal(form.statementDay)} — those months run on the last day instead, so a run is never skipped.</span>
              </p>
            )}

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Only send when the balance is over (£)</label>
              <input
                type="number" min={0} step={1}
                value={form.statementMinBalancePence / 100}
                onChange={e => onChange({ statementMinBalancePence: Math.round(Number(e.target.value) * 100) })}
                disabled={disabled}
                className="h-9 w-full max-w-[180px] rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60"
              />
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">Leave at 0 to send to everyone with anything outstanding.</p>
            </div>

            {!mailboxId && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                No sending mailbox is set. Statements send from the same firm mailbox as invoices — choose one on the <strong>Emails</strong> tab, or the automatic run will have nothing to send from.
              </p>
            )}
            <p className="flex items-start gap-1 text-[11px] text-[var(--text-muted)]">
              <Info size={11} className="mt-0.5 shrink-0" />
              <span>Automatic statements carry the statement table and the pay button, but no PDF — the scheduled run has no browser to render one. Sending by hand from <strong>Clients → Send statement</strong> attaches the PDF.</span>
            </p>
          </div>
        )}
      </GlassCard>

      {/* Email template */}
      <GlassCard>
        <SectionHeader title="Statement email" subtitle="The covering message; the statement itself is added below it" />
        <div className="space-y-4">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">
              <Mail size={13} className="text-[var(--text-muted)]" />Subject template
            </label>
            <input
              value={form.statementEmailSubject}
              onChange={e => onChange({ statementEmailSubject: e.target.value })}
              disabled={disabled}
              className="w-full rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Message template</label>
            <textarea
              value={form.statementEmailBody}
              onChange={e => onChange({ statementEmailBody: e.target.value })}
              disabled={disabled}
              rows={7}
              className="w-full resize-none rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60"
            />
            {!disabled && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-[11px] text-[var(--text-muted)]">Insert:</span>
                {STATEMENT_MERGE_TAGS.map(t => (
                  <button
                    key={t.tag}
                    onClick={() => onChange({ statementEmailBody: `${form.statementEmailBody}${t.tag}` })}
                    className="rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
                  >{t.label}</button>
                ))}
              </div>
            )}
            <p className="mt-1.5 flex items-start gap-1 text-[11px] text-[var(--text-muted)]">
              <FileText size={11} className="mt-0.5 shrink-0" />
              <span>The statement table, the balance and a &ldquo;View &amp; pay invoice&rdquo; button are added under your message automatically.</span>
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function ModeRow({ label, desc, active, disabled, onClick }: {
  label: string; desc: string; active: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      aria-pressed={active}
      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-[var(--accent)] bg-[var(--accent)]/[0.05]' : 'border-black/10 hover:bg-black/[0.02]'} ${disabled ? 'opacity-60' : ''}`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-[var(--accent)]' : 'border-black/25'}`}>
        {active && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
      </span>
      <span>
        <span className="block text-[13px] font-semibold text-[var(--text-primary)]">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-[var(--text-muted)]">{desc}</span>
      </span>
    </button>
  );
}
