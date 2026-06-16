'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';

/**
 * Interactive "pricing that scales with you" calculator. Two sliders (team
 * members + clients) drive a live estimated monthly price.
 *
 * NOTE: the numbers below are a placeholder pricing model — tweak the three
 * constants to match the real SMITH plan. Defaults give 12 members / 250
 * clients ≈ £192/mo to mirror the design mockup.
 */
const PER_MEMBER = 14;      // £ / team member / month (billed annually)
const PER_CLIENT = 0.096;   // £ / client / month
const ANNUAL_DISCOUNT = 0.2; // 20% off vs monthly billing

const INCLUDED = [
  'No setup fees',
  'Cancel anytime',
  'All tools included',
  'Unlimited document storage',
];

export default function PricingCalculator() {
  const [members, setMembers] = useState(12);
  const [clients, setClients] = useState(250);
  const [annual, setAnnual] = useState(true);

  const monthly = members * PER_MEMBER + clients * PER_CLIENT;
  const price = Math.round(annual ? monthly : monthly / (1 - ANNUAL_DISCOUNT));

  return (
    <div className="relative px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
            Simple, transparent pricing that{' '}
            <span className="text-primary-600">scales with you</span>
          </h2>
          <p className="mt-3 text-base text-slate-500">
            One price for your whole firm. Every tool included — no per-tool add-ons.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-5xl items-stretch gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          {/* Sliders */}
          <div className="rounded-3xl border border-slate-200 bg-slate-50/60 p-8">
            {/* Billing toggle */}
            <div className="mb-8 inline-flex rounded-full bg-white p-1 ring-1 ring-slate-200">
              <button
                onClick={() => setAnnual(true)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  annual ? 'bg-primary-600 text-white' : 'text-slate-500'
                }`}
              >
                Annual <span className="text-[11px] font-medium">(save 20%)</span>
              </button>
              <button
                onClick={() => setAnnual(false)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  !annual ? 'bg-primary-600 text-white' : 'text-slate-500'
                }`}
              >
                Monthly
              </button>
            </div>

            <Slider
              label="How many team members?"
              value={members}
              min={1}
              max={50}
              onChange={setMembers}
              format={(v) => `${v}`}
            />
            <div className="h-8" />
            <Slider
              label="How many clients?"
              value={clients}
              min={10}
              max={1000}
              step={10}
              onChange={setClients}
              format={(v) => `${v}`}
            />
          </div>

          {/* Price card */}
          <div className="flex flex-col rounded-3xl border border-primary-200 bg-gradient-to-br from-primary-600 to-indigo-600 p-8 text-white shadow-[0_24px_60px_-20px_rgba(79,70,229,0.5)]">
            <span className="text-sm font-medium text-white/80">Estimated price</span>
            <div className="mt-2 flex items-end gap-1">
              <span className="font-display text-5xl font-semibold">£{price.toLocaleString()}</span>
              <span className="mb-1.5 text-sm text-white/80">/ month</span>
            </div>
            <span className="mt-1 text-xs text-white/70">
              {annual ? 'Billed annually' : 'Billed monthly'} · {members} members · {clients} clients
            </span>

            <ul className="mt-7 space-y-2.5">
              {INCLUDED.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-white/90">
                  <Check className="h-4 w-4 shrink-0 text-white" />
                  {f}
                </li>
              ))}
            </ul>

            <a
              href="/signup"
              className="mt-auto inline-flex items-center justify-center rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-primary-700 transition-transform hover:-translate-y-0.5"
            >
              Start free trial
            </a>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-slate-400">
          Need a custom plan for a larger practice?{' '}
          <a href="mailto:hello@smith.app" className="font-semibold text-primary-600 hover:underline">
            Talk to us
          </a>
        </p>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        <span className="rounded-lg bg-white px-3 py-1 text-sm font-bold text-slate-900 ring-1 ring-slate-200">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-primary-600 [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-primary-600"
        style={{
          background: `linear-gradient(to right, #4F46E5 ${pct}%, #E2E8F0 ${pct}%)`,
        }}
      />
    </div>
  );
}
