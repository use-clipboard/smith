'use client';

import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';

/**
 * Two-tier pricing: Compliance and Practice, priced purely per user with
 * unlimited clients. A team-size slider + monthly/annual toggle drive the live
 * per-card totals. Founding offer (first 100 firms, 25% off for life) is shown
 * as a banner above the cards.
 *
 * These are the public marketing numbers — actual Stripe billing is Phase 2.
 */
const ANNUAL_FACTOR = 10 / 12;  // annual = 2 months free
const FOUNDER_OFF = 0.25;       // first 100 firms, for life

interface Tier {
  id: string;
  name: string;
  perUser: number;
  tagline: string;
  featured?: boolean;
  plusPrefix?: boolean;
  features: { label: string; soon?: boolean }[];
}

const TIERS: Tier[] = [
  {
    id: 'compliance',
    name: 'Compliance',
    perUser: 60,
    tagline: 'Everything you need to do your clients’ compliance work.',
    features: [
      { label: 'Bookkeeping, Capture & Bank-to-CSV' },
      { label: 'Accounts Review & Performance Analysis' },
      { label: 'MTD for Income Tax & Landlord' },
      { label: 'Companies House Secretarial & AML Risk Assessment' },
      { label: 'Document Summariser' },
      { label: 'Accounts Production, Corporation Tax, Self Assessment & Payroll', soon: true },
    ],
  },
  {
    id: 'practice',
    name: 'Practice Suite',
    perUser: 80,
    tagline: 'Everything in Compliance — plus run your whole firm.',
    featured: true,
    plusPrefix: true,
    features: [
      { label: 'Tasks & Document Vault' },
      { label: 'Proposals & Meeting Notes' },
      { label: 'Email Triage & Calendar' },
      { label: 'HR & Staff Hire' },
      { label: 'Firm Policies' },
      { label: 'Client Portals', soon: true },
      { label: 'Timesheets, Invoicing & Newsletter', soon: true },
    ],
  },
];

