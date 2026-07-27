import { Check, X, TrendingDown } from 'lucide-react';
import Reveal from './Reveal';

/**
 * "One platform replaces your whole stack" — a before/after comparison of the
 * firm's software estate. The left card is the sprawling legacy stack (a tool
 * per job, each its own subscription); the right card is the consolidated
 * SMITH stack. A savings badge sits between them.
 *
 * ── EDIT THE NUMBERS HERE ──────────────────────────────────────────────────
 * Every `cost` is an ESTIMATED whole-firm monthly figure (£/month, ex-VAT) for
 * a ~16-person practice. They are illustrative marketing estimates, not quotes
 * — tune them to match real spend before relying on the totals. The card totals
 * and the saving are all derived from these numbers automatically.
 */
const TEAM_SIZE = 16;
const FOUNDER_OFF = 0.25; // first 50 firms, 25% off for life

interface Tool {
  name: string;
  cost: number; // estimated whole-firm £/month, ex-VAT (the price actually paid)
  tint: string; // tailwind classes for the initial badge
  fullCost?: number; // pre-discount price, struck through when a discount applies
  note?: string; // small caption under the tool name (e.g. "with founder pricing")
}

// The legacy stack — a separate tool (and bill) for every job.
const OLD_STACK: Tool[] = [
  { name: 'Xero', cost: 300, tint: 'bg-sky-100 text-sky-700' },
  { name: 'Dext', cost: 300, tint: 'bg-lime-100 text-lime-700' },
  { name: 'TaxCalc', cost: 180, tint: 'bg-blue-100 text-blue-700' },
  { name: 'Sage', cost: 150, tint: 'bg-emerald-100 text-emerald-700' },
  { name: 'BrightPay', cost: 60, tint: 'bg-orange-100 text-orange-700' },
  { name: 'Karbon', cost: 480, tint: 'bg-violet-100 text-violet-700' },
  { name: 'Chaser', cost: 100, tint: 'bg-rose-100 text-rose-700' },
  { name: 'GoProposal', cost: 120, tint: 'bg-indigo-100 text-indigo-700' },
  { name: 'Indeed', cost: 150, tint: 'bg-blue-100 text-blue-700' },
  { name: 'BrightHR', cost: 80, tint: 'bg-teal-100 text-teal-700' },
  { name: 'Google Workspace', cost: 160, tint: 'bg-amber-100 text-amber-700' },
  { name: 'Slack', cost: 96, tint: 'bg-fuchsia-100 text-fuchsia-700' },
  { name: 'Teams', cost: 96, tint: 'bg-indigo-100 text-indigo-700' },
  { name: 'Outlook', cost: 120, tint: 'bg-sky-100 text-sky-700' },
  { name: 'Claude', cost: 150, tint: 'bg-orange-100 text-orange-700' },
  { name: 'ChatGPT', cost: 160, tint: 'bg-emerald-100 text-emerald-700' },
  { name: 'Mailchimp', cost: 60, tint: 'bg-yellow-100 text-yellow-700' },
];

// The consolidated stack — SMITH plus the two tools worth keeping. SMITH is
// shown at full list price struck through, with the founder price paid.
const SMITH_FULL = 80 * TEAM_SIZE; // Practice Suite, £80/user
const NEW_STACK: Tool[] = [
  {
    name: 'SMITH',
    fullCost: SMITH_FULL,
    cost: Math.round(SMITH_FULL * (1 - FOUNDER_OFF)),
    note: 'with founder pricing',
    tint: 'bg-primary-100 text-primary-700',
  },
  { name: 'Google Workspace', cost: 160, tint: 'bg-amber-100 text-amber-700' },
  { name: 'Claude', cost: 150, tint: 'bg-orange-100 text-orange-700' },
];

const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

