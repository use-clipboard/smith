'use client';

/**
 * EmailTopTabs — horizontal folder tab bar for Email Triage, replacing the old
 * left folder sidebar. System folders are tabs (with counts) and are drop
 * targets; user labels live in a body-portalled "Labels" dropdown (with inline
 * create + drop targets). Compose + Rules sit on the right.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Inbox, Send, FileEdit, Star, Archive, AlertOctagon, Trash2, Tag, Plus, PenSquare,
  Settings2, ChevronDown, Loader2, X, MailOpen,
} from 'lucide-react';
import type { GmailLabel } from '@/lib/gmail';
import { usePortalMenu } from './usePortalMenu';

const SYSTEM_TABS: { id: string; name: string; icon: React.ElementType }[] = [
  { id: 'INBOX',   name: 'Inbox',   icon: Inbox },
  { id: 'SENT',    name: 'Sent',    icon: Send },
  { id: 'DRAFT',   name: 'Drafts',  icon: FileEdit },
  { id: 'STARRED', name: 'Starred', icon: Star },
  { id: 'ARCHIVE', name: 'Archive', icon: Archive },
  { id: 'SPAM',    name: 'Spam',    icon: AlertOctagon },
  { id: 'TRASH',   name: 'Trash',   icon: Trash2 },
];

/** System folders an email can be dropped onto (star / mark spam / trash / un-archive). */
const DROP_SYSTEM = ['STARRED', 'SPAM', 'TRASH', 'INBOX'];

/** Read the dragged email thread id(s) from a drop event. Prefers the
 *  multi-select payload (`application/x-smith-emails` = JSON array) so dropping
 *  a selection moves/labels every selected email; falls back to the single id. */
function draggedThreadIds(e: React.DragEvent): string[] {
  const multi = e.dataTransfer.getData('application/x-smith-emails');
  if (multi) {
    try {
      const arr = JSON.parse(multi) as unknown;
      if (Array.isArray(arr)) {
        const ids = arr.filter((x): x is string => typeof x === 'string');
        if (ids.length) return ids;
      }
    } catch { /* fall through to single */ }
  }
  const single = e.dataTransfer.getData('application/x-smith-email') || e.dataTransfer.getData('text/plain');
  return single ? [single] : [];
}

interface Props {
  labels: GmailLabel[];
  activeLabel: string;
  onSelectLabel: (id: string) => void;
  onLabelCreated: (label: GmailLabel) => void;
  onCompose: () => void;
  onRules: () => void;
  onDropThread?: (threadIds: string[], label: GmailLabel) => void;
  /** Extra controls rendered in the right group, before the Rules button
   *  (e.g. the client/sender/time filter bar). */
  rightExtra?: React.ReactNode;
  /** Right-click menu action on the Inbox tab: mark every unread email read. */
  onMarkAllRead?: () => void;
}

