'use client';

import { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle, Trash2, ExternalLink } from 'lucide-react';

export default function ApiKeySettings() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/firms/api-key')
      .then(r => r.json())
      .then(d => setHasKey(d.hasKey ?? false))
      .catch(() => setHasKey(false));
  }, []);

  async function handleSave() {
    if (!inputKey.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/firms/api-key', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: inputKey.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Failed to save API key');
        return;
      }
      setHasKey(true);
      setInputKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Remove the AI API key? All AI features will stop working until a new key is added.')) return;
    setRemoving(true);
    setError('');
    try {
      const res = await fetch('/api/firms/api-key', { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Failed to remove API key');
        return;
      }
      setHasKey(false);
    } catch {
      setError('Failed to remove. Please try again.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="glass-solid rounded-xl p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
          <Key size={18} className="text-[var(--accent)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI API Key</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            SMITH uses the Anthropic Claude API to power all AI features. Your firm provides its own API key — usage costs are billed directly to you by Anthropic.
          </p>
        </div>
      </div>

      {/* Current status */}
      <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm ${
        hasKey
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-400'
      }`}>
        {hasKey
          ? <><CheckCircle2 size={15} className="shrink-0" /> <span>API key configured — AI features are active.</span></>
          : <><AlertCircle size={15} className="shrink-0" /> <span>No API key set — AI features are disabled until you add one.</span></>
        }
      </div>

      {/* Input */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
          {hasKey ? 'Replace API Key' : 'Enter API Key'}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={inputKey}
              onChange={e => setInputKey(e.target.value)}
              placeholder="sk-ant-api03-…"
              className="input-base pr-10 font-mono text-sm"
              onKeyDown={e => { if (e.key === 'Enter') void handleSave(); }}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !inputKey.trim()}
            className="btn-primary shrink-0"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {saved && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
            <CheckCircle2 size={12} /> API key saved successfully.
          </p>
        )}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      {/* Remove existing key */}
      {hasKey && (
        <div className="pt-1 border-t border-[var(--border)]">
          <button
            onClick={handleRemove}
            disabled={removing}
            className="flex items-center gap-1.5 text-xs text-[var(--danger)] hover:opacity-80 transition-opacity"
          >
            <Trash2 size={13} />
            {removing ? 'Removing…' : 'Remove API key'}
          </button>
        </div>
      )}

      {/* How to get a key */}
      <div className="pt-1 border-t border-[var(--border)]">
        <p className="text-xs text-[var(--text-muted)]">
          Don&apos;t have an API key?{' '}
          <a
            href="https://console.anthropic.com/account/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline inline-flex items-center gap-1"
          >
            Create one at console.anthropic.com <ExternalLink size={11} />
          </a>
        </p>
      </div>
    </div>
  );
}
