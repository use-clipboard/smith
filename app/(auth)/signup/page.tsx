'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, Lock, Building2, User } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { SmithLogoLoader } from '@/components/ui/SmithLogoLoader';

// Self-serve firm signup. Intentionally NOT linked from the login screen or the
// marketing site — reachable only by sharing the /signup URL directly.
export default function SignupPage() {
  const supabase = createClient();

  const [firmName, setFirmName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');

    // 1) Create the firm + admin user server-side.
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firmName, fullName, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? 'Could not create your account. Please try again.');
      return;
    }

    // 2) Sign in with the new credentials (mirrors the login flow).
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setLoading(false);
      // Account exists — send them to login rather than dead-ending here.
      setError('Your account was created — please sign in to continue.');
      return;
    }
    void supabase.auth.signOut({ scope: 'others' }).catch(() => {});
    void fetch('/api/auth/session-checkin', { method: 'POST' }).catch(() => {});
    const safety = setTimeout(() => setLoading(false), 5000);
    try {
      window.location.assign('/dashboard');
    } catch {
      clearTimeout(safety);
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2.5 mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-10 h-10 rounded-xl brightness-0" />
          <span className="text-xl font-bold text-[var(--text-primary)] tracking-tight">SMITH</span>
        </div>
        <p className="text-sm text-[var(--text-muted)]">Create your firm&apos;s account</p>
      </div>

      <div className="glass rounded-2xl p-8">
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-6">Set up your firm on SMITH</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Firm name</label>
            <div className="relative">
              <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input type="text" value={firmName} onChange={e => setFirmName(e.target.value)} required placeholder="Acme Accountants Ltd" className="input-base pl-9" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Your name</label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required placeholder="Jane Smith" className="input-base pl-9" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Email address</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@firm.co.uk" className="input-base pl-9" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="At least 8 characters" className="input-base pl-9" />
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
            {loading ? (
              <>
                <SmithLogoLoader size={18} className="text-white" />
                Creating your firm…
              </>
            ) : (
              'Create firm account'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
          Already have an account? <Link href="/login" className="text-[var(--accent)] hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
