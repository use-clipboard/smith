'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Loader2, Settings2, ToggleLeft, ToggleRight } from 'lucide-react';
import type { EmailRule } from '@/app/api/email/rules/route';
import type { GmailLabel } from '@/lib/gmail';

interface Props {
  open: boolean;
  onClose: () => void;
  labels: GmailLabel[];
  /** Called after a rule is applied to existing mail, so the inbox can refresh. */
  onApplied?: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  from:      'From (sender)',
  to:        'To (recipient)',
  subject:   'Subject',
  has_words: 'Body contains',
};

const OPERATOR_LABELS: Record<string, string> = {
  contains:    'contains',
  equals:      'equals',
  starts_with: 'starts with',
  ends_with:   'ends with',
};

const ACTION_LABELS: Record<string, string> = {
  archive:    'Archive',
  label:      'Apply label',
  mark_read:  'Mark as read',
  star:       'Star',
  trash:      'Move to Trash',
};

type Field    = EmailRule['condition_field'];
type Operator = EmailRule['condition_operator'];
type Action   = EmailRule['action_type'];

export default function EmailRulesModal({ open, onClose, labels, onApplied }: Props) {
  const [rules, setRules]   = useState<EmailRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // New rule form
  const [name,      setName]      = useState('');
  const [field,     setField]     = useState<Field>('from');
  const [operator,  setOperator]  = useState<Operator>('contains');
  const [value,     setValue]     = useState('');
  const [action,    setAction]    = useState<Action>('archive');
  const [labelId,   setLabelId]   = useState('');
  const [showForm,  setShowForm]  = useState(false);
  // "Also apply to existing matching emails" — a one-time mailbox sweep on save.
  const [applyExisting, setApplyExisting] = useState(false);
  const [applyNote, setApplyNote] = useState('');

  // User labels only for the label selector
  const userLabels = labels.filter(l => l.type === 'user');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/email/rules')
      .then(r => r.ok ? r.json() : { rules: [] })
      .then((d: { rules: EmailRule[] }) => setRules(d.rules ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  async function handleToggle(rule: EmailRule) {
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_active: !r.is_active } : r));
    await fetch(`/api/email/rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !rule.is_active }),
    }).catch(() => {});
  }

  async function handleDelete(id: string) {
    setRules(prev => prev.filter(r => r.id !== id));
    await fetch(`/api/email/rules/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  async function handleCreate() {
    if (!value.trim()) { setError('Enter a condition value.'); return; }
    if (action === 'label' && !labelId) { setError('Select a label to apply.'); return; }
    setSaving(true);
    setError('');
    try {
      const selectedLabel = userLabels.find(l => l.id === labelId);
      const res = await fetch('/api/email/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:               name.trim() || `${FIELD_LABELS[field]} ${OPERATOR_LABELS[operator]} "${value.trim()}" → ${ACTION_LABELS[action]}`,
          condition_field:    field,
          condition_operator: operator,
          condition_value:    value.trim(),
          action_type:        action,
          action_label_id:    action === 'label' ? labelId : null,
          action_label_name:  action === 'label' ? (selectedLabel?.name ?? null) : null,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { rule: EmailRule };
      setRules(prev => [...prev, data.rule]);

      // Optionally sweep existing mail and apply the action to every match.
      if (applyExisting) {
        try {
          const ar = await fetch(`/api/email/rules/${data.rule.id}/apply`, { method: 'POST' });
          const aj = await ar.json().catch(() => ({})) as { applied?: number; capped?: boolean; error?: string };
          if (ar.ok) {
            const n = aj.applied ?? 0;
            setApplyNote(n === 0
              ? 'Rule saved — no existing emails matched.'
              : `Rule saved and applied to ${n}${aj.capped ? '+' : ''} existing email${n === 1 ? '' : 's'}.`);
            if (n > 0) onApplied?.();
          } else {
            setApplyNote(aj.error ?? 'Rule saved, but applying to existing emails failed.');
          }
        } catch {
          setApplyNote('Rule saved, but applying to existing emails failed.');
        }
      }

      // Reset form
      setName(''); setValue(''); setLabelId('');
      setField('from'); setOperator('contains'); setAction('archive');
      setApplyExisting(false);
      setShowForm(false);
    } catch {
      setError('Failed to save rule. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg-card-solid)] w-full max-w-lg rounded-2xl shadow-2xl border border-[var(--border)] flex flex-col overflow-hidden" style={{ maxHeight: '85vh' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="h-9 w-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
            <Settings2 size={16} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">Email Rules</h2>
            <p className="text-xs text-[var(--text-muted)]">Auto-archive, label, or act on emails matching conditions</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Rules list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">

          {applyNote && (
            <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] px-3 py-2 text-xs text-[var(--text-secondary)] flex items-center justify-between gap-2">
              <span>{applyNote}</span>
              <button onClick={() => setApplyNote('')} aria-label="Dismiss" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0">
                <X size={12} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
            </div>
          ) : rules.length === 0 && !showForm ? (
            <div className="text-center py-10">
              <Settings2 size={28} className="text-[var(--text-muted)] mx-auto mb-3 opacity-30" />
              <p className="text-sm text-[var(--text-secondary)] font-medium">No rules yet</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Create a rule to automatically act on incoming emails.</p>
            </div>
          ) : (
            rules.map(rule => (
              <div
                key={rule.id}
                className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                  rule.is_active
                    ? 'border-[var(--border)] bg-[var(--bg-page)]'
                    : 'border-[var(--border)] bg-[var(--bg-nav-hover)] opacity-60'
                }`}
              >
                <button onClick={() => handleToggle(rule)} className="shrink-0 mt-0.5 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                  {rule.is_active
                    ? <ToggleRight size={20} className="text-[var(--accent)]" />
                    : <ToggleLeft  size={20} />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{rule.name}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    If <span className="font-medium text-[var(--text-secondary)]">{FIELD_LABELS[rule.condition_field]}</span>
                    {' '}{OPERATOR_LABELS[rule.condition_operator]}{' '}
                    <span className="font-medium text-[var(--text-secondary)]">&ldquo;{rule.condition_value}&rdquo;</span>
                    {' → '}
                    <span className="font-medium text-[var(--accent)]">{ACTION_LABELS[rule.action_type]}{rule.action_label_name ? ` "${rule.action_label_name}"` : ''}</span>
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="shrink-0 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}

          {/* New rule form */}
          {showForm && (
            <div className="border border-[var(--border)] rounded-xl p-4 bg-[var(--bg-page)] space-y-3">
              <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">New Rule</p>

              {/* Optional name */}
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Rule name (optional)"
                className="w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card-solid)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />

              {/* Condition row */}
              <div className="flex gap-2">
                <select
                  value={field}
                  onChange={e => setField(e.target.value as Field)}
                  className="flex-1 text-sm border border-[var(--border)] rounded-lg px-2 py-2 bg-[var(--bg-card-solid)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  {Object.entries(FIELD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select
                  value={operator}
                  onChange={e => setOperator(e.target.value as Operator)}
                  className="flex-1 text-sm border border-[var(--border)] rounded-lg px-2 py-2 bg-[var(--bg-card-solid)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  {Object.entries(OPERATOR_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <input
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="Value to match…"
                className="w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--bg-card-solid)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />

              {/* Action row */}
              <div className="flex gap-2">
                <select
                  value={action}
                  onChange={e => setAction(e.target.value as Action)}
                  className="flex-1 text-sm border border-[var(--border)] rounded-lg px-2 py-2 bg-[var(--bg-card-solid)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  {Object.entries(ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {action === 'label' && (
                  <select
                    value={labelId}
                    onChange={e => setLabelId(e.target.value)}
                    className="flex-1 text-sm border border-[var(--border)] rounded-lg px-2 py-2 bg-[var(--bg-card-solid)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="">Select label…</option>
                    {userLabels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                )}
              </div>

              {/* Also apply to existing mail — a one-time sweep on save. */}
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyExisting}
                  onChange={e => setApplyExisting(e.target.checked)}
                  className="accent-[var(--accent)] w-3.5 h-3.5"
                />
                Also apply to existing matching emails
              </label>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowForm(false); setError(''); }}
                  className="text-sm px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="text-sm px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity font-medium flex items-center gap-1.5"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />}
                  {saving && applyExisting ? 'Applying…' : 'Save Rule'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border)] shrink-0 flex items-center justify-between bg-[var(--bg-nav-hover)] rounded-b-2xl">
          <p className="text-xs text-[var(--text-muted)]">
            Rules run on new unread emails — tick &ldquo;apply to existing&rdquo; to also sweep past mail.
          </p>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="text-sm px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 font-medium flex items-center gap-1.5 transition-opacity"
            >
              <Plus size={13} /> New Rule
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
