'use client';

import { useState } from 'react';
import { X, Loader2, Link2, AlertTriangle } from 'lucide-react';

export type DeadlineType = 'accounts_due' | 'cs_due' | 'officer_idv_due' | 'psc_idv_due';

const LABELS: Record<DeadlineType, string> = {
  accounts_due:    'Accounts Due',
  cs_due:          'Confirmation Statement Due',
  officer_idv_due: 'Officer IDV Due',
  psc_idv_due:     'PSC IDV Due',
};

interface Props {
  clientId:     string;
  clientName:   string;
  deadlineType: DeadlineType;
  /** The CH deadline date the user is linking against — shown for context
   *  so they can sanity-check what their task will be due against. */
  currentDeadline: string | null;
  onClose:    () => void;
  /** Fired on a successful link create — caller can refresh its badge state. */
  onLinked?:  () => void;
}

/**
 * Create-a-task-linked-to-this-deadline modal. Phase 1 only supports
 * creating a fresh task with the link in one step — linking existing
 * tasks comes later. Defaults the title to a sensible "Prepare X for
 * <client>" string so the user usually just clicks Save.
 */
export default function LinkDeadlineTaskModal({
  clientId, clientName, deadlineType, currentDeadline, onClose, onLinked,
}: Props) {
  const defaultTitle =
    deadlineType === 'accounts_due'    ? `Prepare accounts for ${clientName}` :
    deadlineType === 'cs_due'          ? `File confirmation statement for ${clientName}` :
    deadlineType === 'officer_idv_due' ? `Officer IDV for ${clientName}` :
                                         `PSC IDV for ${clientName}`;

  const [title, setTitle]             = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [offsetDays, setOffsetDays]   = useState(0);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  function effectiveDueDate(): string | null {
    if (!currentDeadline) return null;
    const d = new Date(currentDeadline);
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function handleSave() {
    setError(null);
    if (!title.trim()) { setError('Give the task a title.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/ch-secretarial/deadline-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:     clientId,
          deadline_type: deadlineType,
          offset_days:   offsetDays,
          new_task: {
            title:       title.trim(),
            description: description.trim() || null,
            // Sets the initial due date right away so the task isn't a
            // floating "no date" until the next ch_cache refresh runs.
            initial_due: effectiveDueDate(),
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to link');
      }
      onLinked?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to link');
    } finally {
      setSaving(false);
    }
  }

  const previewDue = effectiveDueDate();

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <Link2 size={14} /> Link task to {LABELS[deadlineType]}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {clientName} · current deadline {currentDeadline ?? '—'}
            </p>
          </div>
          <button onClick={() => !saving && onClose()} aria-label="Close" className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Task title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-page)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-page)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 resize-none"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
              Offset from deadline (days)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={offsetDays}
                onChange={e => setOffsetDays(Number.isFinite(parseInt(e.target.value, 10)) ? parseInt(e.target.value, 10) : 0)}
                step={1}
                className="w-24 px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-page)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              />
              <span className="text-xs text-[var(--text-muted)]">
                Use a negative number for &ldquo;X days before the deadline&rdquo;.
              </span>
            </div>
            {previewDue && (
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                Task will be due <strong className="text-[var(--text-primary)]">{previewDue}</strong>.
                Future deadline changes will keep this in sync automatically.
              </p>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2 bg-[var(--bg-page)]">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] rounded-lg disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-60"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            Create task &amp; link
          </button>
        </div>
      </div>
    </div>
  );
}