function initials(name: string): string {
  const parts = name.split(' ');
  return parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export default function StackComparison() {
  const oldTotal = OLD_STACK.reduce((s, t) => s + t.cost, 0);
  const newFullTotal = NEW_STACK.reduce((s, t) => s + (t.fullCost ?? t.cost), 0);
  const newTotal = NEW_STACK.reduce((s, t) => s + t.cost, 0);
  const saving = oldTotal - newTotal;
  const savingYear = saving * 12;

  return (
    <div className="px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
          One platform replaces{' '}
          <span className="text-primary-600">your whole stack</span>
        </h2>
        <p className="mt-3 text-base text-slate-500">
          We used to pay for a different tool for every job. Now our firm runs on three.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
        {/* BEFORE */}
        <Reveal>
          <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-slate-50/70 p-6 sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Before SMITH
                </span>
                <p className="mt-3 text-sm font-medium text-slate-500">
                  {OLD_STACK.length}+ tools · {OLD_STACK.length}+ logins · {OLD_STACK.length}+ bills
                </p>
              </div>
              <div className="text-right">
                <div className="font-display text-3xl font-semibold text-slate-800">
                  {money(oldTotal)}
                </div>
                <div className="text-xs text-slate-400">/ month +</div>
              </div>
            </div>

            <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OLD_STACK.map((t) => (
                <li
                  key={t.name}
                  className="flex items-center gap-2.5 rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${t.tint}`}>
                    {initials(t.name)}
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium text-slate-600">{t.name}</span>
                  <span className="text-[12px] font-semibold text-slate-400">{money(t.cost)}</span>
                </li>
              ))}
              <li className="flex items-center gap-2.5 rounded-xl border border-dashed border-slate-200 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[13px] font-bold text-slate-400">
                  <X className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 text-[13px] font-medium text-slate-400">…and more</span>
              </li>
            </ul>
          </div>
        </Reveal>

        {/* ARROW / SAVING */}
        <div className="flex items-center justify-center lg:flex-col">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center">
            <TrendingDown className="h-5 w-5 text-emerald-600" />
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">You save</div>
            <div className="font-display text-2xl font-semibold text-emerald-700">{money(saving)}</div>
            <div className="text-[11px] font-medium text-emerald-600">per month</div>
            <div className="mt-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
              ≈ {money(savingYear)}/yr
            </div>
          </div>
        </div>

        {/* AFTER */}
        <Reveal delay={120}>
          <div className="flex h-full flex-col rounded-3xl border border-primary-300 bg-gradient-to-br from-primary-600 to-indigo-600 p-6 text-white shadow-[0_24px_60px_-20px_rgba(79,70,229,0.5)] sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                  With SMITH
                </span>
                <p className="mt-3 text-sm font-medium text-white/80">
                  {NEW_STACK.length} tools · one platform · one bill
                </p>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-white/50 line-through">{money(newFullTotal)}</div>
                <div className="font-display text-3xl font-semibold text-white">{money(newTotal)}</div>
                <div className="text-xs text-white/60">/ month · founder price</div>
              </div>
            </div>

            <ul className="mt-6 space-y-2.5">
              {NEW_STACK.map((t) => (
                <li
                  key={t.name}
                  className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3"
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold ${t.tint}`}>
                    {initials(t.name)}
                  </span>
                  <span className="flex-1">
                    <span className="text-sm font-semibold text-white">{t.name}</span>
                    {t.note && (
                      <span className="mt-0.5 block text-[11px] font-medium text-white/60">{t.note}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-white/70">
                    {t.fullCost && (
                      <span className="text-white/40 line-through">{money(t.fullCost)}</span>
                    )}
                    <span className="font-semibold text-white">{money(t.cost)}</span>
                  </span>
                </li>
              ))}
            </ul>

            <ul className="mt-6 space-y-2 border-t border-white/15 pt-5">
              {[
                'Bookkeeping, accounts & tax in one place',
                'Email, tasks, proposals & HR built in',
                'AI woven through every workflow',
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-white/90">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-white" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-slate-400">
        Illustrative estimates for a {TEAM_SIZE}-person firm, ex-VAT. Your actual spend will vary by
        team size and the plans you hold — the point is the sprawl, not the exact pound.
      </p>
    </div>
  );
}
