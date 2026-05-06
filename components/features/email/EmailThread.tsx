'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown, ChevronUp, Reply, Forward, Paperclip,
  UserPlus, CheckSquare, X, Trash2, Loader2,
  Star, Archive, Tag, Mail, Sparkles, Pin, ChevronDown as ChevronDownSmall,
} from 'lucide-react';
import type { EmailThread as EmailThreadType, EmailMessage, GmailLabel } from '@/lib/gmail';

interface Allocation {
  client_id: string;
  clients: { id: string; name: string; client_ref: string; risk_rating: string } | null;
  users: { full_name: string } | null;
}

interface TaskLink {
  task_id: string;
  tasks: { id: string; title: string; status: string } | null;
}

interface Props {
  thread: EmailThreadType;
  allocations: Allocation[];
  taskLinks: TaskLink[];
  googleEmail: string;
  tasksModuleActive: boolean;
  labels: GmailLabel[];
  onAllocate: () => void;
  onLinkTask: () => void;
  onReply: (message: EmailMessage) => void;
  onReplyAll: (message: EmailMessage) => void;
  onForward: (message: EmailMessage) => void;
  onAIDraftReply: (message: EmailMessage) => void;
  onDelete: () => void;
  onArchive: () => void;
  onStar: (starred: boolean) => void;
  onMove: (labelId: string) => void;
  onRestore: () => void;
  onMarkUnread: () => void;
  onRemoveAllocation: (clientId: string) => void;
  onRemoveTaskLink: (taskId: string) => void;
  isPinned?: boolean;
  onPin?: (pin: boolean) => Promise<void>;
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function MessageCard({ message, defaultOpen, onReply, onReplyAll, onForward }: {
  message: EmailMessage;
  defaultOpen: boolean;
  onReply: (m: EmailMessage) => void;
  onReplyAll: (m: EmailMessage) => void;
  onForward: (m: EmailMessage) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const initials = (message.from.name || message.from.email)[0]?.toUpperCase() ?? '?';

  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--bg-card-solid)] shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-nav-hover)] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-full bg-[var(--accent-light)] flex items-center justify-center shrink-0 text-xs font-bold text-[var(--accent)]">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
            {message.from.name || message.from.email}
            {message.from.name && (
              <span className="ml-1.5 text-xs text-[var(--text-muted)] font-normal">&lt;{message.from.email}&gt;</span>
            )}
          </p>
          {!open && (
            <p className="text-xs text-[var(--text-muted)] truncate">{message.snippet}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {message.attachments.length > 0 && <Paperclip size={12} className="text-[var(--text-muted)]" />}
          <span className="text-xs text-[var(--text-muted)]">{formatDate(message.date)}</span>
          {open ? <ChevronUp size={14} className="text-[var(--text-muted)]" /> : <ChevronDown size={14} className="text-[var(--text-muted)]" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--border)]">
          <div className="px-4 py-2 bg-[var(--bg-nav-hover)] text-xs text-[var(--text-muted)] space-y-0.5">
            <p>
              <span className="font-medium text-[var(--text-secondary)]">To: </span>
              {message.to.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ')}
            </p>
            {message.cc.length > 0 && (
              <p>
                <span className="font-medium text-[var(--text-secondary)]">CC: </span>
                {message.cc.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ')}
              </p>
            )}
          </div>

          <div className="px-4 py-4 bg-white dark:bg-[var(--bg-card-solid)]">
            {message.body ? (
              <div
                className="prose prose-sm max-w-none text-[var(--text-primary)] text-sm [&_a]:text-[var(--accent)] [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: message.body }}
              />
            ) : (
              <p className="text-sm text-[var(--text-muted)] italic">No body content</p>
            )}
          </div>

          {message.attachments.length > 0 && (
            <div className="px-4 pb-3 border-t border-[var(--border)] pt-3 flex flex-wrap gap-2 bg-[var(--bg-nav-hover)]">
              {message.attachments.map((att, i) => {
                const canDownload = !!att.attachmentId;
                const url = canDownload
                  ? `/api/email/attachment?messageId=${encodeURIComponent(att.messageId)}&attachmentId=${encodeURIComponent(att.attachmentId)}&filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}`
                  : undefined;
                const isInline = att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf';
                const chip = (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-secondary)] bg-[var(--bg-card-solid)] ${canDownload ? 'hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors cursor-pointer' : ''}`}>
                    <Paperclip size={11} />
                    <span className="truncate max-w-[160px]">{att.filename}</span>
                    <span className="text-[var(--text-muted)]">({Math.round(att.size / 1024)}KB)</span>
                  </div>
                );
                return canDownload ? (
                  <a key={i} href={url} target={isInline ? '_blank' : undefined} rel="noopener noreferrer" download={isInline ? undefined : att.filename}>
                    {chip}
                  </a>
                ) : (
                  <div key={i}>{chip}</div>
                );
              })}
            </div>
          )}

          <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-nav-hover)] flex items-center gap-2">
            <button onClick={() => onReply(message)} className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)]/15 transition-colors font-medium">
              <Reply size={12} /> Reply
            </button>
            {(message.to.length > 0 || message.cc.length > 0) && (
              <button onClick={() => onReplyAll(message)} className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)]/15 transition-colors font-medium">
                <Reply size={12} /> Reply All
              </button>
            )}
            <button onClick={() => onForward(message)} className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)]/15 transition-colors font-medium">
              <Forward size={12} /> Forward
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmailThread({
  thread, allocations, taskLinks, googleEmail, tasksModuleActive, labels,
  onAllocate, onLinkTask, onReply, onReplyAll, onForward, onAIDraftReply, onDelete, onArchive, onStar, onMove,
  onRestore, onMarkUnread, onRemoveAllocation, onRemoveTaskLink,
  isPinned, onPin,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [starring, setStarring] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  const [pinning, setPinning] = useState(false);

  const isInTrash = thread.labelIds.includes('TRASH');
  const isInSpam = thread.labelIds.includes('SPAM');
  const isRead = !thread.labelIds.includes('UNREAD');
  const [isStarred, setIsStarred] = useState(thread.labelIds.includes('STARRED'));
  const [moveOpen, setMoveOpen] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const moveRef = useRef<HTMLDivElement>(null);

  // Sync star state when thread changes
  useEffect(() => {
    setIsStarred(thread.labelIds.includes('STARRED'));
  }, [thread.id, thread.labelIds]);

  // Close move dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (moveRef.current && !moveRef.current.contains(e.target as Node)) {
        setMoveOpen(false);
      }
    }
    if (moveOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moveOpen]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch('/api/email/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: thread.id }),
      });
      onDelete();
    } finally {
      setDeleting(false);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      await fetch('/api/email/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: thread.id, removeLabelIds: ['INBOX'] }),
      });
      onArchive();
    } finally {
      setArchiving(false);
    }
  }

  async function handleStar() {
    const newStarred = !isStarred;
    setIsStarred(newStarred);
    setStarring(true);
    try {
      await fetch('/api/email/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id,
          addLabelIds: newStarred ? ['STARRED'] : [],
          removeLabelIds: newStarred ? [] : ['STARRED'],
        }),
      });
      onStar(newStarred);
    } finally {
      setStarring(false);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      await fetch('/api/email/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id,
          addLabelIds: ['INBOX'],
          removeLabelIds: isInTrash ? ['TRASH'] : ['SPAM'],
        }),
      });
      onRestore();
    } finally {
      setRestoring(false);
    }
  }

  async function handlePin() {
    if (!onPin) return;
    setPinning(true);
    try { await onPin(!isPinned); } finally { setPinning(false); }
  }

  async function handleMarkUnread() {
    setMarkingUnread(true);
    try {
      await fetch('/api/email/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: thread.id, addLabelIds: ['UNREAD'] }),
      });
      onMarkUnread();
    } finally {
      setMarkingUnread(false);
    }
  }

  async function handleMove(labelId: string) {
    setMoving(labelId);
    setMoveOpen(false);
    try {
      await fetch('/api/email/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: thread.id,
          addLabelIds: [labelId],
          removeLabelIds: ['INBOX'],
        }),
      });
      onMove(labelId);
    } finally {
      setMoving(null);
    }
  }

  const lastMessage = thread.messages[thread.messages.length - 1];

  // Labels available as move targets: user labels + key system folders
  const moveTargets = labels.filter(l =>
    l.type === 'user' || ['STARRED', 'IMPORTANT', 'SPAM'].includes(l.id)
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg-page)]">
      {/* Thread header */}
      <div className="px-5 py-4 border-b border-[var(--border)] shrink-0 bg-[var(--bg-card-solid)]">
        <div className="flex items-start gap-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)] leading-snug flex-1 min-w-0">{thread.subject}</h2>
          {/* Star toggle */}
          <button
            onClick={handleStar}
            disabled={starring}
            title={isStarred ? 'Unstar' : 'Star'}
            className="shrink-0 p-1 rounded hover:bg-[var(--bg-nav-hover)] transition-colors"
          >
            <Star
              size={16}
              className={isStarred ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)]'}
            />
          </button>
          {/* Pin toggle */}
          {onPin && (
            <button
              onClick={handlePin}
              disabled={pinning}
              title={isPinned ? 'Unpin' : 'Pin to top'}
              className="shrink-0 p-1 rounded hover:bg-[var(--bg-nav-hover)] transition-colors"
            >
              {pinning
                ? <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />
                : <Pin size={16} className={isPinned ? 'text-[var(--accent)] fill-[var(--accent)]' : 'text-[var(--text-muted)]'} />
              }
            </button>
          )}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-1 mt-3 flex-wrap">

          {/* Group 1: Filing actions */}
          <button onClick={onAllocate} className="btn-secondary text-xs flex items-center gap-1.5">
            <UserPlus size={12} /> Allocate
          </button>
          {tasksModuleActive && (
            <button onClick={onLinkTask} className="btn-secondary text-xs flex items-center gap-1.5">
              <CheckSquare size={12} /> Link Task
            </button>
          )}

          <div className="w-px h-5 bg-[var(--border)] mx-1 shrink-0" />

          {/* Group 2: Reply actions — accent tinted */}
          <button
            onClick={() => lastMessage && onReply(lastMessage)}
            className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)]/15 transition-colors font-medium"
          >
            <Reply size={12} /> Reply
          </button>
          <button
            onClick={() => lastMessage && onReplyAll(lastMessage)}
            className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)]/15 transition-colors font-medium"
          >
            <Reply size={12} /> Reply All
          </button>
          <button
            onClick={() => lastMessage && onForward(lastMessage)}
            className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)]/15 transition-colors font-medium"
          >
            <Forward size={12} /> Forward
          </button>
          <button
            onClick={() => lastMessage && onAIDraftReply(lastMessage)}
            className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors font-medium"
          >
            <Sparkles size={12} /> AI Draft
          </button>

          <div className="w-px h-5 bg-[var(--border)] mx-1 shrink-0" />

          {/* Group 3: Utility — icon-only with tooltips */}
          {(isInTrash || isInSpam) ? (
            <button
              onClick={handleRestore}
              disabled={restoring}
              title="Restore to Inbox"
              className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
            >
              {restoring ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
            </button>
          ) : (
            <button
              onClick={handleArchive}
              disabled={archiving}
              title="Archive"
              className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
            >
              {archiving ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
            </button>
          )}

          {isRead && (
            <button
              onClick={handleMarkUnread}
              disabled={markingUnread}
              title="Mark as Unread"
              className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
            >
              {markingUnread ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
            </button>
          )}

          {moveTargets.length > 0 && (
            <div className="relative" ref={moveRef}>
              <button
                onClick={() => setMoveOpen(o => !o)}
                disabled={!!moving}
                title="Move to label"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 flex items-center gap-0.5"
              >
                {moving ? <Loader2 size={15} className="animate-spin" /> : <Tag size={15} />}
                <ChevronDownSmall size={10} />
              </button>
              {moveOpen && (
                <div className="absolute left-0 top-full mt-1 z-30 w-48 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-lg overflow-hidden">
                  <div className="py-1 max-h-56 overflow-y-auto">
                    {moveTargets.map(l => (
                      <button
                        key={l.id}
                        onClick={() => handleMove(l.id)}
                        className="w-full text-left px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] flex items-center gap-2"
                      >
                        <Tag size={11} className="text-[var(--text-muted)] shrink-0" />
                        {l.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Far right: Delete — icon-only, red on hover */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Delete"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 ml-auto"
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        </div>

        {/* Allocation badges */}
        {allocations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] font-medium text-[var(--text-muted)]">Allocated to:</span>
            {allocations.map(a => (
              <span key={a.client_id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                {a.clients?.name ?? 'Client'}
                {a.clients?.client_ref && <span className="opacity-60">· {a.clients.client_ref}</span>}
                <button onClick={() => onRemoveAllocation(a.client_id)} className="ml-0.5 hover:text-red-500 transition-colors"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}

        {/* Task link badges */}
        {taskLinks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 items-center">
            <span className="text-[11px] font-medium text-[var(--text-muted)]">Linked tasks:</span>
            {taskLinks.map(tl => (
              <span key={tl.task_id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                <CheckSquare size={10} />
                {tl.tasks?.title ?? 'Task'}
                <button onClick={() => onRemoveTaskLink(tl.task_id)} className="ml-0.5 hover:text-red-500 transition-colors"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {thread.messages.map((msg, idx) => (
          <MessageCard
            key={msg.id}
            message={msg}
            defaultOpen={idx === thread.messages.length - 1}
            onReply={onReply}
            onReplyAll={onReplyAll}
            onForward={onForward}
          />
        ))}
      </div>
    </div>
  );
}
