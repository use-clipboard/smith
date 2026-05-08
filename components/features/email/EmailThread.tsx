'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown, ChevronUp, Reply, Forward, Paperclip,
  UserPlus, CheckSquare, X, Trash2, Loader2,
  Star, Archive, Tag, Mail, Sparkles, Pin, ChevronDown as ChevronDownSmall, Smile,
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
  /** When set (non-threaded view), only this message ID is shown in the panel. */
  targetMessageId?: string;
  allocations: Allocation[];
  taskLinks: TaskLink[];
  googleEmail: string;
  tasksModuleActive: boolean;
  labels: GmailLabel[];
  onAllocate: () => void;
  onCreateTask: () => void;
  creatingTask?: boolean;
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

const QUICK_EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🎉', '🙏', '👀', '✅', '🔥'];

/** Returns true if message body is a single emoji reaction */
function isEmojiOnlyMessage(body: string): boolean {
  const text = body.replace(/<[^>]+>/g, '').trim();
  return QUICK_EMOJIS.includes(text);
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

function EmojiPicker({ onSelect, onClose, openAbove = true }: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  openAbove?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`absolute ${openAbove ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 z-40 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-lg p-2 flex flex-wrap gap-1`}
      style={{ width: 188 }}
    >
      {QUICK_EMOJIS.map(e => (
        <button
          key={e}
          onClick={() => { onSelect(e); onClose(); }}
          className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function AttachmentChips({ attachments }: { attachments: EmailMessage['attachments'] }) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((att, i) => {
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
  );
}

function MessageCard({
  message, defaultOpen, nonThreaded, onReply, onReplyAll, onForward, onReact,
}: {
  message: EmailMessage;
  defaultOpen: boolean;
  /** When true: non-collapsible flat view; no action strips; no attachments (shown in main header). */
  nonThreaded?: boolean;
  onReply: (m: EmailMessage) => void;
  onReplyAll: (m: EmailMessage) => void;
  onForward: (m: EmailMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [emojiPickerTopOpen, setEmojiPickerTopOpen] = useState(false);
  const [emojiPickerBottomOpen, setEmojiPickerBottomOpen] = useState(false);
  const initials = (message.from.name || message.from.email)[0]?.toUpperCase() ?? '?';

  const replyBtnClass = 'text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)]/15 transition-colors font-medium';

  // ── Non-threaded (single-message) flat view ─────────────────────────────────
  if (nonThreaded) {
    return (
      <div className="bg-[var(--bg-card-solid)]">
        {/* Sender / date row */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)]">
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
            <p className="text-xs text-[var(--text-muted)]">{formatDate(message.date)}</p>
          </div>
        </div>

        {/* To / CC */}
        <div className="px-5 py-2 bg-[var(--bg-nav-hover)] border-b border-[var(--border)] text-xs text-[var(--text-muted)] space-y-0.5">
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

        {/* Body */}
        <div className="px-5 py-5 bg-white dark:bg-[var(--bg-card-solid)]">
          {message.body ? (
            <div
              className="prose prose-sm max-w-none text-[var(--text-primary)] text-sm [&_a]:text-[var(--accent)] [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: message.body }}
            />
          ) : (
            <p className="text-sm text-[var(--text-muted)] italic">No body content</p>
          )}
        </div>
      </div>
    );
  }

  // ── Threaded (collapsible card) view ────────────────────────────────────────
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
          {/* Action buttons at the top of the expanded message */}
          <div className="px-4 py-2 bg-[var(--bg-nav-hover)] flex items-center gap-2 border-b border-[var(--border)]">
            <button onClick={() => onReply(message)} className={replyBtnClass}>
              <Reply size={12} /> Reply
            </button>
            {(message.to.length > 0 || message.cc.length > 0) && (
              <button onClick={() => onReplyAll(message)} className={replyBtnClass}>
                <Reply size={12} /> Reply All
              </button>
            )}
            <button onClick={() => onForward(message)} className={replyBtnClass}>
              <Forward size={12} /> Forward
            </button>
            <div className="relative ml-auto">
              <button
                onClick={() => setEmojiPickerTopOpen(v => !v)}
                title="React with emoji"
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40 transition-colors"
              >
                <Smile size={14} />
              </button>
              {emojiPickerTopOpen && (
                <EmojiPicker
                  onSelect={emoji => onReact(message.id, emoji)}
                  onClose={() => setEmojiPickerTopOpen(false)}
                  openAbove={false}
                />
              )}
            </div>
          </div>

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
              <AttachmentChips attachments={message.attachments} />
            </div>
          )}

          {/* Message footer: reply actions + react button */}
          <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-nav-hover)] flex items-center gap-2">
            <button onClick={() => onReply(message)} className={replyBtnClass}>
              <Reply size={12} /> Reply
            </button>
            {(message.to.length > 0 || message.cc.length > 0) && (
              <button onClick={() => onReplyAll(message)} className={replyBtnClass}>
                <Reply size={12} /> Reply All
              </button>
            )}
            <button onClick={() => onForward(message)} className={replyBtnClass}>
              <Forward size={12} /> Forward
            </button>

            {/* Emoji react button */}
            <div className="relative ml-auto">
              <button
                onClick={() => setEmojiPickerBottomOpen(v => !v)}
                title="React with emoji"
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40 transition-colors"
              >
                <Smile size={14} />
              </button>
              {emojiPickerBottomOpen && (
                <EmojiPicker
                  onSelect={emoji => onReact(message.id, emoji)}
                  onClose={() => setEmojiPickerBottomOpen(false)}
                  openAbove={true}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmailThread({
  thread, targetMessageId, allocations, taskLinks, googleEmail, tasksModuleActive, labels,
  onAllocate, onCreateTask, creatingTask, onReply, onReplyAll, onForward, onAIDraftReply, onDelete, onArchive, onStar, onMove,
  onRestore, onMarkUnread, onRemoveAllocation, onRemoveTaskLink,
  isPinned, onPin,
}: Props) {
  const [deleting, setDeleting]       = useState(false);
  const [archiving, setArchiving]     = useState(false);
  const [starring, setStarring]       = useState(false);
  const [restoring, setRestoring]     = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  const [pinning, setPinning]         = useState(false);
  // Emoji picker for non-threaded mode (lives in main header)
  const [emojiPickerHeaderOpen, setEmojiPickerHeaderOpen] = useState(false);
  const emojiPickerHeaderRef = useRef<HTMLDivElement>(null);

  const isInTrash  = thread.labelIds.includes('TRASH');
  const isInSpam   = thread.labelIds.includes('SPAM');
  const isRead     = !thread.labelIds.includes('UNREAD');
  const [isStarred, setIsStarred] = useState(thread.labelIds.includes('STARRED'));
  const [moveOpen, setMoveOpen]   = useState(false);
  const [moving, setMoving]       = useState<string | null>(null);
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
          addLabelIds:    newStarred ? ['STARRED'] : [],
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
          addLabelIds:    ['INBOX'],
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
          addLabelIds:    [labelId],
          removeLabelIds: ['INBOX'],
        }),
      });
      onMove(labelId);
    } finally {
      setMoving(null);
    }
  }

  async function handleReact(messageId: string, emoji: string) {
    // Send the emoji as an actual email reply to the sender
    const message = thread.messages.find(m => m.id === messageId);
    if (!message) return;
    try {
      const formData = new FormData();
      formData.append('to', JSON.stringify([message.from.email]));
      formData.append('cc', JSON.stringify([]));
      formData.append('bcc', JSON.stringify([]));
      const reSubject = message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`;
      formData.append('subject', reSubject);
      formData.append('htmlBody', emoji);
      formData.append('replyToMessageId', messageId);
      formData.append('threadId', thread.id);
      await fetch('/api/email/send', { method: 'POST', body: formData });
    } catch {
      // Silently fail
    }
  }

  // In non-threaded view use the targeted message; otherwise use the last message in the thread
  const lastMessage = targetMessageId
    ? (thread.messages.find(m => m.id === targetMessageId) ?? thread.messages[thread.messages.length - 1])
    : thread.messages[thread.messages.length - 1];
  const moveTargets  = labels.filter(l => l.type === 'user' || ['STARRED', 'IMPORTANT', 'SPAM'].includes(l.id));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg-page)]">
      {/* Thread header */}
      <div className="px-5 py-4 border-b border-[var(--border)] shrink-0 bg-[var(--bg-card-solid)]">
        <h2 className="text-base font-semibold text-[var(--text-primary)] leading-snug">{thread.subject}</h2>

        {/* Action bar */}
        <div className="flex items-center gap-1 mt-3 flex-wrap">

          {/* Group 1: Filing actions */}
          <button onClick={onAllocate} className="btn-secondary text-xs flex items-center gap-1.5">
            <UserPlus size={12} /> Allocate
          </button>
          {tasksModuleActive && (
            <button
              onClick={onCreateTask}
              disabled={creatingTask}
              className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-60"
            >
              {creatingTask
                ? <><Loader2 size={12} className="animate-spin" /> Preparing…</>
                : <><CheckSquare size={12} /> Create Task</>
              }
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

          {/* Star toggle — now in toolbar */}
          <button
            onClick={handleStar}
            disabled={starring}
            title={isStarred ? 'Unstar' : 'Star'}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors disabled:opacity-50"
          >
            <Star
              size={15}
              className={isStarred ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)]'}
            />
          </button>

          {/* Pin toggle — now in toolbar */}
          {onPin && (
            <button
              onClick={handlePin}
              disabled={pinning}
              title={isPinned ? 'Unpin' : 'Pin to top'}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors disabled:opacity-50"
            >
              {pinning
                ? <Loader2 size={15} className="animate-spin text-[var(--text-muted)]" />
                : <Pin size={15} className={isPinned ? 'text-[var(--accent)] fill-[var(--accent)]' : 'text-[var(--text-muted)]'} />
              }
            </button>
          )}

          {/* Non-threaded: emoji reaction button in main header */}
          {targetMessageId && lastMessage && (
            <div className="relative" ref={emojiPickerHeaderRef}>
              <button
                onClick={() => setEmojiPickerHeaderOpen(v => !v)}
                title="React with emoji"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Smile size={15} />
              </button>
              {emojiPickerHeaderOpen && (
                <EmojiPicker
                  onSelect={emoji => { handleReact(lastMessage.id, emoji); setEmojiPickerHeaderOpen(false); }}
                  onClose={() => setEmojiPickerHeaderOpen(false)}
                  openAbove={false}
                />
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

        {/* Non-threaded: attachment chips in main header */}
        {targetMessageId && lastMessage && lastMessage.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <AttachmentChips attachments={lastMessage.attachments} />
          </div>
        )}

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
      <div className={`flex-1 overflow-y-auto ${targetMessageId ? '' : 'px-5 py-4 space-y-3'}`}>
        {(targetMessageId
          ? thread.messages.filter(m => m.id === targetMessageId)
          : thread.messages
        ).map((msg, idx, arr) => {
          // Emoji-only messages are reactions — render as a small chip instead of a full card
          if (isEmojiOnlyMessage(msg.body)) {
            const emoji = msg.body.replace(/<[^>]+>/g, '').trim();
            const senderName = msg.from.name || msg.from.email.split('@')[0];
            return (
              <div key={msg.id} className="flex items-center gap-2 px-1">
                <span
                  title={`${senderName} reacted`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-[var(--accent-light)] border border-[var(--accent)]/20 text-[var(--text-secondary)]"
                >
                  <span>{emoji}</span>
                  <span className="text-xs text-[var(--text-muted)]">{senderName}</span>
                </span>
              </div>
            );
          }
          return (
            <MessageCard
              key={msg.id}
              message={msg}
              defaultOpen={idx === arr.length - 1}
              nonThreaded={!!targetMessageId}
              onReply={onReply}
              onReplyAll={onReplyAll}
              onForward={onForward}
              onReact={handleReact}
            />
          );
        })}
      </div>
    </div>
  );
}
