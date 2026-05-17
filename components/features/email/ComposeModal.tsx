'use client';

import { useState, useEffect, useRef } from 'react';
import {
  X, Send, Loader2, Sparkles, Check, Save, UserPlus, CheckSquare,
  Paperclip, Bold, Italic, Underline, Strikethrough, List, ListOrdered, Palette,
  ChevronDown, ChevronUp, Smile, Minus,
} from 'lucide-react';
import type { EmailMessage } from '@/lib/gmail';
import AllocateModal, { type Client } from './AllocateModal';
import Tooltip from '@/components/ui/Tooltip';
import type { ComposeSnapshot } from './ComposeWindowProvider';

interface RecipientResult {
  type: 'client' | 'team';
  id: string;
  name: string;
  email: string;
  clientRef: string | null;
  status: string | null;
}

interface SelectedRecipient {
  name: string;
  email: string;
}

interface ReplyAllRecipients {
  to: SelectedRecipient[];
  cc: SelectedRecipient[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  replyTo?: EmailMessage | null;
  /** Pre-fill body with AI-generated content (e.g. AI Draft Reply) */
  prefilledBody?: string | null;
  /** Override To/CC when doing Reply All */
  replyAllRecipients?: ReplyAllRecipients | null;
  /** Message being forwarded — leaves To empty, prefixes subject with Fwd: */
  forwardOf?: EmailMessage | null;
  /** Pre-populate client allocation (e.g. from existing thread allocation) */
  defaultClients?: Client[] | null;
  /** Pre-populate the To field (e.g. when composing from a client page) */
  defaultTo?: { name: string; email: string }[] | null;
  /** Pre-populate the Subject line on a fresh compose (ignored on reply/forward). */
  defaultSubject?: string | null;
  /** Pre-attach files on a fresh compose (e.g. an MTD IT approval-pack PDF). */
  defaultAttachments?: File[] | null;
  /** Full thread messages for the "show quoted thread" panel (reply mode only) */
  threadMessages?: EmailMessage[] | null;
  signature: string | null;
  googleEmail: string;
  displayName: string;
  tasksModuleActive?: boolean;
  onSent?: (threadId: string) => void;
  /** Called after a successful forward send — passes the original thread ID so the inbox can mark it as forwarded */
  onForwardSent?: (originalThreadId: string) => void;
  /** Called after a successful reply send — passes the original thread ID so the inbox can mark it as replied */
  onReplySent?: (originalThreadId: string) => void;
  /** Called after a successful send when the user ticked "Create Task" */
  onCreateTaskFromSent?: (emailData: { subject: string; plainBody: string; toEmail: string; toName: string }) => void;
  /** When set, called instead of onClose when the user clicks the minimise button.
   *  The handler receives a snapshot of the current draft for later restoration. */
  onMinimise?: (snap: ComposeSnapshot) => void;
  /** When provided alongside open=true, the modal restores the snapshot instead
   *  of rebuilding the body from replyTo/forwardOf. Cleared on the next open. */
  initialSnapshot?: ComposeSnapshot | null;
}

const RECIPIENT_STATUS_COLOURS: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  hold:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const QUICK_EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🎉', '🙏', '👀', '✅', '🔥'];

const TEXT_COLOURS = [
  { label: 'Default',  value: 'inherit' },
  { label: 'Black',   value: '#111827' },
  { label: 'Gray',    value: '#6B7280' },
  { label: 'Red',     value: '#DC2626' },
  { label: 'Orange',  value: '#EA580C' },
  { label: 'Yellow',  value: '#CA8A04' },
  { label: 'Green',   value: '#16A34A' },
  { label: 'Blue',    value: '#2563EB' },
  { label: 'Purple',  value: '#7C3AED' },
];

function RecipientTag({ r, onRemove }: { r: SelectedRecipient; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/20">
      {r.name || r.email}
      <button onClick={onRemove} className="hover:text-red-500 ml-0.5"><X size={11} /></button>
    </span>
  );
}

function RecipientInput({
  label, recipients, onAdd, onRemove,
}: {
  label: string;
  recipients: SelectedRecipient[];
  onAdd: (r: SelectedRecipient) => void;
  onRemove: (email: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RecipientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 1) { setResults([]); setOpen(false); return; }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/email/recipients?q=${encodeURIComponent(query)}`);
        const data = await res.json() as { results: RecipientResult[] };
        setResults(data.results ?? []);
        setOpen(true);
      } finally { setSearching(false); }
    }, 200);
  }, [query]);

  function handleSelect(r: RecipientResult) {
    if (!recipients.find(x => x.email === r.email)) onAdd({ name: r.name, email: r.email });
    setQuery(''); setResults([]); setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && query.includes('@')) {
      e.preventDefault();
      if (!recipients.find(x => x.email === query)) onAdd({ name: '', email: query });
      setQuery(''); setOpen(false);
    }
    if (e.key === 'Backspace' && query === '' && recipients.length > 0) {
      onRemove(recipients[recipients.length - 1].email);
    }
  }

  function handleBlur() {
    if (query.includes('@')) {
      if (!recipients.find(x => x.email === query)) onAdd({ name: '', email: query });
      setQuery(''); setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1 flex-wrap border-b border-[var(--border)] py-2 px-1 min-h-[38px]">
        <span className="text-xs font-medium text-[var(--text-muted)] w-5 shrink-0">{label}</span>
        {recipients.map(r => (
          <RecipientTag key={r.email} r={r} onRemove={() => onRemove(r.email)} />
        ))}
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={recipients.length === 0 ? 'Name, code, or email…' : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        {searching && <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-lg overflow-hidden">
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => handleSelect(r)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-nav-hover)] text-left transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-[var(--accent-light)] flex items-center justify-center text-xs font-bold text-[var(--accent)] shrink-0">
                {(r.name || r.email)[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.name}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{r.email}</p>
              </div>
              {r.type === 'client' && r.clientRef && (
                <div className="shrink-0 flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text-muted)]">{r.clientRef}</span>
                  {r.status && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${RECIPIENT_STATUS_COLOURS[r.status.toLowerCase()] ?? RECIPIENT_STATUS_COLOURS.inactive}`}>
                      {r.status}
                    </span>
                  )}
                </div>
              )}
              {r.type === 'team' && <span className="text-[11px] text-[var(--text-muted)] shrink-0">Team</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FmtBtn({ title, onActivate, children }: {
  title: string;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={title}>
      <button
        aria-label={title}
        onMouseDown={e => { e.preventDefault(); onActivate(); }}
        className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        {children}
      </button>
    </Tooltip>
  );
}

export default function ComposeModal({
  open, onClose, replyTo, prefilledBody, replyAllRecipients, forwardOf, defaultClients, defaultTo,
  defaultSubject, defaultAttachments,
  threadMessages, signature, googleEmail, displayName, tasksModuleActive, onSent, onForwardSent, onReplySent, onCreateTaskFromSent,
  onMinimise, initialSnapshot,
}: Props) {
  const [to, setTo] = useState<SelectedRecipient[]>([]);
  const [cc, setCc] = useState<SelectedRecipient[]>([]);
  const [bcc, setBcc] = useState<SelectedRecipient[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestingReply, setSuggestingReply] = useState(false);
  const [rewriting, setRewriting] = useState(false);

  // Attachments
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [fetchingAttachments, setFetchingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Formatting colour picker
  const [colorOpen, setColorOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Emoji picker in toolbar
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Allocation state
  const [selectedClients, setSelectedClients] = useState<Client[]>([]);
  const [allocateOpen, setAllocateOpen] = useState(false);

  // Create Task after send
  const [createTaskEnabled, setCreateTaskEnabled] = useState(false);

  // Thread history preview (in reply mode)
  const [showThread, setShowThread] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  // Close colour picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (colorOpen && colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorOpen]);

  // Close emoji picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (emojiPickerOpen && emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emojiPickerOpen]);

  function fmt(command: string, value?: string) {
    document.execCommand(command, false, value);
    bodyRef.current?.focus();
  }

  function buildInitialBody(replyMsg: typeof replyTo, aiBody?: string | null, fwdMsg?: typeof forwardOf): string {
    const sig = signature ? `<br/><br/>--<br/>${signature}` : '';
    const mainContent = aiBody ? aiBody : `<p><br/></p>`;
    if (fwdMsg) {
      const toLine = fwdMsg.to.map(a => a.name ? `${a.name} &lt;${a.email}&gt;` : a.email).join(', ');
      const fwdBlock = `<br/><br/><div style="border-top:1px solid #e5e7eb;padding-top:12px;color:#555;font-size:13px">
        <p style="margin:0 0 8px 0;font-weight:600;color:#374151">---------- Forwarded message ----------</p>
        <p style="margin:0"><strong>From:</strong> ${fwdMsg.from.name || fwdMsg.from.email} &lt;${fwdMsg.from.email}&gt;<br/>
        <strong>Date:</strong> ${fwdMsg.date}<br/>
        <strong>Subject:</strong> ${fwdMsg.subject}<br/>
        <strong>To:</strong> ${toLine}</p>
        <br/>${fwdMsg.body}
      </div>`;
      return `${mainContent}${sig}${fwdBlock}`;
    }
    if (replyMsg) {
      const quoted = `<br/><br/><blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555;margin:0">
        <p><strong>From:</strong> ${replyMsg.from.name || replyMsg.from.email} &lt;${replyMsg.from.email}&gt;<br/>
        <strong>Date:</strong> ${replyMsg.date}<br/>
        <strong>Subject:</strong> ${replyMsg.subject}</p>
        ${replyMsg.body}
      </blockquote>`;
      return `${mainContent}${sig}${quoted}`;
    }
    return `${mainContent}${sig}`;
  }

  useEffect(() => {
    if (!open) return;
    // Restore from a minimised snapshot — skip the rebuild-from-context path
    if (initialSnapshot) {
      setTo(initialSnapshot.to);
      setCc(initialSnapshot.cc);
      setBcc(initialSnapshot.bcc);
      setShowCc(initialSnapshot.showCc);
      setShowBcc(initialSnapshot.showBcc);
      setSubject(initialSnapshot.subject);
      setAttachedFiles(initialSnapshot.attachedFiles);
      setSelectedClients(initialSnapshot.selectedClients);
      setCreateTaskEnabled(initialSnapshot.createTaskEnabled);
      setShowThread(false);
      requestAnimationFrame(() => {
        if (bodyRef.current) bodyRef.current.innerHTML = initialSnapshot.bodyHtml;
      });
      return;
    }
    if (forwardOf) {
      setTo([]); setCc([]); setShowCc(false);
      setSubject(forwardOf.subject.startsWith('Fwd:') ? forwardOf.subject : `Fwd: ${forwardOf.subject}`);
      // Fetch downloadable attachments from the original message
      setAttachedFiles([]);
      const downloadable = forwardOf.attachments.filter(a => a.attachmentId);
      if (downloadable.length > 0) {
        setFetchingAttachments(true);
        Promise.allSettled(
          downloadable.map(async att => {
            const url = `/api/email/attachment?messageId=${encodeURIComponent(att.messageId)}&attachmentId=${encodeURIComponent(att.attachmentId)}&filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}`;
            const res = await fetch(url);
            const blob = await res.blob();
            return new File([blob], att.filename, { type: att.mimeType || 'application/octet-stream' });
          })
        ).then(results => {
          setAttachedFiles(
            results
              .filter((r): r is PromiseFulfilledResult<File> => r.status === 'fulfilled')
              .map(r => r.value)
          );
          setFetchingAttachments(false);
        });
      }
    } else if (replyAllRecipients) {
      setTo(replyAllRecipients.to);
      setCc(replyAllRecipients.cc);
      setShowCc(replyAllRecipients.cc.length > 0);
      if (replyTo) setSubject(replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`);
    } else if (replyTo) {
      setTo([{ name: replyTo.from.name, email: replyTo.from.email }]);
      setCc([]); setShowCc(false);
      setSubject(replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`);
    } else {
      setTo(defaultTo ?? []); setCc([]); setShowCc(false);
      setSubject(defaultSubject ?? '');
      setAttachedFiles(defaultAttachments ?? []);
    }
    setBcc([]); setShowBcc(false);
    setSelectedClients(defaultClients ?? []);
    setCreateTaskEnabled(false);
    setShowThread(false);
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.innerHTML = buildInitialBody(replyTo, prefilledBody, forwardOf);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, replyTo, replyAllRecipients, forwardOf, prefilledBody, signature]);

  async function handleSend() {
    if (to.length === 0) return;
    const htmlBody = bodyRef.current?.innerHTML ?? '';
    setSending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('to', JSON.stringify(to.map(r => r.name ? `${r.name} <${r.email}>` : r.email)));
      formData.append('cc', JSON.stringify(cc.map(r => r.name ? `${r.name} <${r.email}>` : r.email)));
      formData.append('bcc', JSON.stringify(bcc.map(r => r.name ? `${r.name} <${r.email}>` : r.email)));
      formData.append('subject', subject || '(no subject)');
      formData.append('htmlBody', htmlBody);
      if (replyTo?.id) formData.append('replyToMessageId', replyTo.id);
      if (replyTo?.threadId) formData.append('threadId', replyTo.threadId);
      attachedFiles.forEach(f => formData.append('attachments', f));

      const res = await fetch('/api/email/send', { method: 'POST', body: formData });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? `Send failed (${res.status})`);
      }
      const data = await res.json() as { threadId?: string };
      const sentThreadId = data.threadId ?? '';

      const jobs: Promise<unknown>[] = [];
      if (selectedClients.length > 0 && sentThreadId) {
        jobs.push(fetch('/api/email/allocate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: sentThreadId,
            subject: subject || '(no subject)',
            snippet: '', date: new Date().toISOString(),
            fromName: displayName, fromEmail: googleEmail,
            clientIds: selectedClients.map(c => c.id),
          }),
        }));
      }
      await Promise.allSettled(jobs);

      // Capture email data BEFORE closing (for Create Task flow)
      const plainBody = htmlBody.replace(/<[^>]+>/g, ' ').slice(0, 3000);
      const firstTo   = to[0] ?? { name: '', email: '' };
      const shouldCreateTask = createTaskEnabled;

      onSent?.(sentThreadId);
      // If this was a forward, notify the parent so it can mark the original thread
      if (forwardOf?.threadId) {
        onForwardSent?.(forwardOf.threadId);
      }
      // If this was a reply (not a forward), notify so the inbox can mark it as replied
      if (replyTo?.threadId && !forwardOf) {
        onReplySent?.(replyTo.threadId);
      }
      onClose();

      // Open Create Task flow after modal closes
      if (shouldCreateTask && onCreateTaskFromSent) {
        onCreateTaskFromSent({
          subject: subject || '(no subject)',
          plainBody,
          toEmail: firstTo.email,
          toName:  firstTo.name,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email. Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    setError(null);
    try {
      const htmlBody = bodyRef.current?.innerHTML ?? '';
      await fetch('/api/email/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.map(r => r.name ? `${r.name} <${r.email}>` : r.email),
          cc: cc.map(r => r.name ? `${r.name} <${r.email}>` : r.email),
          bcc: bcc.map(r => r.name ? `${r.name} <${r.email}>` : r.email),
          subject: subject || '(no subject)',
          htmlBody: htmlBody || '',
          replyToMessageId: replyTo?.id,
          threadId: replyTo?.threadId,
          fromEmail: googleEmail,
          fromName: displayName,
        }),
      });
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2500);
    } catch {
      setError('Failed to save draft.');
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleRewrite() {
    const currentHtml = bodyRef.current?.innerHTML ?? '';
    setRewriting(true);
    setError(null);
    try {
      const res = await fetch('/api/email/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body: currentHtml,
          myName: displayName,
          mode: 'rewrite',
        }),
      });
      const data = await res.json() as { result?: string };
      if (data.result && bodyRef.current) {
        const sig = signature ? `<br/><br/>--<br/>${signature}` : '';
        const quoted = currentHtml.includes('<blockquote') ? '<br/>' + currentHtml.substring(currentHtml.indexOf('<blockquote')) : '';
        bodyRef.current.innerHTML = data.result + sig + quoted;
      }
    } catch {
      setError('Rewrite failed. Please try again.');
    } finally {
      setRewriting(false);
    }
  }

  async function handleSuggestReply() {
    if (!replyTo) return;
    setSuggestingReply(true);
    try {
      const threadSummary = replyTo.body.replace(/<[^>]+>/g, ' ').slice(0, 2000);
      const res = await fetch('/api/email/suggest-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: replyTo.subject, threadSummary,
          senderName: replyTo.from.name || replyTo.from.email,
          myName: displayName, myEmail: googleEmail,
        }),
      });
      const data = await res.json() as { reply?: string };
      if (data.reply && bodyRef.current) {
        const sig = signature ? `<br/><br/>--<br/>${signature}` : '';
        const currentHtml = bodyRef.current.innerHTML;
        const quoted = currentHtml.includes('<blockquote') ? currentHtml.substring(currentHtml.indexOf('<blockquote')) : '';
        bodyRef.current.innerHTML = `<p>${data.reply.replace(/\n/g, '<br/>')}</p>${sig}${quoted ? '<br/>' + quoted : ''}`;
      }
    } finally {
      setSuggestingReply(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const MAX_TOTAL = 20 * 1024 * 1024; // 20 MB client-side guard
    const incoming = Array.from(files);
    const total = [...attachedFiles, ...incoming].reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL) {
      setError('Total attachment size must be under 20 MB.');
      return;
    }
    setAttachedFiles(prev => [...prev, ...incoming]);
  }

  if (!open) return null;

  const toEmails = to.map(r => r.email).filter(Boolean);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none">
        <div
          className="w-full max-w-2xl bg-[var(--bg-card-solid)] rounded-xl shadow-2xl border border-[var(--border)] pointer-events-auto flex flex-col"
          style={{ maxHeight: '85vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0 bg-[var(--bg-nav)] rounded-t-xl">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {forwardOf ? 'Forward' : replyTo ? (replyAllRecipients ? 'Reply All' : 'Reply') : 'New Message'}
            </h3>
            <div className="flex items-center gap-0.5">
              {onMinimise && (
                <Tooltip label="Minimise">
                  <button
                    onClick={() => {
                      onMinimise({
                        to, cc, bcc, showCc, showBcc, subject,
                        bodyHtml: bodyRef.current?.innerHTML ?? '',
                        attachedFiles, selectedClients, createTaskEnabled,
                      });
                    }}
                    aria-label="Minimise"
                    className="p-1 rounded hover:bg-[var(--bg-nav-hover)] transition-colors"
                  >
                    <Minus size={16} className="text-[var(--text-muted)]" />
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Close">
                <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-[var(--bg-nav-hover)] transition-colors">
                  <X size={16} className="text-[var(--text-muted)]" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Recipients */}
          <div className="px-4 shrink-0 bg-[var(--bg-card-solid)]">
            <RecipientInput
              label="To" recipients={to}
              onAdd={r => setTo(prev => [...prev, r])}
              onRemove={email => setTo(prev => prev.filter(x => x.email !== email))}
            />
            {showCc ? (
              <RecipientInput
                label="Cc" recipients={cc}
                onAdd={r => setCc(prev => [...prev, r])}
                onRemove={email => setCc(prev => prev.filter(x => x.email !== email))}
              />
            ) : null}
            {showBcc ? (
              <RecipientInput
                label="Bcc" recipients={bcc}
                onAdd={r => setBcc(prev => [...prev, r])}
                onRemove={email => setBcc(prev => prev.filter(x => x.email !== email))}
              />
            ) : null}
            {(!showCc || !showBcc) && (
              <div className="flex gap-2 py-1.5 px-1">
                {!showCc && (
                  <button onClick={() => setShowCc(true)} className="text-xs text-[var(--accent)] hover:underline">
                    + Cc
                  </button>
                )}
                {!showBcc && (
                  <button onClick={() => setShowBcc(true)} className="text-xs text-[var(--accent)] hover:underline">
                    + Bcc
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Subject */}
          <div className="px-4 border-b border-[var(--border)] shrink-0 bg-[var(--bg-card-solid)]">
            <input
              type="text" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Subject (optional)"
              className="w-full py-2 bg-transparent text-sm outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>

          {/* Formatting toolbar */}
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-[var(--border)] shrink-0 bg-[var(--bg-card-solid)]">
            <FmtBtn title="Bold" onActivate={() => fmt('bold')}><Bold size={13} /></FmtBtn>
            <FmtBtn title="Italic" onActivate={() => fmt('italic')}><Italic size={13} /></FmtBtn>
            <FmtBtn title="Underline" onActivate={() => fmt('underline')}><Underline size={13} /></FmtBtn>
            <FmtBtn title="Strikethrough" onActivate={() => fmt('strikeThrough')}><Strikethrough size={13} /></FmtBtn>

            <div className="w-px h-4 bg-[var(--border)] mx-1" />

            {/* Colour picker */}
            <div className="relative" ref={colorPickerRef}>
              <Tooltip label="Text colour">
                <button
                  aria-label="Text colour"
                  onMouseDown={e => { e.preventDefault(); setColorOpen(o => !o); }}
                  className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Palette size={13} />
                </button>
              </Tooltip>
              {colorOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 p-2 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-lg flex gap-1.5 flex-wrap w-36">
                  {TEXT_COLOURS.map(c => (
                    <Tooltip key={c.value} label={c.label}>
                      <button
                        aria-label={c.label}
                        onMouseDown={e => {
                          e.preventDefault();
                          fmt('foreColor', c.value === 'inherit' ? '#111827' : c.value);
                          setColorOpen(false);
                        }}
                        className="w-5 h-5 rounded-full border border-[var(--border)] hover:scale-110 transition-transform shrink-0"
                        style={{ backgroundColor: c.value === 'inherit' ? '#F4F6FA' : c.value }}
                      />
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>

            <div className="w-px h-4 bg-[var(--border)] mx-1" />

            <FmtBtn title="Bullet list" onActivate={() => fmt('insertUnorderedList')}><List size={13} /></FmtBtn>
            <FmtBtn title="Numbered list" onActivate={() => fmt('insertOrderedList')}><ListOrdered size={13} /></FmtBtn>

            <div className="w-px h-4 bg-[var(--border)] mx-1" />

            {/* Emoji picker */}
            <div className="relative" ref={emojiPickerRef}>
              <Tooltip label="Insert emoji">
                <button
                  aria-label="Insert emoji"
                  onMouseDown={e => { e.preventDefault(); setEmojiPickerOpen(o => !o); }}
                  className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Smile size={13} />
                </button>
              </Tooltip>
              {emojiPickerOpen && (
                <div
                  className="absolute bottom-full mb-1 left-0 z-50 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-lg p-2 flex flex-wrap gap-1"
                  style={{ width: 188 }}
                >
                  {QUICK_EMOJIS.map(em => (
                    <button
                      key={em}
                      onMouseDown={ev => {
                        ev.preventDefault();
                        bodyRef.current?.focus();
                        document.execCommand('insertText', false, em);
                        setEmojiPickerOpen(false);
                      }}
                      className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Body — the modal itself sizes to its content (capped at 85vh)
              rather than always being 85vh tall, so flex-1 on this wrapper
              alone won't give the editor a bounded height to scroll within.
              We pin a real max-height on the contentEditable so it always
              scrolls once the email body grows past ~50vh, regardless of
              the modal's outer size. */}
          <div className="flex-1 min-h-0 overflow-hidden relative bg-[var(--bg-page)]">
            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              className="w-full p-4 text-sm text-[var(--text-primary)] outline-none overflow-y-auto [&_blockquote]:opacity-70 [&_blockquote]:text-sm"
              style={{ minHeight: 160, maxHeight: '50vh' }}
            />
          </div>

          {/* Thread history (reply/forward mode — shows prior messages collapsed) */}
          {replyTo && threadMessages && threadMessages.length > 0 && (
            <div className="border-t border-[var(--border)] shrink-0">
              <button
                onClick={() => setShowThread(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {showThread ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showThread ? 'Hide' : 'Show'} thread history ({threadMessages.length} message{threadMessages.length !== 1 ? 's' : ''})
              </button>
              {showThread && (
                <div className="max-h-52 overflow-y-auto bg-[var(--bg-page)] border-t border-[var(--border)] divide-y divide-[var(--border)]">
                  {threadMessages.map(msg => (
                    <div key={msg.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-medium text-[var(--text-secondary)]">
                          {msg.from.name || msg.from.email}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">{msg.date}</span>
                      </div>
                      {msg.body ? (
                        <div
                          className="text-xs text-[var(--text-muted)] line-clamp-3 [&_a]:text-[var(--accent)] [&_img]:hidden"
                          dangerouslySetInnerHTML={{ __html: msg.body }}
                        />
                      ) : (
                        <p className="text-xs text-[var(--text-muted)] italic">{msg.snippet}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Attached files */}
          {(attachedFiles.length > 0 || fetchingAttachments) && (
            <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-[var(--border)] shrink-0 bg-[var(--bg-card-solid)]">
              {fetchingAttachments && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs text-[var(--text-muted)] bg-[var(--bg-nav-hover)] border border-[var(--border)]">
                  <Loader2 size={10} className="animate-spin" /> Fetching attachments…
                </span>
              )}
              {attachedFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg text-xs bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] border border-[var(--border)]">
                  <Paperclip size={10} />
                  <Tooltip label="Open attachment in a new tab">
                    <button
                      type="button"
                      onClick={() => previewAttachment(f)}
                      className="max-w-[140px] truncate text-left hover:text-[var(--accent)] hover:underline"
                    >
                      {f.name}
                    </button>
                  </Tooltip>
                  <span className="text-[var(--text-muted)] shrink-0">({Math.round(f.size / 1024)}KB)</span>
                  <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="hover:text-red-500 ml-0.5" aria-label="Remove attachment">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-[var(--border)] shrink-0 bg-[var(--bg-nav-hover)] rounded-b-xl">

            {/* Chips row — shown when clients are allocated */}
            {selectedClients.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5 px-3 pt-2.5 pb-1">
                {selectedClients.map(c => (
                  <span key={c.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700">
                    <UserPlus size={10} />{c.name}
                    <button onClick={() => setSelectedClients(prev => prev.filter(x => x.id !== c.id))} className="hover:text-red-500 ml-0.5"><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}

            {/* Action row */}
            <div className="flex items-center gap-1.5 px-3 py-2.5">

              {/* Group 1: Attach — icon-only */}
              <Tooltip label="Attach files">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach files"
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40 transition-colors shrink-0"
                >
                  <Paperclip size={15} />
                </button>
              </Tooltip>
              <input
                ref={fileInputRef} type="file" multiple className="hidden"
                onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
              />

              <div className="w-px h-5 bg-[var(--border)] mx-0.5 shrink-0" />

              {/* Group 2: AI actions — purple-tinted */}
              {replyTo && (
                <button
                  onClick={handleSuggestReply} disabled={suggestingReply || rewriting}
                  className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors font-medium shrink-0 disabled:opacity-50"
                >
                  {suggestingReply ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  Suggest
                </button>
              )}
              <button
                onClick={handleRewrite} disabled={rewriting || suggestingReply}
                className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors font-medium shrink-0 disabled:opacity-50"
              >
                {rewriting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                Rewrite
              </button>

              <div className="w-px h-5 bg-[var(--border)] mx-0.5 shrink-0" />

              {/* Group 3: Filing buttons */}
              <button
                onClick={() => setAllocateOpen(true)}
                className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors font-medium shrink-0"
              >
                <UserPlus size={11} />{selectedClients.length > 0 ? 'Add Client' : 'Allocate'}
              </button>
              {tasksModuleActive && (
                <Tooltip label={createTaskEnabled ? 'Create Task after send (on)' : 'Create Task after send (off)'} side="top">
                  <button
                    onClick={() => setCreateTaskEnabled(v => !v)}
                    aria-label={createTaskEnabled ? 'Create Task after send (on)' : 'Create Task after send (off)'}
                    className={`text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors font-medium shrink-0 ${
                      createTaskEnabled
                        ? 'border-indigo-400 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                        : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                    }`}
                  >
                    <CheckSquare size={11} className={createTaskEnabled ? 'fill-indigo-200' : ''} />
                    Create Task
                    {createTaskEnabled && <Check size={10} />}
                  </button>
                </Tooltip>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Right: status + Save Draft icon + Send */}
              {error && <span className="text-xs text-red-500 shrink-0 max-w-xs leading-tight">{error}</span>}
              {draftSaved && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                  <Check size={11} /> Saved
                </span>
              )}
              <Tooltip label="Save draft" side="top">
                <button
                  onClick={handleSaveDraft} disabled={savingDraft || sending}
                  aria-label="Save draft"
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]/40 transition-colors disabled:opacity-50 shrink-0"
                >
                  {savingDraft ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                </button>
              </Tooltip>
              <button
                onClick={handleSend} disabled={sending || to.length === 0}
                className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AllocateModal
        open={allocateOpen}
        onClose={() => setAllocateOpen(false)}
        suggestEmails={toEmails}
        preSelectedIds={selectedClients.map(c => c.id)}
        onSelect={clients => setSelectedClients(clients)}
      />
    </>
  );
}

/**
 * Opens a draft attachment in a new browser tab so the user can eyeball the
 * file before they hit Send. We use a blob: URL because the File only exists
 * in memory at this point — nothing has been uploaded yet. The URL is
 * revoked shortly after to free memory; 60s is plenty for the browser to
 * load the resource and discard the reference.
 */
function previewAttachment(file: File) {
  try {
    const url = URL.createObjectURL(file);
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    // Some browsers refuse to render certain MIME types inline (e.g. .csv,
    // .xlsx) — fall back to a download in that case.
    if (!win) {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    console.error('previewAttachment', e);
  }
}
