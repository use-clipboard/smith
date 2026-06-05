'use client';

import { useState, useEffect, useRef } from 'react';
import {
  X, Send, Loader2, Sparkles, Check, Save, UserPlus, CheckSquare,
  Paperclip, Bold, Italic, Underline, Strikethrough, List, ListOrdered, Palette,
  Smile, Minus, AlertCircle, PenLine,
} from 'lucide-react';
import type { EmailMessage } from '@/lib/gmail';
import AllocateModal, { type Client } from './AllocateModal';
import Tooltip from '@/components/ui/Tooltip';
import { useSmartCompose, stripGhostHtml } from './useSmartCompose';
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
  /** Resume editing a saved Gmail draft — the modal updates this draft on
   *  Save Draft and deletes it after a successful Send. */
  defaultDraftId?:     string | null;
  /** Pre-fill BCC (e.g. when resuming a saved draft with BCC recipients). */
  defaultBcc?:         { name: string; email: string }[] | null;
  /** Pre-fill the body HTML verbatim — used when resuming a draft so we
   *  skip the reply/forward body builders that would otherwise overwrite it. */
  defaultHtmlBody?:    string | null;
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

/** Permissive email check — mirrors the server's zod `.email()` so the client
 *  flags exactly the addresses the API would reject, before a send is attempted. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ── Smart Compose: greeting → recipient name ─────────────────────────────────
/** First word of a name, capitalised (e.g. "agia marina" → "Agia"). */
function firstNameOf(full: string): string {
  const w = (full || '').trim().split(/\s+/)[0] ?? '';
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
}

const NAME_PREFIXES = new Set(['fr', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'rev', 'prof']);
/** First real name word on a line, skipping honorific prefixes (fr/mr/dr…). */
function firstRealName(line: string): string {
  for (const w of line.trim().split(/\s+/)) {
    const clean = w.replace(/[^A-Za-z'’.-]/g, '');
    if (clean && !NAME_PREFIXES.has(clean.toLowerCase())) return clean;
  }
  return '';
}

/** Pull the name someone signed off with from an email body (the LAST sign-off
 *  wins — that's the actual closing, not one quoted mid-thread). */
function extractSignOffName(html: string): string {
  const plain = (html || '').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ');
  const re = /\b(?:kind regards|kindest regards|warm regards|best regards|many thanks|thank you|thanks|best wishes|regards|yours sincerely|yours faithfully|cheers)[,!.\s]*\n+\s*([^\n]+)/gi;
  let last = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain)) !== null) last = m[1];
  return firstRealName(last);
}

/** If the text typed so far ends in a greeting with no name yet, return the
 *  name to suggest (with a leading space if needed); otherwise ''. */
function greetingCompletion(context: string, recipientName: string): string {
  if (!recipientName) return '';
  if (!/(?:^|\n|\s)(dear|hi|hello|hey|good morning|good afternoon|good evening)[ \t]*$/i.test(context)) return '';
  const needsSpace = !/[ \t]$/.test(context);
  return (needsSpace ? ' ' : '') + recipientName;
}

