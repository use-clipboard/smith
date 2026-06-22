import Link from 'next/link';

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Tools', href: '#tools' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'See it in action', href: '#video' },
      { label: 'Security', href: '#story' },
    ],
  },
  {
    heading: 'Tools',
    links: [
      { label: 'Email Triage', href: '#tools' },
      { label: 'Accounts Review', href: '#tools' },
      { label: 'MTD IT & VAT', href: '#tools' },
      { label: 'Document Vault', href: '#tools' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Our story', href: '#story' },
      { label: 'Made by accountants', href: '#story' },
      { label: 'Contact', href: 'mailto:hello@smithforaccountants.co.uk' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Welcome video', href: '#video' },
      { label: 'Tutorials', href: '#video' },
      { label: 'Log in', href: '/login' },
    ],
  },
];

export default function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-[1900px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          {/* Brand blurb */}
          <div className="col-span-2">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" className="h-8 w-8 rounded-md" />
              <span className="text-lg font-extrabold tracking-tight text-slate-900">SMITH</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">
              The all-in-one AI workspace for accounting firms. Built by accountants,
              for accountants.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {col.heading}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-slate-600 transition-colors hover:text-primary-600"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-slate-200 pt-6 sm:flex-row">
          <p className="text-sm text-slate-400">
            © {new Date().getFullYear()} SMITH. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm text-slate-400">
            <Link href="/privacy" className="hover:text-slate-600">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-slate-600">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
