'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check, Undo2, Lock, AlertTriangle } from 'lucide-react';
import AgentHatIcon from '@/components/ui/AgentHatIcon';

interface AgentSettings {
  enabled: boolean;
  daily_input_token_cap: number;
  daily_output_token_cap: number;
  usage_input_tokens: number;
  usage_output_tokens: number;
  usage_window_started_at: string;
}

interface AgentAction {
  id: string;
  action_type: string;
  summary: string;
  plain_description: string | null;
  affected_count: number;
  applied_at: string;
  expires_at: string;
  undone_at: string | null;
  undo_error: string | null;
  performed_by_user: { full_name: string | null; email: string } | null;
  undone_by_user:    { full_name: string | null; email: string } | null;
}

const FORBIDDEN_ENTITIES = [
  'Users / staff accounts',
  'Firm settings (name, logo, subscription)',
  'API keys (Anthropic, Gmail, Google Drive)',
  'Module enable/disable',
  'Billing / payment data',
  'Document vault contents',
  'AI usage logs',
  'Notifications',
  'Agent Smith\'s own audit log (this list)',
];

export default function AgentSmithSettingsTab() {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch('/api/agent/settings'),
        fetch('/api/agent/actions'),
      ]);
      if (sRes.ok) setSettings((await sRes.json()).settings);
      if (aRes.ok) setActions((await aRes.json()).actions ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function saveSettings(patch: Partial<AgentSettings>) {
    setSaving(true);
    try {
      const r = await fetch('/api/agent/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        setSettings(s => s ? { ...s, ...patch } as AgentSettings : s);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
      } else {
        alert('Failed to save settings.');
      }
    } finally { setSaving(false); }
  }

  async function undoAction(id: string) {
    if (!confirm('Restore the data this action changed?')) return;
    setUndoingId(id);
    try {
      const r = await fetch(`/api/agent/actions/${id}/undo`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error ?? 'Undo failed');
        return;
      }
      await load();
    } finally { setUndoingId(null); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!settings) {
    return <p className="text-sm text-red-500">Failed to load Agent Smith settings.</p>;
  }

  const inputPct  = Math.min(100, Math.round((settings.usage_input_tokens  / settings.daily_input_token_cap)  * 100));
  const outputPct = Math.min(100, Math.round((settings.usage_output_tokens / settings.daily_output_token_cap) * 100));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
            <AgentHatIcon size={18} className="text-gray-700 dark:text-gray-200" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Agent Smith</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Admin-only agentic mode of Ask Smith. Can run reports and make bulk changes to tasks and clients.
              Every change is snapshotted and can be undone within 24 hours.
            </p>
          </div>
        </div>
      </div>

      {/* Enable / disable */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Agent Smith enabled</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">When off, admins cannot use Agent mode anywhere in the app.</p>
          </div>
          <button
            onClick={() => saveSettings({ enabled: !settings.enabled })}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${settings.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
            aria-label="Toggle Agent Smith"
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${settings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Usage + budgets */}
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Daily token budget</h3>
          {savedFlash && <span className="text-xs text-emerald-500 flex items-center gap-1"><Check size={12} /> Saved</span>}
        </div>
        <p className="text-xs text-[var(--text-muted)]">Resets 24 hours after first use of the day. Higher caps = higher Anthropic spend.</p>

        <div>
          <label className="text-xs font-medium text-[var(--text-muted)]">Input tokens / 24h</label>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="number"
              defaultValue={settings.daily_input_token_cap}
              onBlur={e => {
                const v = parseInt(e.target.value, 10);
                if (v > 0 && v !== settings.daily_input_token_cap) saveSettings({ daily_input_token_cap: v });
              }}
              className="input-base w-40"
              min={1000}
              max={5_000_000}
            />
            <div className="flex-1">
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className={`h-full ${inputPct >= 90 ? 'bg-red-500' : 'bg-[var(--accent)]'}`} style={{ width: `${inputPct}%` }} />
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">{settings.usage_input_tokens.toLocaleString()} / {settings.daily_input_token_cap.toLocaleString()} used</p>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-[var(--text-muted)]">Output tokens / 24h</label>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="number"
              defaultValue={settings.daily_output_token_cap}
              onBlur={e => {
                const v = parseInt(e.target.value, 10);
                if (v > 0 && v !== settings.daily_output_token_cap) saveSettings({ daily_output_token_cap: v });
              }}
              className="input-base w-40"
              min={1000}
              max={5_000_000}
            />
            <div className="flex-1">
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className={`h-full ${outputPct >= 90 ? 'bg-red-500' : 'bg-[var(--accent)]'}`} style={{ width: `${outputPct}%` }} />
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">{settings.usage_output_tokens.toLocaleString()} / {settings.daily_output_token_cap.toLocaleString()} used</p>
            </div>
          </div>
        </div>
      </div>

      {/* What Agent Smith CANNOT do */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-2 mb-3">
          <Lock size={14} className="text-amber-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">What Agent Smith cannot touch</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">By design, these areas are completely outside Agent Smith&apos;s tool surface. Even with admin confirmation, it cannot read or modify them.</p>
          </div>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-[var(--text-secondary)] pl-6 list-disc">
          {FORBIDDEN_ENTITIES.map(e => <li key={e}>{e}</li>)}
        </ul>
      </div>

      {/* Audit history */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">History</h3>
          <button onClick={load} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">Refresh</button>
        </div>
        {actions.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No Agent Smith actions yet.</p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">When</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Who</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Change</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Rows</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {actions.map(a => {
                  const expired = new Date(a.expires_at).getTime() < Date.now();
                  const undone = !!a.undone_at;
                  return (
                    <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700/40 last:border-0">
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {new Date(a.applied_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-200">
                        {a.performed_by_user?.full_name || a.performed_by_user?.email || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-800 dark:text-gray-100">
                        <p>{a.summary}</p>
                        {a.plain_description && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{a.plain_description}</p>}
                        {undone && (
                          <p className="text-[11px] text-emerald-600 mt-1">↩ Undone by {a.undone_by_user?.full_name || a.undone_by_user?.email || 'admin'}</p>
                        )}
                        {a.undo_error && (
                          <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1"><AlertTriangle size={11} /> Undo previously failed: {a.undo_error}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-right text-gray-700 dark:text-gray-200">{a.affected_count}</td>
                      <td className="px-3 py-2 text-right">
                        {!undone && !expired && (
                          <button
                            onClick={() => undoAction(a.id)}
                            disabled={undoingId === a.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors disabled:opacity-50"
                          >
                            {undoingId === a.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />} Undo
                          </button>
                        )}
                        {!undone && expired && <span className="text-[11px] text-gray-400">Window expired</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
