'use client';

import { useState, useEffect } from 'react';
import { Landmark, Eye, EyeOff, CheckCircle2, AlertCircle, Trash2, Info } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

// Settings → Tax Studio: the firm's HMRC Government Gateway "Self Assessment for
// agents" credentials, used to file legacy SA100 returns via HMRC's Transaction
// Engine. The password is stored encrypted server-side and never returned here.
export default function SaFilingSettings() {
  const [hasCreds, setHasCreds] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<'firm' | 'env' | null>(null);
  const [vendorOk, setVendorOk] = useState(true);
  const [senderId, setSenderId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  // Inline confirmation (native confirm() is unreliable in embedded browsers).
  const [pendingAction, setPendingAction] = useState<null | 'save' | 'remove'>(null);

  useEffect(() => {
    fetch('/api/firms/sa-filing')
      .then(r => r.json())
      .then(d => {
        setHasCreds(d.hasCredentials ?? false);
        setReady(d.ready ?? false);
        setSource(d.source ?? null);
        setVendorOk(d.vendorIdConfigured ?? false);
        if (d.senderId) setSenderId(d.senderId as string);
      })
      .catch(() => setHasCreds(false));
  }, []);

  function requestSave() {
    setError('');
    if (!senderId.trim() || !password.trim()) return;
    setPendingAction('save');
  }

  async function doSave() {
    setPendingAction(null);
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/firms/sa-filing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: senderId.trim(), password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to save credentials');
        setSaving(false);
        return;
      }
      // Hard refresh so every view (e.g. the Tax Studio Submit card, which reads
      // the filing-credential status once on mount) picks up the change.
      window.location.reload();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  }

  async function doRemove() {
    setPendingAction(null);
    setRemoving(true); setError('');
    try {
      const res = await fetch('/api/firms/sa-filing', { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'Failed to remove credentials');
        setRemoving(false);
        return;
      }
      window.location.reload();
    } catch {
      setError('Failed to remove. Please try again.');
      setRemoving(false);
    }
  }

  return (
    <div className="glass-solid rounded-xl p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
          <Landmark size={18} className="text-[var(--accent)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">HMRC SA100 filing credentials</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Tax Studio files legacy Self Assessment (SA100) returns to HMRC on your clients’ behalf. Enter your firm’s HMRC <strong>Government Gateway “Self Assessment for agents”</strong> sign-in — the same User ID and password you’d use on the HMRC website. This is <em>not</em> your Making Tax Digital Agent Services Account.
          </p>
        </div>
      </div>

      {/* Current status — three states: ready · saved-but-not-ready · not entered */}
      <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm ${
        ready
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-400'
      }`}>
        {ready ? (
          <><CheckCircle2 size={15} className="shrink-0" /> <span>Filing credentials configured{source === 'env' ? ' (system default)' : senderId ? ` — User ID ${senderId}` : ''} — SA100 online filing is enabled.</span></>
        ) : hasCreds ? (
          <><AlertCircle size={15} className="shrink-0" /> <span>Credentials saved, but SA100 online filing isn’t active yet — see the note below.</span></>
        ) : (
          <><AlertCircle size={15} className="shrink-0" /> <span>No filing credentials set — SA100 online filing is disabled until you add them.</span></>
        )}
      </div>

      {!vendorOk && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/30 text-rose-700 dark:text-rose-400">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>The HMRC Vendor ID isn’t configured on the server yet, so filing can’t proceed even with credentials set. Please contact support.</span>
        </div>
      )}

      {/* Inputs */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Government Gateway User ID</label>
          <input
            type="text"
            value={senderId}
            onChange={e => setSenderId(e.target.value)}
            placeholder="e.g. 123456789012"
            className="input-base font-mono text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
            {hasCreds && source === 'firm' ? 'Replace Password' : 'Password'}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Government Gateway password"
                className="input-base pr-10 font-mono text-sm"
                onKeyDown={e => { if (e.key === 'Enter') requestSave(); }}
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <Tooltip label={showPw ? 'Hide password' : 'Show password'} side="left">
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </Tooltip>
              </div>
            </div>
            <button
              onClick={requestSave}
              disabled={saving || !senderId.trim() || !password.trim()}
              className="btn-primary shrink-0"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <p className="text-[11px] text-[var(--text-muted)]">Saving or removing credentials refreshes SMITH so the change applies everywhere — finish any work in progress first.</p>

        {/* Inline confirmation (shared by Save + Remove) */}
        {pendingAction && (
          <div className={`rounded-xl border px-4 py-3 ${pendingAction === 'remove' ? 'border-rose-200 bg-rose-50/70' : 'border-amber-200 bg-amber-50/70'}`}>
            <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              {pendingAction === 'remove' ? 'Remove the firm’s HMRC filing credentials?' : 'Save your HMRC filing credentials?'}
            </p>
            <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
              {pendingAction === 'remove' ? 'SA100 online filing will stop working until new credentials are added. ' : ''}
              SMITH will refresh to apply this — any work in progress (for example a return part-way through analysis) may be lost.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => setPendingAction(null)} className="btn-secondary bg-white">Cancel</button>
              <button onClick={pendingAction === 'remove' ? doRemove : doSave} className="btn-primary flex-1 justify-center">
                {pendingAction === 'remove' ? 'Remove & refresh' : 'Save & refresh'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Remove */}
      {hasCreds && source === 'firm' && (
        <div className="pt-1 border-t border-[var(--border)]">
          <button
            onClick={() => { setError(''); setPendingAction('remove'); }}
            disabled={removing}
            className="flex items-center gap-1.5 text-xs text-[var(--danger)] hover:opacity-80 transition-opacity"
          >
            <Trash2 size={13} />
            {removing ? 'Removing…' : 'Remove credentials'}
          </button>
        </div>
      )}

      {/* Guidance */}
      <div className="pt-1 border-t border-[var(--border)] space-y-2">
        <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5">
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>
            Your password is stored encrypted and is never shown again or sent to your browser.
          </span>
        </p>
      </div>
    </div>
  );
}
