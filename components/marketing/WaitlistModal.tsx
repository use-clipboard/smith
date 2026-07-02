'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Check, Loader2, Sparkles } from 'lucide-react';

type Status = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Pre-launch "Join the waitlist" lightbox. Collects an email (+ optional firm
 * name), posts to /api/waitlist, and confirms inline. Closes on Esc / backdrop
 * click. Rendered once by WaitlistProvider.
 */
export default function WaitlistModal({
  open,
  source,
  onClose,
}: {
  open: boolean;
  source?: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [firmName, setFirmName] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the email field on open; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Reset back to the form shortly after closing so a re-open is clean.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setStatus('idle');
      setError(null);
      setEmail('');
      setFirmName('');
      setWebsite('');
    }, 250);
    return () => clearTimeout(t);
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firmName: firmName || undefined, source, website }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="waitlist-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Card */}
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-7 pb-7 pt-8">
          {status === 'success' ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <h2 id="waitlist-title" className="mt-4 text-xl font-bold text-slate-900">
                You&apos;re on the list
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Thanks — we&apos;ll email you the moment SMITH is ready for new firms. Keep an eye on
                your inbox (and check your spam folder just in case).
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
                <Sparkles className="h-3.5 w-3.5" />
                Launching soon
              </span>
              <h2 id="waitlist-title" className="mt-4 text-xl font-bold text-slate-900">
                Join the waitlist
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                SMITH isn&apos;t open to new firms just yet. Leave your email and we&apos;ll let you
                know the moment it&apos;s ready — one email, no spam.
              </p>

              <form onSubmit={submit} className="mt-5 space-y-3">
                <div>
                  <label htmlFor="waitlist-email" className="sr-only">
                    Work email
                  </label>
                  <input
                    ref={inputRef}
                    id="waitlist-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourfirm.co.uk"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                  />
                </div>
                <div>
                  <label htmlFor="waitlist-firm" className="sr-only">
                    Firm name (optional)
                  </label>
                  <input
                    id="waitlist-firm"
                    type="text"
                    value={firmName}
                    onChange={(e) => setFirmName(e.target.value)}
                    placeholder="Firm name (optional)"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                  />
                </div>

                {/* Honeypot — visually hidden, off-screen; bots fill it, humans don't. */}
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="absolute left-[-9999px] h-0 w-0 opacity-0"
                />

                {status === 'error' && error && (
                  <p className="text-sm font-medium text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(79,70,229,0.35)] transition-all hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {status === 'submitting' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Joining…
                    </>
                  ) : (
                    'Notify me at launch'
                  )}
                </button>
                <p className="text-center text-xs text-slate-400">
                  We&apos;ll only use your email to tell you when SMITH is live.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
