import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import WaitlistButton from './WaitlistButton';

export default function FinalCta() {
  return (
    <section>
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#3b3a8c] via-primary-600 to-indigo-600 px-8 py-16 text-center shadow-[0_30px_80px_-20px_rgba(79,70,229,0.5)] sm:px-16">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-16 right-0 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Be first to know when SMITH launches
          </h2>
          <p className="mt-4 text-lg text-white/85">
            SMITH is launching soon for UK accountancy firms. Join the waitlist and we&apos;ll email
            you the moment it&apos;s ready.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <WaitlistButton
              source="marketing_final_cta"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-semibold text-primary-700 transition-transform hover:-translate-y-0.5"
            >
              Join the waitlist
              <ArrowRight className="h-4 w-4" />
            </WaitlistButton>
            <Link
              href="#video"
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              See how it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
