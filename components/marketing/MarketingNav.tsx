'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import WaitlistButton from './WaitlistButton';

/**
 * Public marketing top navigation. Transparent over the hero, then fades in a
 * white glass bar once the user scrolls. Mirrors the SMITH app brand mark
 * (logo.png + bold "SMITH" wordmark) so the site and the app feel like one
 * product.
 */
const NAV_LINKS = [
  { label: 'Product', href: '#tools' },
  { label: 'Tools', href: '#showcase' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Resources', href: '#video' },
  { label: 'About us', href: '#story' },
  { label: 'FAQ', href: '#faq' },
];

export default function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? (window.scrollY / max) * 100 : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/80 backdrop-blur-md border-b border-slate-200/70 shadow-[0_1px_20px_rgba(31,38,88,0.05)]'
          : 'bg-transparent border-b border-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1900px] items-center justify-between px-4 sm:px-6 lg:px-10">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-8 w-8 rounded-md" />
            <span className="text-lg font-extrabold tracking-tight text-slate-900">SMITH</span>
          </Link>
          <span className="hidden items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 sm:inline-flex">
            Coming soon
          </span>
        </div>

        {/* Desktop links */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Actions */}
        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:text-slate-900"
          >
            Log in
          </Link>
          <WaitlistButton
            source="marketing_nav"
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(79,70,229,0.35)] transition-all hover:-translate-y-0.5 hover:bg-primary-700"
          >
            Join the waitlist
          </WaitlistButton>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 md:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? (
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {/* Scroll-progress bar along the bottom of the nav */}
      <div className="absolute inset-x-0 top-16 h-[3px] overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-primary-500 to-indigo-500"
          style={{ width: `${progress}%`, transition: 'width 0.1s linear' }}
        />
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-slate-200/70 bg-white/95 backdrop-blur-md md:hidden">
          <nav className="flex w-full flex-col gap-1 px-4 py-4 sm:px-6 lg:px-10">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3">
              <Link href="/login" className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                Log in
              </Link>
              <WaitlistButton
                source="marketing_nav_mobile"
                className="rounded-lg bg-primary-600 px-3 py-2.5 text-center text-sm font-semibold text-white"
              >
                Join the waitlist
              </WaitlistButton>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
