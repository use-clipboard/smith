'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, ArrowLeft } from 'lucide-react';
import { SmithLogoLoader } from '@/components/ui/SmithLogoLoader';

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  // /auth/confirm sends users here with ?error=… when a reset link is invalid
  // or expired — surface it so they know why they're back at the form.
  const urlError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // The endpoint always succeeds (it never reveals whether an account exists),
    // so we show the same confirmation regardless.
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Ignore — still show the neutral confirmation.
    }
    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="glass rounded-2xl p-10 w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-5">
          <Mail size={24} className="text-[var(--accent)]" />
        </div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-2">Check your email</h2>
        <p className="text-sm text-[var(--text-muted)]">
          If an account exists for <strong className="text-[var(--text-primary)]">{email}</strong>, we&apos;ve sent a link to reset your password. It expires shortly, so use it soon.
        </p>
        <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2.5 mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-10 h-10 rounded-xl brightness-0" />
          <span className="text-xl font-bold text-[var(--text-primary)] tracking-tight">SMITH</span>
        </div>
        <p className="text-sm text-[var(--text-muted)]">Reset your password</p>
      </div>

      <div className="glass rounded-2xl p-8">
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-2">Forgot your password?</h2>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          Enter your email and we&apos;ll send you a link to set a new one.
        </p>

        {urlError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg text-sm text-red-700 dark:text-red-400">
            {urlError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Email address</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@firm.co.uk"
                className="input-base pl-9"
              />
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
            {loading ? (
              <>
                <SmithLogoLoader size={18} className="text-white" />
                Sending…
              </>
            ) : (
              'Send reset link'
            )}
          </button>
        </form>

        <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordContent />
    </Suspense>
  );
}