function money(n: number): string {
  return `£${n % 1 === 0
    ? n.toLocaleString('en-GB')
    : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PricingCalculator() {
  const [users, setUsers] = useState(5);
  const [annual, setAnnual] = useState(false);

  return (
    <div className="relative px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
          Simple pricing that{' '}
          <span className="text-primary-600">scales per user</span>
        </h2>
        <p className="mt-3 text-base text-slate-500">
          One price per team member. <span className="font-semibold text-slate-700">Unlimited clients</span>, always — no per-client fees.
        </p>
      </div>

      {/* Founding offer banner */}
      <div className="mx-auto mt-8 flex max-w-2xl items-center justify-center gap-2 rounded-2xl border border-primary-200 bg-primary-50 px-5 py-3 text-center text-sm font-medium text-primary-800">
        <Sparkles className="h-4 w-4 shrink-0 text-primary-600" />
        <span>
          <strong>Founding offer:</strong> the first 100 firms lock in <strong>25% off — for life.</strong>
        </span>
      </div>

      {/* Controls */}
      <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-6">
        <div className="w-full max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700">How big is your team?</label>
            <span className="rounded-lg bg-white px-3 py-1 text-sm font-bold text-slate-900 ring-1 ring-slate-200">
              {users} {users === 1 ? 'user' : 'users'}
            </span>
          </div>
          <Slider value={users} min={1} max={50} onChange={setUsers} />
        </div>

        <div className="inline-flex rounded-full bg-white p-1 ring-1 ring-slate-200">
          <button
            onClick={() => setAnnual(false)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${!annual ? 'bg-primary-600 text-white' : 'text-slate-500'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${annual ? 'bg-primary-600 text-white' : 'text-slate-500'}`}
          >
            Annual <span className="text-[11px] font-medium">(2 months free)</span>
          </button>
        </div>
      </div>

      {/* Tier cards */}
      <div className="mx-auto mt-10 grid max-w-4xl items-stretch gap-6 sm:grid-cols-2">
        {TIERS.map((tier) => {
          const monthlyPerUser = tier.perUser;
          const annualPerUser = monthlyPerUser * 10;                    // per year — 2 months free
          const headline = annual ? annualPerUser : monthlyPerUser;     // standard price (struck through)
          const founderPerUser = headline * (1 - FOUNDER_OFF);          // founding price — first 100 firms, for life
          const total = founderPerUser * users;                         // team total at the founding price
          const yearSaving = monthlyPerUser * (1 - FOUNDER_OFF) * 2 * users; // annual = 2 founder-months free
          return (
            <div
              key={tier.id}
              className={`relative flex flex-col rounded-3xl border p-8 ${
                tier.featured
                  ? 'border-primary-300 bg-gradient-to-br from-primary-600 to-indigo-600 text-white shadow-[0_24px_60px_-20px_rgba(79,70,229,0.5)]'
                  : 'border-slate-200 bg-white text-slate-900'
              }`}
            >
              {tier.featured && (
                <span className="absolute right-6 top-6 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                  Most popular
                </span>
              )}

              <h3 className={`text-lg font-bold ${tier.featured ? 'text-white' : 'text-slate-900'}`}>{tier.name}</h3>
              <p className={`mt-1 text-sm ${tier.featured ? 'text-white/80' : 'text-slate-500'}`}>{tier.tagline}</p>

              {/* Founding price — standard price struck through */}
              <div className="mt-5 flex items-center gap-2.5 flex-wrap">
                <span className={`text-xl line-through ${tier.featured ? 'text-white/50' : 'text-slate-400'}`}>{money(headline)}</span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tier.featured ? 'bg-emerald-400 text-emerald-950' : 'bg-emerald-100 text-emerald-700'}`}>
                  25% off — for life
                </span>
              </div>
              <div className="mt-1 flex items-end gap-1">
                <span className="font-display text-5xl font-semibold">{money(founderPerUser)}</span>
                <span className={`mb-1.5 text-sm ${tier.featured ? 'text-white/80' : 'text-slate-500'}`}>/ user / {annual ? 'year' : 'month'} <span className="font-semibold">+ VAT</span></span>
              </div>
              <span className={`mt-1 text-xs ${tier.featured ? 'text-white/70' : 'text-slate-400'}`}>
                Founding price · first 100 firms{annual ? ' · billed annually, 2 months free' : ' · billed monthly'}
              </span>

              <div className={`mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold ${tier.featured ? 'bg-white/10 text-white' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'}`}>
                ≈ {money(total)}{annual ? '/year' : '/mo'} + VAT for {users} {users === 1 ? 'user' : 'users'}
              </div>

              {annual && (
                <div className={`mt-2 rounded-lg px-4 py-2 text-sm font-bold text-center ${tier.featured ? 'bg-emerald-400/90 text-emerald-950' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>
                  Annual saves another {money(yearSaving)}/year
                </div>
              )}

              <ul className="mt-6 space-y-2.5">
                {tier.plusPrefix && (
                  <li className={`text-sm font-semibold ${tier.featured ? 'text-white' : 'text-slate-900'}`}>Everything in Compliance, plus:</li>
                )}
                {tier.features.map((f) => (
                  <li key={f.label} className={`flex items-start gap-2 text-sm ${tier.featured ? 'text-white/90' : 'text-slate-600'}`}>
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${tier.featured ? 'text-white' : 'text-primary-600'}`} />
                    <span>
                      {f.label}
                      {f.soon && (
                        <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tier.featured ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                          Soon
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                <li className={`flex items-start gap-2 text-sm font-medium ${tier.featured ? 'text-white' : 'text-slate-700'}`}>
                  <Check className={`mt-0.5 h-4 w-4 shrink-0 ${tier.featured ? 'text-white' : 'text-primary-600'}`} />
                  Unlimited clients
                </li>
              </ul>

              <a
                href="/signup"
                className={`mt-8 inline-flex items-center justify-center rounded-xl px-6 py-3.5 text-sm font-semibold transition-transform hover:-translate-y-0.5 ${
                  tier.featured ? 'bg-white text-primary-700' : 'bg-primary-600 text-white'
                }`}
              >
                Start free trial
              </a>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-sm text-slate-400">
        All prices exclude VAT · No setup fees · Cancel anytime.<br />
        Need a custom plan for a larger practice?{' '}
        <a href="mailto:hello@smithforaccountants.co.uk" className="font-semibold text-primary-600 hover:underline">
          Talk to us
        </a>
      </p>
    </div>
  );
}

function Slider({
  value, min, max, step = 1, onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-2 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-primary-600 [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-primary-600"
      style={{ background: `linear-gradient(to right, #4F46E5 ${pct}%, #E2E8F0 ${pct}%)` }}
    />
  );
}
