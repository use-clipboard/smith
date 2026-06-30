'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { SmithLogoLoader } from '@/components/ui/SmithLogoLoader';

type Phase = 'checking' | 'ready' | 'invalid' | 'done';

export default function ResetPasswordPage() {
  const supabase = createClient();

  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // /auth/confirm verifies the token and sets the recovery session before
  // redirecting here. If there's no session, the link was invalid, already used,
  // or opened after expiry — send the user back to request a fresh one.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setPhase(data.user ? 'ready' : 'invalid');
    });
    return () => { cancelled = true; };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords don’t match.'); return; }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSaving(false);
      setError(updateError.message || 'Could not update your password. Please request a new link.');
      return;
    }
    setPhase('done');
    // Brief confirmation, then into the app (the session is already valid).
    setTimeout(() => { window.location.assign('/dashboard'); }, 1400);
  }

  if (phase === 'checking') {
    return (
      <div className="glass rounded-2xl p-10 w-full max-w-sm text-center text-[var(--text-muted)]">
        <SmithLogoLoader size={22} className="mx-auto mb-3" />
        <p className="text-sm">Checking your reset link…</p>
      </div>
    );
  }

  if (phase === 'invalid') {
    return (
      <div className="glass rounded-2xl p-10 w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle size={24} className="text-amber-600" />
        </div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-2">Link expired or invalid</h2>
        <p className="text-sm text-[var(--text-muted)]">
          This password reset link can&apos;t be used. It may have expired or already been used.
        </p>
        <Link href="/forgot-password" className="mt-6 inline-block btn-primary px-4 py-2 text-sm">
          Request a new link
        </Link>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="glass rounded-2xl p-10 w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 size={24} className="text-emerald-600" />
        </div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-2">Password updated</h2>
        <p className="text-sm text-[var(--text-muted)]">Taking you to your dashboard…</p>
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
        <p className="text-sm text-[var(--text-muted)]">Choose a new password</p>
      </div>

      <div className="glass rounded-2xl p-8">
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-6">Set a new password</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">New password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="At least 8 characters"
                className="input-base pl-9"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Confirm new password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                placeholder="••••••••"
                className="input-base pl-9"
              />
            </div>
          </div>

          <button type="submit" disabled={saving} className="btn-primary w-full justify-center py-2.5">
            {saving ? (
              <>
                <SmithLogoLoader size={18} className="text-white" />
                Saving…
              </>
            ) : (
              'Update password'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
