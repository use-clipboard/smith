'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown, ChevronUp, Reply, Forward, Paperclip,
  UserPlus, CheckSquare, X, Trash2, Loader2,
  Star, Archive, ArchiveRestore, Tag, Mail, Sparkles, Pin, ChevronDown as ChevronDownSmall, Smile,
  Printer, FolderDown,
} from 'lucide-react';
import type { EmailThread as EmailThreadType, EmailMessage, GmailLabel } from '@/lib/gmail';
import Tooltip from '@/components/ui/Tooltip';

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
  /** Reactions already sent for this thread (from threadMeta — persists across tab switches) */
  existingReactions?: string[];
  /** Called when a reaction is successfully sent */
  onReacted?: (emoji: string) => void;
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

function attachmentUrl(att: EmailMessage['attachments'][number]): string {
  return `/api/email/attachment?messageId=${encodeURIComponent(att.messageId)}&attachmentId=${encodeURIComponent(att.attachmentId)}&filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}`;
}

function AttachmentChips({ attachments }: { attachments: EmailMessage['attachments'] }) {
  if (!attachments.length) return null;
  // Trigger one download per attachment sequentially. Browsers stagger the
  // save dialogs themselves; we just create an anchor and click it for each.
  // This avoids needing a server-side zip endpoint — fine for the typical
  // 2–5 attachment case. Filenames are preserved via the download attribute.
  function downloadAll() {
    const downloadable = attachments.filter(a => !!a.attachmentId);
    downloadable.forEach((att, i) => {
      window.setTimeout(() => {
        const a = document.createElement('a');
        a.href = attachmentUrl(att);
        a.download = att.filename;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, i * 250);
    });
  }
  const downloadableCount = attachments.filter(a => !!a.attachmentId).length;
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {attachments.map((att, i) => {
        const canDownload = !!att.attachmentId;
        const url = canDownload ? attachmentUrl(att) : undefined;
        const isInline = att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf';
        const chip = (
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-white border border-slate-600 ${canDownload ? 'hover:bg-slate-600 transition-colors cursor-pointer' : ''}`}>
            <Paperclip size={11} className="shrink-0 opacity-80" />
            <span className="truncate max-w-[160px]">{att.filename}</span>
            <span className="opacity-60 font-normal">({Math.round(att.size / 1024)}KB)</span>
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
      {downloadableCount > 1 && (
        <Tooltip label={`Download all ${downloadableCount} attachments`}>
          <button
            type="button"
            onClick={downloadAll}
            aria-label="Download all attachments"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] bg-[var(--bg-card-solid)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <FolderDown size={12} /> Download all
          </button>
        </Tooltip>
      )}
    </div>
  );
}

// Open a print-friendly view of the email in a new window and trigger the
// system print dialog. Both the "Print" and "Download PDF" toolbar buttons
// route through here — Download PDF just sets autoSavePdfHint=true so the
// window title (and therefore the default PDF filename when the user picks
// "Save as PDF") is the email subject.
function openPrintableEmail(opts: {
  subject: string;
  from: { name?: string | null; email: string };
  to: { name?: string | null; email: string }[];
  cc: { name?: string | null; email: string }[];
  date: string;
  bodyHtml: string;
  attachments: EmailMessage['attachments'];
}) {
  const { subject, from, to, cc, date, bodyHtml, attachments } = opts;
  const fmtAddrs = (arr: { name?: string | null; email: string }[]) =>
    arr.map(a => a.name ? `${escapeHtml(a.name)} &lt;${escapeHtml(a.email)}&gt;` : escapeHtml(a.email)).join(', ');
  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject || '(no subject)')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 16px; }
    .meta { font-size: 12px; color: #555; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 16px; }
    .meta div { margin: 2px 0; }
    .meta strong { color: #111; display: inline-block; min-width: 50px; }
    .body { font-size: 14px; line-height: 1.55; }
    .body a { color: #2563eb; text-decoration: underline; }
    .attachments { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #555; }
    .attachments h2 { font-size: 13px; margin: 0 0 6px; color: #111; }
    .attachments li { margin: 2px 0; }
    @media print { body { margin: 0; } }
  </style>
</head><body>
  <h1>${escapeHtml(subject || '(no subject)')}</h1>
  <div class="meta">
    <div><strong>From:</strong> ${from.name ? escapeHtml(from.name) + ' &lt;' + escapeHtml(from.email) + '&gt;' : escapeHtml(from.email)}</div>
    <div><strong>To:</strong> ${fmtAddrs(to)}</div>
    ${cc.length ? `<div><strong>CC:</strong> ${fmtAddrs(cc)}</div>` : ''}
    <div><strong>Date:</strong> ${escapeHtml(new Date(date).toLocaleString('en-GB'))}</div>
  </div>
  <div class="body">${bodyHtml || '<p><em>(no body content)</em></p>'}</div>
  ${attachments.length ? `<div class="attachments"><h2>Attachments (${attachments.length})</h2><ul>${attachments.map(a => `<li>${escapeHtml(a.filename)} (${Math.round(a.size / 1024)}KB)</li>`).join('')}</ul></div>` : ''}
  <script>window.addEventListener('load', () => { setTimeout(() => window.print(), 150); });</script>
</body></html>`;
  // NOTE: omit 'noopener'/'noreferrer' from the features string here — those
  // cause window.open() to return null by spec, which would leave us with no
  // way to write the printable HTML into the new tab (and the user just sees
  // about:blank, which is the bug). The new window is same-origin and short-
  // lived (closes itself after print) so the lack of noopener is fine.
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
              <Tooltip label="React with emoji">
                <button
                  onClick={() => setEmojiPickerTopOpen(v => !v)}
                  aria-label="React with emoji"
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40 transition-colors"
                >
                  <Smile size={14} />
                </button>
              </Tooltip>
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
              <Tooltip label="React with emoji">
                <button
                  onClick={() => setEmojiPickerBottomOpen(v => !v)}
                  aria-label="React with emoji"
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40 transition-colors"
                >
                  <Smile size={14} />
                </button>
              </Tooltip>
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
  isPinned, onPin, existingReactions, onReacted,
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
  // Track reactions sent in this session (merged with existingReactions from parent)
  const [sessionReactions, setSessionReactions] = useState<string[]>([]);

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

  // Reset session reactions when switching to a different thread
  useEffect(() => {
    setSessionReactions([]);
  }, [thread.id]);

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
      // Track locally and bubble up to parent
      setSessionReactions(prev => prev.includes(emoji) ? prev : [...prev, emoji]);
      onReacted?.(emoji);
    } catch {
      // Silently fail
    }
  }

  // All reactions to display (deduplicated union of session + parent-persisted)
  const allReactions = [...new Set([...(existingReactions ?? []), ...sessionReactions])];

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
            <Tooltip label={isInSpam ? 'Move to Inbox (not spam)' : 'Restore to Inbox'}>
              <button
                onClick={handleRestore}
                disabled={restoring}
                aria-label={isInSpam ? 'Move to Inbox' : 'Restore to Inbox'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors text-xs font-medium disabled:opacity-50"
              >
                {restoring
                  ? <Loader2 size={13} className="animate-spin" />
                  : <ArchiveRestore size={13} />}
                {isInSpam ? 'Not Spam' : 'Restore'}
              </button>
            </Tooltip>
          ) : (
            <Tooltip label="Archive">
              <button
                onClick={handleArchive}
                disabled={archiving}
                aria-label="Archive"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              >
                {archiving ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
              </button>
            </Tooltip>
          )}

          {isRead && (
            <Tooltip label="Mark as Unread">
              <button
                onClick={handleMarkUnread}
                disabled={markingUnread}
                aria-label="Mark as Unread"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              >
                {markingUnread ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} className="translate-y-px" />}
              </button>
            </Tooltip>
          )}

          {moveTargets.length > 0 && (
            <div className="relative" ref={moveRef}>
              <Tooltip label="Move to label">
                <button
                  onClick={() => setMoveOpen(o => !o)}
                  disabled={!!moving}
                  aria-label="Move to label"
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 flex items-center gap-0.5"
                >
                  {moving ? <Loader2 size={15} className="animate-spin" /> : <Tag size={15} />}
                  <ChevronDownSmall size={10} />
                </button>
              </Tooltip>
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

          {/* Print / Save as PDF — opens a printable view in a new window
              and fires the system print dialog. The user picks "Print" or
              "Save as PDF" from there; the window title is the email subject
              so the saved PDF filename is sensible by default. */}
          {lastMessage && (
            <Tooltip label="Print or save as PDF">
              <button
                onClick={() => openPrintableEmail({
                  subject: thread.subject,
                  from: lastMessage.from,
                  to:   lastMessage.to,
                  cc:   lastMessage.cc,
                  date: lastMessage.date,
                  bodyHtml: lastMessage.body ?? '',
                  attachments: lastMessage.attachments,
                })}
                aria-label="Print or save email as PDF"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Printer size={15} />
              </button>
            </Tooltip>
          )}

          {/* Star toggle — now in toolbar */}
          <Tooltip label={isStarred ? 'Unstar' : 'Star'}>
            <button
              onClick={handleStar}
              disabled={starring}
              aria-label={isStarred ? 'Unstar' : 'Star'}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors disabled:opacity-50"
            >
              <Star
                size={15}
                className={isStarred ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)]'}
              />
            </button>
          </Tooltip>

          {/* Pin toggle — now in toolbar */}
          {onPin && (
            <Tooltip label={isPinned ? 'Unpin' : 'Pin to top'}>
              <button
                onClick={handlePin}
                disabled={pinning}
                aria-label={isPinned ? 'Unpin' : 'Pin to top'}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors disabled:opacity-50"
              >
                {pinning
                  ? <Loader2 size={15} className="animate-spin text-[var(--text-muted)]" />
                  : <Pin size={15} className={isPinned ? 'text-[var(--accent)] fill-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                }
              </button>
            </Tooltip>
          )}

          {/* Non-threaded: emoji reaction button in main header */}
          {targetMessageId && lastMessage && (
            <div className="relative" ref={emojiPickerHeaderRef}>
              <Tooltip label="React with emoji">
                <button
                  onClick={() => setEmojiPickerHeaderOpen(v => !v)}
                  aria-label="React with emoji"
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Smile size={15} className="translate-y-0.5" />
                </button>
              </Tooltip>
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
          <Tooltip label="Delete" className="ml-auto">
            <button
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Delete"
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          </Tooltip>
        </div>

        {/* Non-threaded: attachment chips in main header */}
        {targetMessageId && lastMessage && lastMessage.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <AttachmentChips attachments={lastMessage.attachments} />
          </div>
        )}

        {/* Reaction badges — shown after you react */}
        {allReactions.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-[var(--text-muted)] font-medium">You reacted:</span>
            {allReactions.map(e => (
              <Tooltip key={e} label="Your reaction" side="top">
                <span className="text-base leading-none px-2 py-1 rounded-full bg-[var(--accent-light)] border border-[var(--accent)]/20 select-none">
                  {e}
                </span>
              </Tooltip>
            ))}
          </div>
        )}

        {/* Allocation badges — per-message rows collapsed to one chip per client */}
        {allocations.length > 0 && (() => {
          const seen = new Set<string>();
          const uniqueAllocations = allocations.filter(a => {
            if (seen.has(a.client_id)) return false;
            seen.add(a.client_id);
            return true;
          });
          return (
            <div className="mt-3 flex flex-wrap gap-1.5 items-center">
              <span className="text-[11px] font-medium text-[var(--text-muted)]">Allocated to:</span>
              {uniqueAllocations.map(a => (
                <span key={a.client_id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  {a.clients?.name ?? 'Client'}
                  {a.clients?.client_ref && <span className="opacity-60">· {a.clients.client_ref}</span>}
                  <button onClick={() => onRemoveAllocation(a.client_id)} className="ml-0.5 hover:text-red-500 transition-colors"><X size={10} /></button>
                </span>
              ))}
            </div>
          );
        })()}

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
                <Tooltip label={`${senderName} reacted`} side="top">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm bg-[var(--accent-light)] border border-[var(--accent)]/20 text-[var(--text-secondary)]">
                    <span>{emoji}</span>
                    <span className="text-xs text-[var(--text-muted)]">{senderName}</span>
                  </span>
                </Tooltip>
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
