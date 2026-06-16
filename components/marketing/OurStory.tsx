import { Quote } from 'lucide-react';

/**
 * "Made by accountants, for accountants" — the origin story. Left: narrative.
 * Right: a mission card layered over a soft gradient stand-in for the team
 * photo (swap the gradient block for a real <img> when available).
 */
export default function OurStory() {
  return (
    <div className="relative px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        {/* Narrative */}
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">
            Our story
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
            Made by accountants,{' '}
            <span className="text-primary-600">for accountants</span>
          </h2>
          <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
            <p>
              We didn&apos;t set out to build software. We&apos;re an accountancy firm
              — and like every practice, we were drowning in tools, tabs and admin
              that pulled us away from our clients.
            </p>
            <p>
              So we built SMITH for ourselves: one secure workspace where our team
              could use AI safely to triage email, review accounts, handle MTD and
              keep every client document in order.
            </p>
            <p>
              It transformed how we work. Now we&apos;re proud to share it with other
              firms who feel the same pressures we did.
            </p>
          </div>
        </div>

        {/* Mission card over photo placeholder */}
        <div className="relative">
          <div className="aspect-[4/3] overflow-hidden rounded-3xl bg-gradient-to-br from-primary-200 via-indigo-200 to-slate-200 shadow-[0_24px_60px_-20px_rgba(31,38,88,0.3)]">
            {/* Replace this block with a real team photo: <img src="/team.jpg" … /> */}
            <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500/70">
              Team photo
            </div>
          </div>
          <div className="absolute -bottom-6 -left-6 max-w-xs rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_40px_rgba(31,38,88,0.15)]">
            <Quote className="h-6 w-6 text-primary-300" />
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-700">
              Our mission: to help accounting firms work smarter, together — with AI
              they can actually trust.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
