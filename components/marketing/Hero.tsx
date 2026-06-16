import Link from 'next/link';
import {
  LayoutDashboard, Mail, Users, ListChecks, Calendar, FileText,
  TrendingUp, FolderLock, Sparkles, ArrowRight, Star, Check,
} from 'lucide-react';
import BrowserFrame from './BrowserFrame';
import AppShot from './AppShot';
import Reveal from './Reveal';

/**
 * Landing hero. Left: headline + CTAs + social proof. Right: a faux SMITH
 * dashboard ("Smith Briefing") rendered in HTML using the real app palette
 * (dark glass sidebar, white content cards, indigo accent) so the preview reads
 * as the genuine product.
 */
export default function Hero() {
  return (
    <div className="relative px-6 py-10 sm:px-10 sm:py-12 lg:px-14 lg:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        {/* Copy — cascades in on load via staggered Reveal delays. */}
        <div>
          <Reveal delay={0} y={14}>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3.5 py-1.5 text-xs font-semibold text-primary-700">
              <Sparkles className="h-3.5 w-3.5" />
              AI-powered workspace for modern firms
            </span>
          </Reveal>

          <Reveal delay={90} y={14}>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.4rem]">
              The all-in-one AI workspace{' '}
              <span className="text-primary-600">for accounting firms</span>
            </h1>
          </Reveal>

          <Reveal delay={180} y={14}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              Save time. Work smarter. Deliver more value. All your work, clients and
              team in one intelligent space — with AI you can actually trust.
            </p>
          </Reveal>

          <Reveal delay={270} y={14}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(79,70,229,0.35)] transition-all hover:-translate-y-0.5 hover:bg-primary-700"
              >
                Start free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="#video"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50"
              >
                Book a demo
              </Link>
            </div>
          </Reveal>

          <Reveal delay={360} y={14}>
            {/* Social proof */}
            <div className="mt-9 flex items-center gap-4">
              <div className="flex -space-x-2.5">
                {['#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1'].map((c, i) => (
                  <div
                    key={i}
                    className="h-9 w-9 rounded-full border-2 border-white"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div>
                <div className="flex items-center gap-0.5 text-amber-400">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-current" />
                  ))}
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  Trusted by <span className="font-semibold text-slate-700">1,000+ accountants</span> across the UK
                </p>
              </div>
            </div>

            {/* Quick trust points */}
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-slate-500">
              {['Free 14-day trial', 'No card required', 'Bank-grade security'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-500" />
                  {t}
                </span>
              ))}
            </div>
          </Reveal>
        </div>

        {/* Product shot — whole dashboard, fully contained (nothing clipped),
            lifted off a vibrant colour glow with floating value callouts and a
            gentle 3D tilt for energy. Gently floats (animate-floaty). Falls back
            to the mock until /public/marketing/dashboard.png exists. */}
        <div className="relative animate-floaty">
          {/* Vibrant colour glow behind the product */}
          <div className="absolute -inset-8 -z-10 rounded-[44px] bg-[radial-gradient(60%_60%_at_64%_38%,rgba(99,102,241,0.55),transparent_70%)] blur-2xl" />
          <div className="absolute -inset-4 -z-10 rounded-[30px] bg-gradient-to-tr from-violet-300/45 via-primary-200/45 to-transparent blur-2xl" />
          {/* Grounding shadow — stays flat under the tilted frame */}
          <div className="absolute inset-x-8 bottom-0 -z-10 h-16 rounded-[50%] bg-slate-900/25 blur-2xl" />

          <div className="transform-gpu transition-transform duration-500 ease-out lg:[transform:perspective(1800px)_rotateY(6deg)_rotateX(2deg)] lg:hover:[transform:perspective(1800px)_rotateY(0deg)_rotateX(0deg)]">
            <BrowserFrame>
              <AppShot src="/marketing/dashboard.png" alt="The SMITH dashboard" fallback={<AppPreview />} />
            </BrowserFrame>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Faux SMITH dashboard ──────────────────────────────────────────────── */

const SIDEBAR_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: Mail, label: 'Email Triage', badge: '340' },
  { icon: Users, label: 'Clients' },
  { icon: ListChecks, label: 'Tasks', badge: '254' },
  { icon: Calendar, label: 'Calendar' },
  { icon: FileText, label: 'Meeting Notes' },
  { icon: TrendingUp, label: 'Performance' },
  { icon: FolderLock, label: 'Document Vault' },
];

