import { Mail, TrendingUp, Calendar, FolderLock, Sparkles, ArrowRight } from 'lucide-react';
import Reveal from './Reveal';

/**
 * "Everything your firm needs" — five tools, light cards with soft pastel
 * icon tiles. Panel-content (no own background): sits inside a bento Panel.
 */
const TOOLS = [
  {
    icon: Mail,
    title: 'Email Triage',
    blurb: 'AI sorts, summarises and prioritises your emails.',
    tile: 'bg-indigo-50 text-indigo-600',
  },
  {
    icon: TrendingUp,
    title: 'Accounts Review',
    blurb: 'Review work faster and deliver more value.',
    tile: 'bg-emerald-50 text-emerald-600',
  },
  {
    icon: Calendar,
    title: 'MTD IT & VAT',
    blurb: 'Submit with confidence. Stay compliant.',
    tile: 'bg-sky-50 text-sky-600',
  },
  {
    icon: FolderLock,
    title: 'Document Vault',
    blurb: 'Smart, secure and always organised.',
    tile: 'bg-amber-50 text-amber-600',
  },
  {
    icon: Sparkles,
    title: 'AI Outputs',
    blurb: 'Automated reports and client-ready insights.',
    tile: 'bg-fuchsia-50 text-fuchsia-600',
  },
];

export default function ToolsGrid() {
  return (
    <div className="px-6 pt-12 sm:px-10 lg:px-14 lg:pt-16">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
          Everything your firm needs to work smarter
        </h2>
        <p className="mt-3 text-base text-slate-500">
          Powerful tools. Built for accountants. Backed by AI.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {TOOLS.map((t, i) => (
          <Reveal key={t.title} delay={i * 80}>
            <div className="group h-full rounded-2xl border border-slate-200/70 bg-white/70 p-5 transition-all hover:-translate-y-1 hover:border-primary-200 hover:bg-white hover:shadow-[0_14px_34px_rgba(31,38,88,0.1)]">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${t.tile}`}>
                <t.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-[15px] font-bold text-slate-900">{t.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{t.blurb}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-primary-600">
                Learn more
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
