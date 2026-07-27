import { Check, TrendingDown } from 'lucide-react';
import Reveal from './Reveal';

/**
 * "Stop paying for 18 tools" — a before/after comparison of the firm's whole
 * software estate. The left card is the sprawling legacy stack (a tool per job,
 * each its own subscription, login and invoice); the right card is the
 * consolidated SMITH stack. A savings badge sits between them.
 *
 * ── EDIT THE NUMBERS HERE ──────────────────────────────────────────────────
 * Every `cost` is an ESTIMATED whole-firm monthly figure (£/month, ex-VAT) for
 * a mid-size practice — ~17 staff and ~2,000 clients. They are illustrative
 * marketing estimates, not quotes — tune them to match real spend. The card
 * totals and the saving are all derived from these numbers automatically.
 */
const TEAM_SIZE = 17;
const FOUNDER_OFF = 0.25; // first 50 firms, 25% off for life

interface Tool {
  name: string;
  cost: number; // estimated whole-firm £/month, ex-VAT (the price actually paid)
  tint: string; // tailwind classes for the initials fallback badge
  logo?: string; // /logos/*.png — real brand mark; falls back to initials if absent
  fullCost?: number; // pre-discount price, struck through when a discount applies
  note?: string; // small caption under the tool name (e.g. "with founder pricing")
}

// The legacy stack — a separate tool (and bill) for every job. Prices are
// whole-firm monthly estimates for a ~17-staff / ~2,000-client practice.
const OLD_STACK: Tool[] = [
  { name: 'Karbon', cost: 1500, logo: '/logos/karbon.png', tint: 'bg-violet-100 text-violet-700' },
  { name: 'Dext', cost: 1500, logo: '/logos/dext.png', tint: 'bg-lime-100 text-lime-700' },
  { name: 'Xero', cost: 800, logo: '/logos/xero.png', tint: 'bg-sky-100 text-sky-700' },
  { name: 'ChatGPT Teams', cost: 425, logo: '/logos/chatgpt.png', tint: 'bg-emerald-100 text-emerald-700' },
  { name: 'HubSpot CRM', cost: 400, logo: '/logos/hubspot.png', tint: 'bg-orange-100 text-orange-700' },
  { name: 'TaxCalc', cost: 350, logo: '/logos/taxcalc.png', tint: 'bg-blue-100 text-blue-700' },
  { name: 'GoProposal', cost: 350, logo: '/logos/goproposal.png', tint: 'bg-indigo-100 text-indigo-700' },
  { name: 'Companies House', cost: 300, tint: 'bg-slate-200 text-slate-600' },
  { name: 'Claude Team', cost: 300, logo: '/logos/claude.png', tint: 'bg-orange-100 text-orange-700' },
  { name: 'Mailchimp', cost: 250, logo: '/logos/mailchimp.png', tint: 'bg-yellow-100 text-yellow-700' },
  { name: 'Zapier', cost: 250, logo: '/logos/zapier.png', tint: 'bg-orange-100 text-orange-700' },
  { name: 'Microsoft 365', cost: 220, logo: '/logos/microsoft.png', tint: 'bg-sky-100 text-sky-700' },
  { name: 'BrightPay', cost: 200, logo: '/logos/brightpay.png', tint: 'bg-orange-100 text-orange-700' },
  { name: 'DocuSign', cost: 200, logo: '/logos/docusign.png', tint: 'bg-amber-100 text-amber-700' },
  { name: 'Slack', cost: 185, logo: '/logos/slack.png', tint: 'bg-fuchsia-100 text-fuchsia-700' },
  { name: 'Google Workspace', cost: 160, logo: '/logos/google-workspace.png', tint: 'bg-amber-100 text-amber-700' },
  { name: 'BrightHR', cost: 150, logo: '/logos/brighthr.png', tint: 'bg-teal-100 text-teal-700' },
  { name: 'Calendly', cost: 120, logo: '/logos/calendly.png', tint: 'bg-sky-100 text-sky-700' },
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
    logo: '/logo.png',
    tint: 'bg-primary-100 text-primary-700',
  },
  { name: 'Google Workspace', cost: 160, logo: '/logos/google-workspace.png', tint: 'bg-amber-100 text-amber-700' },
  { name: 'Claude Team', cost: 300, logo: '/logos/claude.png', tint: 'bg-orange-100 text-orange-700' },
];