function RecipientTag({ r, onRemove }: { r: SelectedRecipient; onRemove: () => void }) {
  const invalid = !isValidEmail(r.email);
  const tag = (
    <span className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs border ${
      invalid
        ? 'bg-red-50 text-red-600 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
        : 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/20'
    }`}>
      {invalid && <AlertCircle size={11} className="shrink-0" />}
      {r.name || r.email}
      <button onClick={onRemove} className="hover:text-red-500 ml-0.5" aria-label="Remove recipient"><X size={11} /></button>
    </span>
  );
  // Invalid addresses get a red pill + an explanatory tooltip on hover, so the
  // user can see exactly which recipient is wrong without a blocking banner.
  return invalid
    ? <Tooltip label={`"${r.email}" is not a valid email address`}>{tag}</Tooltip>
    : tag;
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

// ── Tiny inline auto-correct ────────────────────────────────────────────────
// Fires on each keystroke in the body editor. When the user types a word-
// boundary character (space, punctuation, newline) we look at the word that
// just terminated and, if it matches a rule, swap it in-place. The selection
// is restored afterwards so the cursor doesn't jump.
//
// Deliberately conservative: only the "i / I" capitalisation and the safe
// contractions where the apostrophe-less form is essentially always wrong
// (dont, youre, im, etc.). Ambiguous words like "its" / "well" / "were" /
// "hes" are NOT in the list because they have valid non-contracted meanings.
const AUTOCORRECT_RULES: Record<string, string> = {
  i:           'I',
  im:          "I'm",
  ive:         "I've",
  ill:         "I'll",
  id:          "I'd",
  youre:       "you're",
  youve:       "you've",
  youll:       "you'll",
  youd:        "you'd",
  weve:        "we've",
  well:        "we'll", // intentionally NOT mapped — "well" has other meanings
  theyre:      "they're",
  theyve:      "they've",
  theyll:      "they'll",
  theyd:       "they'd",
  dont:        "don't",
  doesnt:      "doesn't",
  didnt:       "didn't",
  wont:        "won't",
  cant:        "can't",
  isnt:        "isn't",
  arent:       "aren't",
  wasnt:       "wasn't",
  werent:      "weren't",
  hasnt:       "hasn't",
  havent:      "haven't",
  hadnt:       "hadn't",
  wouldnt:     "wouldn't",
  couldnt:     "couldn't",
  shouldnt:    "shouldn't",
  mustnt:      "mustn't",
  thats:       "that's",
  whats:       "what's",
  wheres:      "where's",
  whens:       "when's",
  hows:        "how's",
  whos:        "who's",
  lets:        "let's",
};
// Remove the ambiguous "well" entry from the rule set on load — kept above
// only as a breadcrumb so future me doesn't re-add it without thinking.
delete AUTOCORRECT_RULES.well;

function applyAutoCorrectRule(matched: string): string | null {
  const rule = AUTOCORRECT_RULES[matched.toLowerCase()];
  if (!rule) return null;
  // Rules starting uppercase (the I-words) are used verbatim regardless of
  // how the user typed it — "im", "Im", "IM" all become "I'm".
  if (/^[A-Z]/.test(rule)) return rule;
  // Otherwise preserve the casing of the first letter the user typed.
  if (/^[A-Z]/.test(matched)) return rule.charAt(0).toUpperCase() + rule.slice(1);
  return rule;
}

function runAutoCorrect(root: HTMLElement): void {
  const sel = root.ownerDocument.defaultView?.getSelection?.();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
  const range  = sel.getRangeAt(0);
  const node   = range.startContainer;
  // We only operate on text nodes that live inside the editor.
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return;
  const text   = node.textContent ?? '';
  const caret  = range.startOffset;
  if (caret < 2) return;
  // The character immediately before the caret should be the word delimiter
  // that *just* got inserted. We don't want to autocorrect mid-word.
  const delim  = text[caret - 1];
  if (!/[\s.,!?;:)\]"]/.test(delim)) return;
  // Walk back from the delimiter to find the start of the preceding word.
  let wordEnd   = caret - 1;
  let wordStart = wordEnd;
  while (wordStart > 0 && /[A-Za-z]/.test(text[wordStart - 1])) wordStart--;
  if (wordStart === wordEnd) return;
  const word        = text.slice(wordStart, wordEnd);
  const replacement = applyAutoCorrectRule(word);
  if (!replacement || replacement === word) return;
  node.textContent = text.slice(0, wordStart) + replacement + text.slice(wordEnd);
  // Restore the caret to the same logical position (after the delimiter).
  const delta     = replacement.length - word.length;
  const newOffset = caret + delta;
  const newRange  = root.ownerDocument.createRange();
  newRange.setStart(node, Math.min(newOffset, node.textContent.length));
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
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
  defaultDraftId, defaultBcc, defaultHtmlBody,
  signature, googleEmail, displayName, tasksModuleActive, onSent, onForwardSent, onReplySent, onCreateTaskFromSent,
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
  // Tracks the Gmail draft id when this compose window is editing a saved
  // draft (or after the user hits Save Draft once). Resaves update the same
  // draft instead of creating duplicates; Send deletes it on success.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestingReply, setSuggestingReply] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  // "Help me write" — free-text instruction → drafted email.
  const [helpWriteOpen, setHelpWriteOpen] = useState(false);
  const [helpWriteText, setHelpWriteText] = useState('');
  const [helpWriting, setHelpWriting] = useState(false);
  // Smart Compose (inline Tab-to-accept suggestions) — on by default, remembered.
  const [smartComposeOn, setSmartComposeOn] = useState(true);
  useEffect(() => {
    try { const v = localStorage.getItem('smith.smartCompose'); if (v !== null) setSmartComposeOn(v === '1'); } catch { /* ignore */ }
  }, []);
  function toggleSmartCompose() {
    setSmartComposeOn(v => {
      const next = !v;
      try { localStorage.setItem('smith.smartCompose', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  // Attachments
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [fetchingAttachments, setFetchingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag-over UI state. Tracked as a counter rather than a boolean because
  // dragenter/dragleave fire for every child element the cursor crosses, so
  // a naive boolean would flicker as the user moves over the editor / inputs.
  const [dragDepth, setDragDepth] = useState(0);

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
    // execCommand operates on the active selection — so the editor must have
    // focus BEFORE the command runs. Toolbar buttons use onMouseDown +
    // preventDefault to avoid stealing focus, but on the very first click
    // (before the user has placed a caret in the body) there's no selection
    // at all and commands like insertUnorderedList silently no-op. Focusing
    // first guarantees there's a caret to operate on.
    bodyRef.current?.focus();
    document.execCommand(command, false, value);
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
    setBcc(defaultBcc ?? []); setShowBcc((defaultBcc?.length ?? 0) > 0);
    // De-dupe by client id — the thread can carry one allocation entry per
    // message, but the composer should show each client just once.
    setSelectedClients(
      defaultClients
        ? defaultClients.filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)
        : [],
    );
    setCreateTaskEnabled(false);
    // Resuming a saved draft: stash the draft id so subsequent saves update
    // the same Gmail draft. Bumps the "draft saved" indicator off — that's
    // a transient confirmation, not the resume state.
    setDraftId(defaultDraftId ?? null);
    setDraftSaved(false);
    requestAnimationFrame(() => {
      if (bodyRef.current) {
        // When resuming a draft we want the exact body the user previously
        // typed, not the reply/forward template. defaultHtmlBody wins over
        // buildInitialBody for that reason.
        bodyRef.current.innerHTML = defaultHtmlBody && defaultHtmlBody.length > 0
          ? defaultHtmlBody
          : buildInitialBody(replyTo, prefilledBody, forwardOf);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, replyTo, replyAllRecipients, forwardOf, prefilledBody, signature, defaultDraftId, defaultBcc, defaultHtmlBody]);

  async function handleSend() {
    if (to.length === 0) return;
    const htmlBody = readBody();
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
      const data = await res.json() as { threadId?: string; messageId?: string };
      const sentThreadId = data.threadId ?? '';
      const sentMessageId = data.messageId ?? '';

      // If this compose was editing a saved draft, discard the Gmail draft
      // now that the email has actually gone out — otherwise the draft sits
      // in the user's Drafts folder forever alongside the real sent message.
      if (draftId) {
        void fetch(`/api/email/draft?draftId=${encodeURIComponent(draftId)}`, { method: 'DELETE' })
          .catch(() => { /* non-fatal — manual cleanup at worst */ });
      }

      const jobs: Promise<unknown>[] = [];
      if (selectedClients.length > 0 && sentThreadId) {
        jobs.push(fetch('/api/email/allocate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: sentThreadId,
            // Tag the allocation with the Gmail id of the message we just
            // sent so it lands as its own row on the client timeline,
            // even when replying on a thread that's already allocated.
            messageId: sentMessageId || undefined,
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
      const htmlBody = readBody();
      const res = await fetch('/api/email/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // When draftId is set the server updates this existing Gmail draft
          // instead of creating a new one — that's what keeps "Save → close
          // → open again from Drafts" round-tripping the same draft.
          draftId: draftId ?? undefined,
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
      if (!res.ok) {
        // Don't claim success on a failed save — that's how drafts silently
        // went missing (the user saw "Saved" but nothing was created).
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error || 'Failed to save draft.');
      }
      const j = await res.json().catch(() => ({})) as { draftId?: string };
      // Remember the draft id for subsequent saves so we keep editing the
      // same draft rather than spawning a fresh one each time.
      if (j.draftId) setDraftId(j.draftId);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft.');
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleRewrite() {
    const currentHtml = readBody();
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

  // "Help me write" — turn a free-text instruction into a drafted email body,
  // using the current draft + (on replies) the thread as context.
  async function handleHelpWrite() {
    const instruction = helpWriteText.trim();
    if (!instruction || helpWriting) return;
    const currentHtml = readBody();
    setHelpWriting(true);
    setError(null);
    try {
      const threadSummary = replyTo ? replyTo.body.replace(/<[^>]+>/g, ' ').slice(0, 2500) : undefined;
      const res = await fetch('/api/email/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body: currentHtml, myName: displayName, mode: 'instruct', instruction, threadSummary }),
      });
      const data = await res.json() as { result?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      if (data.result && bodyRef.current) {
        const sig = signature ? `<br/><br/>--<br/>${signature}` : '';
        // Preserve any quoted reply thread that was already in the editor.
        const quoted = currentHtml.includes('<blockquote') ? '<br/>' + currentHtml.substring(currentHtml.indexOf('<blockquote')) : '';
        bodyRef.current.innerHTML = data.result + sig + quoted;
        setHelpWriteText('');
        setHelpWriteOpen(false);
      }
    } catch {
      setError('Couldn’t draft that — please try again.');
    } finally {
      setHelpWriting(false);
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
        const currentHtml = readBody();
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

  // Read the editor HTML with any Smart Compose ghost text stripped — never let
  // an unaccepted suggestion leak into a sent/saved email. Strip on a clone of
  // the DOM (robust to the ghost's nested hint chip), with a regex guard too.
  function readBody() {
    const el = bodyRef.current;
    if (!el) return '';
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-sc-ghost]').forEach(n => n.remove());
    return stripGhostHtml(clone.innerHTML);
  }

  // Smart Compose prediction source — the text typed up to the caret + context.
  async function predictSmart(context: string): Promise<string> {
    try {
      const threadSummary = replyTo ? replyTo.body.replace(/<[^>]+>/g, ' ').slice(0, 800) : undefined;
      const res = await fetch('/api/email/smart-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, subject, threadSummary }),
      });
      if (!res.ok) return '';
      const data = await res.json() as { suggestion?: string };
      return data.suggestion ?? '';
    } catch { return ''; }
  }

  // Who to address — how they signed off the last email, else the sender's
  // name, else the To recipient. Drives the instant greeting → name suggestion.
  const recipientName = firstNameOf(
    replyTo
      ? (extractSignOffName(replyTo.body) || replyTo.from?.name || '')
      : (to[0]?.name || ''),
  );

  useSmartCompose(bodyRef, {
    enabled: smartComposeOn,
    active: open,
    predict: predictSmart,
    localComplete: (context) => greetingCompletion(context, recipientName),
  });

  if (!open) return null;

  const toEmails = to.map(r => r.email).filter(Boolean);
  // Any malformed address in To/Cc/Bcc blocks the send — the offending tag is
  // shown in red so the user knows which one to fix.
  const hasInvalidRecipient = [...to, ...cc, ...bcc].some(r => !isValidEmail(r.email));

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none">
        <div
          className="relative w-full max-w-2xl bg-[var(--bg-card-solid)] rounded-xl shadow-2xl border border-[var(--border)] pointer-events-auto flex flex-col"
          style={{ maxHeight: '85vh' }}
          onDragEnter={e => {
            // Only react when the drag carries actual files — ignore the
            // user dragging selected text from the body editor, etc.
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragDepth(d => d + 1);
          }}
          onDragOver={e => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={e => {
            if (!e.dataTransfer.types.includes('Files')) return;
            setDragDepth(d => Math.max(0, d - 1));
          }}
          onDrop={e => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragDepth(0);
            handleFiles(e.dataTransfer.files);
          }}
        >
          {dragDepth > 0 && (
            <div className="absolute inset-0 z-50 rounded-xl bg-[var(--accent-light)]/70 border-2 border-dashed border-[var(--accent)] flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-card-solid)] shadow-md text-sm font-medium text-[var(--accent)]">
                <Paperclip size={14} /> Drop to attach
              </div>
            </div>
          )}
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
                        bodyHtml: readBody(),
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
                  <Palette size={13} className="translate-y-0.5" />
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
                  <Smile size={13} className="translate-y-0.5" />
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

            {/* Smart Compose toggle — inline Tab-to-accept suggestions */}
            <div className="ml-auto">
              <Tooltip label={smartComposeOn ? 'Smart suggestions on — press → (right arrow) to accept (click to turn off)' : 'Smart suggestions off (click to turn on)'} side="top">
                <button
                  type="button"
                  onClick={toggleSmartCompose}
                  aria-label="Toggle smart suggestions"
                  aria-pressed={smartComposeOn}
                  className={`flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    smartComposeOn
                      ? 'text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-400'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]'
                  }`}
                >
                  <Sparkles size={12} /> Suggestions
                </button>
              </Tooltip>
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
              onInput={e => {
                // Skip while an IME composition is in flight — running mid-
                // composition would clobber the partial input.
                const ne = e.nativeEvent as InputEvent;
                if (ne.isComposing) return;
                runAutoCorrect(e.currentTarget);
              }}
              className="w-full p-4 text-sm text-[var(--text-primary)] outline-none overflow-y-auto [&_blockquote]:opacity-70 [&_blockquote]:text-sm [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1"
              style={{ minHeight: 160, maxHeight: '50vh' }}
            />
          </div>

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

            {/* Status row — errors and recipient warnings live on their own
                full-width line that wraps freely, so a long message can never
                push the Send button off the edge of the window (the old bug). */}
            {(error || hasInvalidRecipient) && (
              <div className="flex items-start gap-1.5 px-3 pt-2.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle size={13} className="shrink-0 mt-px" />
                <span className="leading-snug">
                  {error ?? 'One or more recipients have an invalid email address — hover the red recipient to see which.'}
                </span>
              </div>
            )}

            {/* Help me write — instruction bar */}
            {helpWriteOpen && (
              <div className="flex items-center gap-2 px-3 pt-2.5">
                <PenLine size={14} className="text-purple-500 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={helpWriteText}
                  onChange={e => setHelpWriteText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); void handleHelpWrite(); }
                    if (e.key === 'Escape') setHelpWriteOpen(false);
                  }}
                  placeholder="Describe the email… e.g. “polite chase for the tax code, needed by Friday”"
                  className="flex-1 text-sm bg-[var(--bg-page)] border border-[var(--border-input)] rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-purple-400 text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
                <button
                  onClick={() => void handleHelpWrite()}
                  disabled={!helpWriteText.trim() || helpWriting}
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 shrink-0 font-medium"
                >
                  {helpWriting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {helpWriting ? 'Writing…' : 'Draft it'}
                </button>
              </div>
            )}

            {/* Action row — wraps to a second line on narrow widths (e.g. the
                docked reply panel) so the buttons never overlap. */}
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5">

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
              <Tooltip label="Help me write — describe the email and let AI draft it">
                <button
                  onClick={() => setHelpWriteOpen(o => !o)}
                  aria-label="Help me write"
                  className={`text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors font-medium shrink-0 ${
                    helpWriteOpen
                      ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                      : 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30'
                  }`}
                >
                  <PenLine size={11} /> Help me write
                </button>
              </Tooltip>
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

              {/* Right: status + Save Draft icon + Send. ml-auto pins this group
                  to the right; on a wrapped row it sits at the right of its line. */}
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
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
                <Tooltip label={hasInvalidRecipient ? 'Fix the invalid recipient (shown in red) before sending' : 'Send'} side="top">
                  <button
                    onClick={handleSend} disabled={sending || to.length === 0 || hasInvalidRecipient}
                    aria-label="Send"
                    className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                  >
                    {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </Tooltip>
              </div>
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
