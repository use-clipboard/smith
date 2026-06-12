'use client';

import { useState } from 'react';
import { Inbox, Send, FileEdit, Star, AlertOctagon, Trash2, Mail, Tag, Plus, Loader2, X } from 'lucide-react';
import type { GmailLabel } from '@/lib/gmail';

const SYSTEM_ICONS: Record<string, React.ElementType> = {
  INBOX: Inbox,
  SENT: Send,
  DRAFT: FileEdit,
  STARRED: Star,
  SPAM: AlertOctagon,
  TRASH: Trash2,
  IMPORTANT: Mail,
};

const SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: 'Inbox',
  SENT: 'Sent',
  DRAFT: 'Drafts',
  STARRED: 'Starred',
  IMPORTANT: 'Important',
  SPAM: 'Spam',
  TRASH: 'Trash',
  ALL_MAIL: 'All Mail',
};

const SHOWN_SYSTEM = ['INBOX', 'SENT', 'DRAFT', 'STARRED', 'SPAM', 'TRASH'];

interface Props {
  labels: GmailLabel[];
  activeLabel: string;
  onSelectLabel: (id: string) => void;
  onLabelCreated: (label: GmailLabel) => void;
  /** Drop an email (by thread id) onto a folder/label — star, spam, trash, or label it. */
  onDropThread?: (threadId: string, label: GmailLabel) => void;
}

/** Folders/labels you can drop an email onto. */
const DROP_SYSTEM = ['STARRED', 'SPAM', 'TRASH', 'INBOX'];

export default function EmailSidebar({ labels, activeLabel, onSelectLabel, onLabelCreated, onDropThread }: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const systemLabels = labels.filter(l => l.type === 'system' && SHOWN_SYSTEM.includes(l.id));
  const userLabels = labels.filter(l => l.type === 'user');

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/email/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json() as { label?: GmailLabel; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      onLabelCreated(data.label!);
      setNewName('');
      setCreating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create label');
    } finally {
      setSaving(false);
    }
  }

  function LabelItem({ label }: { label: GmailLabel }) {
    const Icon = SYSTEM_ICONS[label.id] ?? Tag;
    const name = SYSTEM_LABEL_NAMES[label.id] ?? label.name;
    const isActive = activeLabel === label.id;
    // Drafts and Starred show total count; everything else shows unread count
    const count = ['DRAFT', 'STARRED'].includes(label.id)
      ? (label.messagesTotal ?? 0)
      : (label.messagesUnread ?? 0);

    // Droppable when a drop handler is wired and this folder/label is a valid target.
    const droppable = !!onDropThread && (DROP_SYSTEM.includes(label.id) || label.type === 'user');
    const isDragOver = dragOverId === label.id;

    return (
      <button
        onClick={() => onSelectLabel(label.id)}
        onDragOver={droppable ? e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== label.id) setDragOverId(label.id); } : undefined}
        onDragLeave={droppable ? () => setDragOverId(prev => (prev === label.id ? null : prev)) : undefined}
        onDrop={droppable ? e => {
          e.preventDefault();
          setDragOverId(null);
          const id = e.dataTransfer.getData('application/x-smith-email') || e.dataTransfer.getData('text/plain');
          if (id) onDropThread!(id, label);
        } : undefined}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left
          ${isDragOver
            ? 'ring-2 ring-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)] font-medium'
            : isActive
              ? 'bg-[var(--accent-light)] text-[var(--accent)] font-medium'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
          }`}
      >
        <Icon size={15} className="shrink-0" />
        <span className="flex-1 truncate">{name}</span>
        {count > 0 && (
          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center
            ${isActive ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 py-2 px-2">
      {systemLabels.map(l => <LabelItem key={l.id} label={l} />)}

      <div className="px-3 pt-3 pb-1">
        <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
          <Tag size={10} /> Labels
        </span>
      </div>
      {userLabels.map(l => <LabelItem key={l.id} label={l} />)}

      {/* Create label */}
      {creating ? (
        <div className="px-2 pt-1 pb-2">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setCreating(false); setNewName(''); setError(''); }
            }}
            placeholder="Label name…"
            className="w-full px-2 py-1 text-xs bg-[var(--bg-page)] border border-[var(--border)] rounded-lg outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] mb-1.5"
          />
          {error && <p className="text-[10px] text-red-500 mb-1">{error}</p>}
          <div className="flex gap-1">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || saving}
              className="flex-1 btn-primary text-xs py-1 flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {saving ? <Loader2 size={10} className="animate-spin" /> : null}
              Create
            </button>
            <button
              onClick={() => { setCreating(false); setNewName(''); setError(''); }}
              className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-nav-hover)] rounded-lg transition-colors mt-1"
        >
          <Plus size={12} /> Create label
        </button>
      )}
    </div>
  );
}
