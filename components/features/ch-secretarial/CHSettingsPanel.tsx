'use client';
import { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Save, Trash2, CheckCircle, AlertTriangle, ExternalLink, ChevronDown, ChevronUp, Lock } from 'lucide-react';

interface CHSettingsPanelProps {
  isAdmin: boolean;
}

export default function CHSettingsPanel({ isAdmin }: CHSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/firms/ch-api-key')
      .then(r => r.json())
      .then(d => { setHasKey(d.hasKey); setMaskedKey(d.maskedKey ?? null); })
      .catch(() => {});
  }, [isAdmin]);

  async function handleSave() {
    if (!inputKey.trim()) return;
    setSaving(true); setError(''); setSuccess('');
    const res = await fetch('/api/firms/ch-api-key', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: inputKey.trim() }),
    });
    setSaving(false);
    if (res.ok) {
      setHasKey(true);
      setMaskedKey(`${'•'.repeat(Math.max(0, inputKey.length - 4))}${inputKey.slice(-4)}`);
      setInputKey('');
      setSuccess('API key saved.');
    } else {
      setError('Failed to save. Please try again.');
    }
  }

  async function handleDelete() {
    if (!confirm('Remove the Companies House API key? The tool will stop working until a new key is added.')) return;
    setDeleting(true); setError(''); setSuccess('');
    const res = await fetch('/api/firms/ch-api-key', { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) { setHasKey(false); setMaskedKey(null); setSuccess('API key removed.'); }
    else setError('Failed to remove key.');
  }

  return (
    <div className="glass-solid rounded-xl border border-[var(--border)] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[var(--bg-nav-hover)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Key size={15} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">API Settings — Companies House</span>
          {isAdmin && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${hasKey ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
              {hasKey ? 'Key configured' : 'No key set'}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={15} className="text-[var(--text-muted)]" /> : <ChevronDown size={15} className="text-[var(--text-muted)]" />}
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-[var(--border)] space-y-5">

          {!isAdmin ? (
            <div className="flex items-start gap-3 p-4 bg-[var(--bg-nav-hover)] rounded-xl">
              <Lock size={15} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--text-secondary)]">
                Only firm administrators can view or manage the Companies House API key. Contact your admin to set this up.
              </p>
            </div>
          ) : (
            <>
              {/* Current key status */}
              {hasKey && maskedKey && (
                <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                  <CheckCircle size={15} className="text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">API key is configured</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-500 font-mono mt-0.5">{maskedKey}</p>
                  </div>
                  <button onClick={handleDelete} disabled={deleting} className="shrink-0 flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors disabled:opacity-50">
                    <Trash2 size={12} /> {deleting ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              )}

              {/* Input */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                  {hasKey ? 'Replace API Key' : 'Add API Key'}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={inputKey}
                      onChange={e => setInputKey(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSave()}
                      placeholder="Paste your Companies House API key…"
                      className="input-base w-full pr-10 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={!inputKey.trim() || saving}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save size={14} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertTriangle size={14} className="shrink-0" /> {error}
                </div>
              )}
              {success && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle size={14} className="shrink-0" /> {success}
                </div>
              )}
            </>
          )}

          {/* Guidance */}
          <div className="space-y-2 p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">How to get a Companies House API Key</p>
            <ol className="text-sm text-blue-800 dark:text-blue-300 space-y-1.5 list-decimal list-inside">
              <li>Go to the <strong>Companies House Developer Hub</strong></li>
              <li>Sign in or create a free account</li>
              <li>Click <strong>"Create an application"</strong></li>
              <li>Give it any name (e.g. "SMITH Secretarial")</li>
              <li>Select <strong>"Live"</strong> environment</li>
              <li>Copy the API key and paste it above</li>
            </ol>
            <a
              href="https://developer.company-information.service.gov.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
            >
              Open Developer Hub <ExternalLink size={11} />
            </a>
            <p className="text-xs text-blue-600 dark:text-blue-500 mt-1">
              The free tier allows up to 600 requests per 5 minutes — sufficient for up to ~200 companies per refresh.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
