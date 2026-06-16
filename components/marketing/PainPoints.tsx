import { Layers, Clock, MailWarning, Database, ShieldCheck } from 'lucide-react';
import Reveal from './Reveal';

/**
 * "Built to solve real problems" — the pain-point → SMITH-answer row. Light,
 * panel-content (closes out the same bento panel as the tools grid). Each item
 * is a line icon + bold pain + grey answer.
 */
const POINTS = [
  { icon: Layers, pain: 'Too many tools', answer: 'Everything in one integrated platform.' },
  { icon: Clock, pain: 'Time-consuming work', answer: 'Automate the repetitive, focus on value.' },
  { icon: MailWarning, pain: 'Emails out of control', answer: 'AI triage keeps you on top.' },
  { icon: Database, pain: 'Data everywhere', answer: 'One secure source of truth.' },
  { icon: ShieldCheck, pain: 'AI without governance', answer: 'Safe, controlled AI for your firm.' },
];

export default function PainPoints() {
  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
          Built to solve real problems accountants face every day
        </h2>
      </div>

      <div className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
        {POINTS.map((p, i) => (
          <Reveal key={p.pain} delay={i * 80}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              <p.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-sm font-bold text-slate-900">{p.pain}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{p.answer}</p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