export default function EmailTopTabs({
  labels, activeLabel, onSelectLabel, onLabelCreated, onCompose, onRules, onDropThread, rightExtra, onMarkAllRead,
}: Props) {
  const labelsMenu = usePortalMenu(224, 'left');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Right-click context menu on the Inbox tab (portalled — see cards menu).
  const [inboxMenu, setInboxMenu] = useState<{ x: number; y: number } | null>(null);

  const byId = (id: string) => labels.find(l => l.id === id);
  const userLabels = labels.filter(l => l.type === 'user');
  const activeUserLabel = userLabels.find(l => l.id === activeLabel);

  function countFor(id: string): number {
    const l = byId(id);
    if (!l) return 0;
    return ['DRAFT', 'STARRED'].includes(id) ? (l.messagesTotal ?? 0) : (l.messagesUnread ?? 0);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/email/labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json() as { label?: GmailLabel; error?: string };
      if (res.ok && data.label) { onLabelCreated(data.label); setNewName(''); setCreating(false); }
    } finally {
      setSaving(false);
    }
  }

  const tabBase = 'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
  const tabActive = 'bg-[var(--accent-light)] text-[var(--accent)]';
  const tabIdle = 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';

  return (
    <div className="shrink-0 flex flex-wrap items-center gap-x-1 gap-y-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-card)] backdrop-blur-md">
      {SYSTEM_TABS.map(t => {
        const Icon = t.icon;
        const active = activeLabel === t.id;
        const count = countFor(t.id);
        const droppable = !!onDropThread && DROP_SYSTEM.includes(t.id);
        return (
          <button
            key={t.id}
            onClick={() => onSelectLabel(t.id)}
            onContextMenu={onMarkAllRead && t.id === 'INBOX' ? e => {
              e.preventDefault();
              setInboxMenu({ x: e.clientX, y: e.clientY });
            } : undefined}
            onDragOver={droppable ? e => { e.preventDefault(); if (dragOverId !== t.id) setDragOverId(t.id); } : undefined}
            onDragLeave={droppable ? () => setDragOverId(p => (p === t.id ? null : p)) : undefined}
            onDrop={droppable ? e => {
              e.preventDefault();
              const tids = draggedThreadIds(e);
              const l = byId(t.id);
              if (tids.length && l) onDropThread!(tids, l);
              setDragOverId(null);
            } : undefined}
            className={`${tabBase} ${active ? tabActive : tabIdle} ${dragOverId === t.id ? 'ring-2 ring-[var(--accent)]' : ''}`}
          >
            <Icon size={15} /> {t.name}
            {count > 0 && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}

      {/* Labels dropdown (body-portalled) */}
      <div className="shrink-0">
        <button
          ref={labelsMenu.triggerRef}
          onClick={labelsMenu.toggle}
          onDragOver={onDropThread ? e => { e.preventDefault(); if (!labelsMenu.open) labelsMenu.toggle(); } : undefined}
          className={`${tabBase} ${activeUserLabel ? tabActive : tabIdle}`}
        >
          <Tag size={15} /> {activeUserLabel ? activeUserLabel.name : 'Labels'} <ChevronDown size={12} />
        </button>
        {labelsMenu.open && labelsMenu.pos && typeof document !== 'undefined' && createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => { labelsMenu.setOpen(false); setCreating(false); }} />
            <div
              style={{ position: 'fixed', top: labelsMenu.pos.top, left: labelsMenu.pos.left, width: labelsMenu.width }}
              className="z-[61] max-h-72 overflow-y-auto scrollbar-thin bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl py-1"
            >
              {userLabels.length === 0 && (
                <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No labels yet.</p>
              )}
              {userLabels.map(l => (
                <button
                  key={l.id}
                  onClick={() => { onSelectLabel(l.id); labelsMenu.setOpen(false); }}
                  onDragOver={onDropThread ? e => { e.preventDefault(); if (dragOverId !== l.id) setDragOverId(l.id); } : undefined}
                  onDragLeave={onDropThread ? () => setDragOverId(p => (p === l.id ? null : p)) : undefined}
                  onDrop={onDropThread ? e => { e.preventDefault(); const tids = draggedThreadIds(e); if (tids.length) onDropThread(tids, l); setDragOverId(null); labelsMenu.setOpen(false); } : undefined}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--bg-nav-hover)] ${activeLabel === l.id ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'} ${dragOverId === l.id ? 'bg-[var(--accent-light)]' : ''}`}
                >
                  <Tag size={11} className="shrink-0 text-[var(--text-muted)]" />
                  <span className="truncate flex-1">{l.name}</span>
                  {(l.messagesUnread ?? 0) > 0 && <span className="text-[10px] text-[var(--text-muted)]">{l.messagesUnread}</span>}
                </button>
              ))}
              <div className="border-t border-[var(--border)] mt-1 pt-1 px-2">
                {creating ? (
                  <div className="flex items-center gap-1 py-1">
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                      placeholder="Label name"
                      className="flex-1 text-xs px-2 py-1 rounded border border-[var(--border-input)] bg-transparent outline-none text-[var(--text-primary)]"
                    />
                    <button onClick={handleCreate} disabled={saving} className="text-[var(--accent)] p-1">
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    </button>
                    <button onClick={() => setCreating(false)} className="text-[var(--text-muted)] p-1"><X size={13} /></button>
                  </div>
                ) : (
                  <button onClick={() => setCreating(true)} className="w-full text-left px-1 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] flex items-center gap-2">
                    <Plus size={12} /> Create label
                  </button>
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
      </div>

      {/* Right: filters + Compose + Rules */}
      <div className="ml-auto flex items-center gap-2 shrink-0 pl-2">
        {rightExtra}
        <button onClick={onRules} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors">
          <Settings2 size={13} /> Rules
        </button>
        <button onClick={onCompose} className="btn-primary text-sm flex items-center gap-1.5 px-3 py-1.5">
          <PenSquare size={14} /> Compose
        </button>
      </div>

      {/* Inbox right-click menu — portalled to <body> (backdrop-blur ancestors
          re-anchor position:fixed, throwing cursor coords off otherwise). */}
      {inboxMenu && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-[70]"
            onClick={() => setInboxMenu(null)}
            onContextMenu={e => { e.preventDefault(); setInboxMenu(null); }}
          />
          <div
            style={{ position: 'fixed', top: inboxMenu.y, left: inboxMenu.x }}
            className="z-[71] bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl py-1 min-w-[230px]"
          >
            <button
              onClick={() => { onMarkAllRead?.(); setInboxMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] flex items-center gap-2"
            >
              <MailOpen size={13} className="text-[var(--accent)] shrink-0" />
              Mark all unread emails as read
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
