import { Mail, TrendingUp, FileText, FolderLock, NotebookPen, ListChecks } from 'lucide-react';
import BrowserFrame from './BrowserFrame';
import AppShot from './AppShot';
import CountUp from './CountUp';

/**
 * "Tools that power your firm forward" — a collage: copy on the left, and on the
 * right a real app screenshot in a browser frame with floating tool chips
 * orbiting it (matching the SMITH landing mockup). A stats strip sits below.
 *
 * Drop the centre screenshot at /public/marketing/tools.png — until then a mock
 * renders in its place.
 */
// Positions hug the screenshot's left/right edges so the chips frame it without
// covering the sidebar, top search bar or the centre cards.
const CHIPS: { icon: typeof Mail; label: string; pos: string }[] = [
  { icon: Mail, label: 'Email Triage', pos: 'top-12 -left-5' },
  { icon: TrendingUp, label: 'Accounts Review', pos: 'top-6 -right-6' },
  { icon: FileText, label: 'Documents', pos: 'top-1/2 -translate-y-1/2 -left-8' },
  { icon: NotebookPen, label: 'Meeting Notes', pos: 'top-1/2 -translate-y-1/2 -right-8' },
  { icon: FolderLock, label: 'Document Vault', pos: 'bottom-12 -left-4' },
  { icon: ListChecks, label: 'Tasks', pos: 'bottom-7 -right-5' },
];

const STATS: { value: number | null; suffix?: string; display?: string; l: string }[] = [
  { value: 10, suffix: '+', l: 'Powerful tools' },
  { value: 1, l: 'Integrated platform' },
  { value: 1000, suffix: '+', l: 'Happy accountants' },
  { value: null, display: '∞', l: 'Time saved' },
];

export default function ToolShowcase() {
  return (
    <div className="relative px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        {/* Copy */}
        <div>
          <span className="inline-flex rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary-700">
            Tools
          </span>
          <h2 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[2.4rem]">
            Tools that power<br className="hidden sm:block" /> your firm{' '}
            <span className="text-primary-600">forward</span>
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-slate-500">
            Every tool in SMITH is designed to save you time, reduce risk and help you
            deliver exceptional client experiences — all in one integrated workspace.
          </p>
          <a
            href="#tools"
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(79,70,229,0.35)] transition-all hover:-translate-y-0.5 hover:bg-primary-700"
          >
            See all tools
          </a>
        </div>

        {/* Collage */}
        <div className="relative px-1 py-4 sm:px-2 sm:py-6">
          <div className="absolute -inset-5 -z-10 rounded-[36px] bg-gradient-to-tr from-primary-100/70 via-indigo-100/50 to-transparent blur-2xl" />

          <BrowserFrame>
            <AppShot
              src="/marketing/tools.png"
              alt="SMITH tools workspace"
              fallback={<CollageMock />}
            />
          </BrowserFrame>

          {/* Floating chips */}
          {CHIPS.map((c) => (
            <div
              key={c.label}
              className={`absolute ${c.pos} hidden items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-[0_10px_30px_-8px_rgba(31,38,88,0.25)] sm:flex`}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                <c.icon className="h-4 w-4" />
              </span>
              <span className="whitespace-nowrap text-[12px] font-semibold text-slate-700">{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats strip — numbers count up when scrolled into view. */}
      <div className="mt-16 grid grid-cols-2 gap-6 border-t border-slate-100 pt-10 sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.l} className="text-center">
            <div className="text-3xl font-extrabold tracking-tight text-primary-600">
              {s.value === null ? s.display : <CountUp value={s.value} suffix={s.suffix} />}
            </div>
            <div className="mt-1 text-sm text-slate-500">{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Fallback mock for the collage centre until a real screenshot is supplied. */
function CollageMock() {
  const rows = [
    { c: 'GL', n: 'Green Ltd', s: 'VAT return ready', t: 'Review' },
    { c: 'AL', n: 'Ace Ltd', s: 'Payroll for June', t: 'Action' },
    { c: 'MR', n: 'Mikyaal Rest.', s: 'Receipts uploaded', t: 'Ready' },
    { c: 'OK', n: 'Oakwood', s: 'Accounts review', t: 'Draft' },
    { c: 'TC', n: 'Thomas & Co', s: 'MTD submission', t: 'Done' },
  ];
  return (
    <div className="bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-800">Client work</h4>
        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">
          This week
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.n} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-[11px] font-bold text-primary-700">
              {r.c}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-slate-800">{r.n}</div>
              <div className="truncate text-[11px] text-slate-500">{r.s}</div>
            </div>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
              {r.t}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
