import { ChevronDown } from 'lucide-react';

/**
 * Homepage FAQ. Uses native <details>/<summary> so the content is always in the
 * DOM (crawlable, no client JS) and accessible. The same FAQS array drives both
 * the visible accordion AND the FAQPage JSON-LD below — Google requires the
 * structured data to match the on-page content, so keeping one source avoids
 * drift. Answers are plain text (schema-friendly).
 *
 * NOTE: the pricing answer contains live figures — keep it in sync with
 * PricingCalculator.tsx / PLAN_PRICE_PENCE if prices change.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is SMITH?',
    a: 'SMITH is an all-in-one AI workspace for UK accountancy firms. It brings bookkeeping, MTD and VAT, accounts review, performance analysis, email triage, tasks, a document vault and client-ready outputs into one secure platform — so your team spends less time on admin and more time with clients.',
  },
  {
    q: 'Who is SMITH for?',
    a: 'SMITH is built for UK accountancy practices, from sole practitioners to multi-partner firms. It was built by a working accountancy firm for its own team, then opened up to other practices who face the same pressures.',
  },
  {
    q: 'Does SMITH support Making Tax Digital (MTD)?',
    a: 'Yes. SMITH has MTD for VAT and MTD for Income Tax built in, including the HMRC integration and fraud-prevention requirements, alongside bookkeeping and VAT workflows so you can prepare and submit digitally.',
  },
  {
    q: 'How much does SMITH cost?',
    a: 'SMITH is priced per user with unlimited clients — no per-client fees. There are two plans: Compliance at £60 per user per month and Practice Suite at £80 per user per month, both plus VAT. The first 50 firms to sign up lock in a 25% founding discount for life, and annual billing gives two months free.',
  },
  {
    q: 'Is my data secure, and where is it stored?',
    a: 'Security is core to SMITH. Your data is stored in the UK, encrypted in transit and at rest, with row-level isolation so each firm can only ever access its own data. SMITH runs on trusted infrastructure providers and follows UK GDPR.',
  },
  {
    q: 'Do I need my own AI key?',
    a: "SMITH's AI features are powered by Anthropic's Claude. Firms connect their own AI key, so you pay for AI usage directly at cost with no markup — your SMITH subscription covers the software itself.",
  },
  {
    q: 'When is SMITH launching?',
    a: 'SMITH is already in daily use by our own firm and is being prepared for a wider public launch. Join the waitlist and we will email you the moment it is open to new firms.',
  },
];

const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

export default function Faq() {
  return (
    <div className="px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">
            FAQ
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
            Frequently asked questions
          </h2>
        </div>

        <div className="mt-9 space-y-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-slate-200 bg-white p-5 transition-colors open:border-primary-200 sm:p-6"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }}
      />
    </div>
  );
}
