'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase';

type Mode = 'password' | 'magic-link';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(urlError ?? '');
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const supabase = createClient();

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError('Invalid email or password. Please try again.'); setLoading(false); return; }
    // End all other active sessions for this account — one session per user at a time
    await supabase.auth.signOut({ scope: 'others' });
    router.push('/dashboard'); router.refresh();
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    // Pass a flag so the callback can end other sessions after sign-in
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?kick_others=1` } });
    setLoading(false);
    if (error) { setError('Could not send magic link. Please try again.'); return; }
    setMagicLinkSent(true);
  }

  if (magicLinkSent) {
    return (
      <div className="glass-solid rounded-2xl p-10 w-full max-w-sm text-center border border-[var(--border)]">
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-5">
          <Mail size={24} className="text-[var(--accent)]" />
        </div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-2">Check your email</h2>
        <p className="text-sm text-[var(--text-muted)]">
          We sent a sign-in link to <strong className="text-[var(--text-primary)]">{email}</strong>. Click it to log in.
        </p>
        <button onClick={() => setMagicLinkSent(false)} className="mt-6 text-sm text-[var(--accent)] hover:underline">
          Back to login
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2.5 mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-10 h-10 rounded-xl dark:invert" />
          <span className="text-xl font-bold text-[var(--text-primary)] tracking-tight">SMITH</span>
        </div>
        <p className="text-sm text-[var(--text-muted)]">AI-powered accounting workflow tools</p>
      </div>

      <div className="glass-solid rounded-2xl p-8 border border-[var(--border)]">
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-6">Sign in to your account</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-[var(--border-input)] p-1 mb-5 text-sm bg-[var(--bg-nav-hover)]">
          {(['password', 'magic-link'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 rounded-md font-medium transition-all text-sm ${
                mode === m
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {m === 'password' ? 'Password' : 'Magic link'}
            </button>
          ))}
        </div>

        <form onSubmit={mode === 'password' ? handlePasswordLogin : handleMagicLink} className="space-y-4">
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

          {mode === 'password' && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="input-base pl-9"
                />
              </div>
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
            <Sparkles size={15} />
            {loading ? 'Please wait…' : mode === 'password' ? 'Sign in' : 'Send magic link'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
          Need an account? Contact your firm administrator.
        </p>
        <p className="mt-2 text-center text-[11px] text-[var(--text-muted)] opacity-60">
          Signing in will end any other active sessions for this account.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