function AppPreview() {
  return (
    <div className="bg-white">
      <div className="flex h-[440px]">
        {/* Sidebar */}
        <aside className="hidden w-44 shrink-0 flex-col bg-gradient-to-b from-[#2e3062] to-[#272a5a] p-3 sm:flex">
          <div className="mb-4 flex items-center gap-2 px-1.5 py-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-5 w-5 rounded brightness-0 invert" />
            <span className="text-sm font-bold text-white">SMITH</span>
          </div>
          <nav className="flex flex-col gap-0.5">
            {SIDEBAR_ITEMS.map((it) => (
              <div
                key={it.label}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium ${
                  it.active ? 'bg-white text-[#2e3062]' : 'text-white/85'
                }`}
              >
                <it.icon className="h-3.5 w-3.5" />
                <span className="truncate">{it.label}</span>
                {it.badge && (
                  <span className="ml-auto rounded-full bg-white/20 px-1.5 text-[9px] text-white">
                    {it.badge}
                  </span>
                )}
              </div>
            ))}
          </nav>
          <div className="mt-auto flex items-center gap-2 border-t border-white/10 pt-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold text-white">
              CM
            </div>
            <div className="leading-tight">
              <div className="text-[11px] font-semibold text-white">Christos Marneros</div>
              <div className="text-[9px] text-white/60">Admin</div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 overflow-hidden bg-[#FAFAFE] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Good morning, Christos 👋
              </h3>
              <p className="text-[11px] text-slate-500">
                Here&apos;s what&apos;s happening with your team and clients today.
              </p>
            </div>
            <div className="hidden items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[10px] text-slate-400 ring-1 ring-slate-200 sm:flex">
              Search clients, documents…
            </div>
          </div>

          {/* Briefing card */}
          <div className="rounded-xl bg-gradient-to-br from-[#4f46e5] to-[#6366f1] p-3.5 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Sparkles className="h-3.5 w-3.5" /> Smith Briefing
              </div>
              <span className="text-[10px] text-white/70">12 items need attention</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                { n: '4', l: 'Emails awaiting' },
                { n: '3', l: 'Reviews ready' },
                { n: '2', l: 'Returns due' },
                { n: '3', l: 'MTD pending' },
              ].map((s) => (
                <div key={s.l} className="rounded-lg bg-white/15 p-2 text-center">
                  <div className="text-base font-bold">{s.n}</div>
                  <div className="text-[8px] leading-tight text-white/80">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Two cards */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <PreviewList
              title="Needs attention"
              rows={[
                { code: 'GL', name: 'Green Ltd', tag: 'Overdue', tone: 'red' },
                { code: 'AL', name: 'Ace Ltd', tag: 'Action', tone: 'amber' },
                { code: 'MR', name: 'Mikyaal Rest.', tag: 'Ready', tone: 'green' },
              ]}
            />
            <PreviewDeadlines />
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewList({
  title,
  rows,
}: {
  title: string;
  rows: { code: string; name: string; tag: string; tone: 'red' | 'amber' | 'green' }[];
}) {
  const tones: Record<string, string> = {
    red: 'bg-red-100 text-red-600',
    amber: 'bg-amber-100 text-amber-600',
    green: 'bg-green-100 text-green-600',
  };
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <h4 className="mb-2 text-[11px] font-semibold text-slate-700">{title}</h4>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary-100 text-[9px] font-bold text-primary-700">
              {r.code}
            </div>
            <span className="flex-1 truncate text-[11px] text-slate-700">{r.name}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${tones[r.tone]}`}>
              {r.tag}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewDeadlines() {
  const rows = [
    { d: 'JUN 14', t: 'VAT Return', s: '2 days' },
    { d: 'JUN 17', t: 'Accounts Review', s: '5 days' },
    { d: 'JUN 20', t: 'MTD Submission', s: '8 days' },
  ];
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <h4 className="mb-2 text-[11px] font-semibold text-slate-700">Upcoming deadlines</h4>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.t} className="flex items-center gap-2">
            <div className="rounded-md bg-slate-100 px-1.5 py-0.5 text-center text-[8px] font-bold leading-tight text-slate-500">
              {r.d}
            </div>
            <span className="flex-1 truncate text-[11px] text-slate-700">{r.t}</span>
            <span className="text-[9px] font-medium text-primary-600">{r.s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