// Everything SMITH folds into the one platform.
const SMITH_FEATURES = [
  'Practice Management',
  'CRM',
  'Email',
  'Client Portal',
  'Accounts Production',
  'Bookkeeping',
  'Payroll',
  'MTD for Income Tax',
  'Companies House',
  'HR',
  'Billing',
  'Meeting Notes',
  'AI Assistant',
  'Document Storage',
  'Performance Reporting',
];

const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

function initials(name: string): string {
  const parts = name.split(' ');
  return parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

/**
 * A tool's brand mark on a white tile (so colour logos read on any card
 * background), falling back to a tinted initials badge when no logo is set.
 */
function LogoBadge({ tool, size = 'sm' }: { tool: Tool; size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'h-8 w-8' : 'h-7 w-7';
  if (tool.logo) {
    return (
      <span className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1 ring-1 ring-slate-200/80`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tool.logo} alt={`${tool.name} logo`} loading="lazy" className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${tool.tint}`}>
      {initials(tool.name)}
    </span>
  );
}

export default function StackComparison() {
  const count = OLD_STACK.length;
  const oldTotal = OLD_STACK.reduce((s, t) => s + t.cost, 0);
  const newFullTotal = NEW_STACK.reduce((s, t) => s + (t.fullCost ?? t.cost), 0);
  const newTotal = NEW_STACK.reduce((s, t) => s + t.cost, 0);
  const saving = oldTotal - newTotal;
  const savingYear = saving * 12;

  return (
    <div className="px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
          Stop paying for {count} tools.{' '}
          <span className="text-primary-600">Start running on one.</span>
        </h2>
        <p className="mt-3 text-base text-slate-500">
          SMITH isn’t another practice-management app — it replaces the entire ecosystem
          your firm juggles today.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
        {/* BEFORE */}
        <Reveal>
          <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-slate-50/70 p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Before SMITH
                </span>
                <ul className="mt-3 space-y-0.5 text-sm font-medium text-slate-500">
                  <li>{count} software subscriptions</li>
                  <li>{count} logins to remember</li>
                  <li>{count} invoices every month</li>
                </ul>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-display text-3xl font-semibold text-slate-800">
                  {money(oldTotal)}
                </div>
                <div className="text-xs text-slate-400">/ month</div>
              </div>
            </div>

            <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OLD_STACK.map((t) => (
                <li
                  key={t.name}
                  className="flex items-center gap-2.5 rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2"
                >
                  <LogoBadge tool={t} />
                  <span className="flex-1 truncate text-[13px] font-medium text-slate-600">{t.name}</span>
                  <span className="text-[12px] font-semibold text-slate-400">{money(t.cost)}</span>
                </li>
              ))}
            </ul>

            {/* The pain of the sprawl */}
            <div className="mt-5 flex flex-wrap gap-1.5 border-t border-slate-200/70 pt-4">
              {['Duplicate data', 'Endless tab-switching', 'Integrations that break', 'Multiple support teams'].map((p) => (
                <span key={p} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200/70">
                  {p}
                </span>
              ))}
            </div>
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                  With SMITH
                </span>
                <ul className="mt-3 space-y-0.5 text-sm font-medium text-white/80">
                  <li>One platform</li>
                  <li>One login</li>
                  <li>One source of truth</li>
                </ul>
              </div>
              <div className="shrink-0 text-right">
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
                  <LogoBadge tool={t} size="md" />
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

            {/* Everything the one platform folds in */}
            <div className="mt-6 border-t border-white/15 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                All in one platform
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {SMITH_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-[13px] text-white/90">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {['One database', 'One AI', 'Everything connected'].map((b) => (
                  <span key={b} className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-slate-400">
        Illustrative figures for a {TEAM_SIZE}-person firm with ~2,000 clients, ex-VAT. Your actual
        spend will vary by team size and the plans you hold — the point is the sprawl, not the exact pound.
      </p>
    </div>
  );
}
