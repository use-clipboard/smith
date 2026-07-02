'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Mail, PenSquare, Loader2, Settings, Settings2, X, AlertTriangle, PanelRightOpen, Sparkles } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import EmailTopTabs from './EmailTopTabs';
import EmailFilterBar, { type TimeFilter } from './EmailFilterBar';
import EmailCategoryCards from './EmailCategoryCards';
import { EMAIL_CATEGORIES, CATEGORY_META, type EmailCategory } from './emailCategories';
import EmailList from './EmailList';
import EmailThread from './EmailThread';
import EmailContextPanel, { type AiSummary, type SummaryAction } from './EmailContextPanel';
import { useComposeWindow } from './ComposeWindowProvider';
import { EMAIL_SENT_EVENT, EMAIL_DRAFT_DISCARDED_EVENT, EMAIL_DRAFT_CREATED_EVENT } from './GlobalComposeWindow';
import AllocateModal from './AllocateModal';
import EmailRulesModal from './EmailRulesModal';
import QuickTaskModal from '@/components/features/tasks/QuickTaskModal';
import type { CreateTaskData } from '@/components/features/tasks/CreateTaskModal';
import { useModules } from '@/components/ui/ModulesProvider';
import { EMAIL_OPEN_THREAD_EVENT, EMAIL_OPEN_THREAD_KEY, type OpenEmailThreadPayload } from '@/components/ui/EmailToastNotifier';
import { createClient } from '@/lib/supabase';
import type { EmailThread as EmailThreadType, EmailMessage, GmailLabel } from '@/lib/gmail';
import type { Client } from './AllocateModal';
import type { EmailRule } from '@/app/api/email/rules/route';

interface Allocation {
  client_id: string;
  clients: { id: string; name: string; client_ref: string; risk_rating: string } | null;
  users: { full_name: string } | null;
}

interface TaskLink {
  task_id: string;
  tasks: { id: string; title: string; status: string } | null;
}

interface ThreadDetail {
  threadId: string;
  messages: EmailThreadType['messages'];
  allocations: Allocation[];
  taskLinks: TaskLink[];
  googleEmail: string;
  /** Date of the most recent forward of this thread's subject found in the
   * user's Sent folder, when no Fwd:/FW: SENT message exists in the current
   * thread (e.g. threading was broken on forward). null when no match. */
  externalForwardedAt?: string | null;
  /** Per-email replied/forwarded status, keyed by stable RFC Message-ID. A
   * message appears here only when one of our SENT messages descends from it
   * in the reply chain — so it's per-email, not per-thread. */
  replied?: { messageId: string; date: string }[];
  forwarded?: { messageId: string; date: string }[];
}

const POLL_INTERVAL_MS = 60_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

/** Gmail query date format (YYYY/M/D) for `after:` clauses. */
function gmailDate(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** Drop rows that repeat an `id` (message id in flat view, thread id in grouped
 *  view — both globally unique per email/conversation). Gmail's paged list can
 *  occasionally return the same item twice when the mailbox changes mid-walk;
 *  without this, duplicate React keys break row selection and starring one row
 *  visibly stars every copy. Keeps the first occurrence (freshest ordering). */
function dedupeById(list: EmailThreadType[]): EmailThreadType[] {
  const seen = new Set<string>();
  const out: EmailThreadType[] = [];
  for (const t of list) {
    if (t.id && seen.has(t.id)) continue;
    if (t.id) seen.add(t.id);
    out.push(t);
  }
  return out;
}

/** Flatten a thread's messages to plain text for the AI summary (HTML stripped,
 *  each message capped so the prompt stays bounded). */
function messagesToText(messages: EmailMessage[]): string {
  return messages.map(m => {
    const who = m.from?.name || m.from?.email || 'Unknown';
    const when = m.date || '';
    const raw = m.body ? m.body.replace(/<[^>]+>/g, ' ') : (m.snippet || '');
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 2000);
    return `From: ${who} (${when})\n${text}`;
  }).join('\n\n---\n\n');
}

export default function EmailTriagePage() {
  const { isModuleActive } = useModules();
  const tasksModuleActive = isModuleActive('tasks');
  const [userName, setUserName] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [googleEmail, setGoogleEmail] = useState('');
  const [activeLabel, setActiveLabel] = useState('INBOX');
  const [showAsThreads, setShowAsThreads] = useState(false);

  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [threads, setThreads] = useState<EmailThreadType[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [taskLinkedOnly, setTaskLinkedOnly] = useState(false);
  const [allocatedOnly, setAllocatedOnly] = useState(false);
  // Filter row: client (server-side refetch), sender + time (client-side).
  const [clientFilter, setClientFilter] = useState<{ id: string; name: string } | null>(null);
  const [senderFilter, setSenderFilter] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<EmailCategory | null>(null);
  // Senders seen this session (email → name) — only grows, so the sender filter
  // dropdown keeps its options even after a server-side sender filter narrows
  // the loaded list to a single sender.
  const [seenSenders, setSeenSenders] = useState<Map<string, string>>(new Map());

  const [activeThread, setActiveThread] = useState<EmailThreadType | null>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [threadMeta, setThreadMeta] = useState<Record<string, { hasAllocation: boolean; hasTaskLink: boolean; isReplied?: boolean; isForwarded?: boolean; reactions?: string[] }>>({});
  // Firm-wide sets of Gmail thread ids that have an allocation / task link.
  // Used to paint the list markers without opening each thread (persists on refresh).
  const [allocThreadIds, setAllocThreadIds] = useState<Set<string>>(new Set());
  const [taskThreadIds, setTaskThreadIds] = useState<Set<string>>(new Set());
  // Stable RFC 2822 Message-IDs (own + reply-chain refs) of every allocated /
  // task-linked conversation in the firm. Gmail thread ids are per-mailbox, so
  // these are what let a row show as allocated / task-linked for a user who
  // didn't create it — matched against the row's own Message-ID / References
  // (chain-wide).
  const [allocMsgKeys, setAllocMsgKeys] = useState<Set<string>>(new Set());
  const [taskMsgKeys, setTaskMsgKeys] = useState<Set<string>>(new Set());

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  // Right-hand context panel (client snapshot + tags). Collapsible.
  const [contextOpen, setContextOpen] = useState(true);

  // AI thread summaries, cached per thread for the session (keyed by gmail
  // thread id). Avoids re-running Claude every time you reopen a thread.
  const [summaries, setSummaries] = useState<Record<string, AiSummary>>({});

  // Saved triage categories — PER USER, PER EMAIL: keyed by the row's id
  // (= the gmail MESSAGE id in the default flat view). An email with no entry
  // is "untriaged" for this user; emails in the same conversation are triaged
  // independently, and every new email starts untriaged. manual > ai.
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, { category: EmailCategory; source: 'ai' | 'user'; updatedAt?: string }>>({});
  function setThreadCategory(messageId: string, category: EmailCategory, threadId?: string) {
    setCategoryOverrides(prev => ({ ...prev, [messageId]: { category, source: 'user', updatedAt: new Date().toISOString() } }));
    fetch('/api/email/triage-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, threadId, category, setBy: 'user' }),
    }).catch(() => {});
  }

  // Draft emails must never enter the triage workflow — not categorised, not
  // allocated, not turned into tasks. They live in the Drafts folder and open
  // straight into compose. Detect by the DRAFT system label (or the Drafts view).
  function isDraftThread(t?: EmailThreadType | null): boolean {
    return !!t && ((t.labelIds?.includes('DRAFT') ?? false) || activeLabel === 'DRAFT');
  }

  // Drag one or more list rows onto a category card → apply it to each. Rows
  // are keyed by message id (flat view) — triage is per email, so the row id
  // IS the override key; the thread id rides along for threaded-view filtering.
  function handleDropCategory(category: EmailCategory, ids: string[]) {
    let skipped = 0;
    for (const id of ids) {
      const t = threads.find(x => x.id === id);
      if (isDraftThread(t)) { skipped++; continue; } // never categorise drafts
      setThreadCategory(id, category, t?.gmailThreadId);
    }
    if (skipped > 0) showToast('error', `Draft${skipped > 1 ? 's' : ''} can't be triaged`);
  }

  // Right-click the Inbox tab → mark every unread inbox email as read.
  // Optimistic locally (rows + tab badge), then Gmail batchModify server-side.
  // The server returns the exact message ids changed, so the 3s undo toast
  // can restore precisely that set (re-add UNREAD) and nothing else.
  async function handleMarkAllUnreadRead() {
    const prevUnreadBadge = labels.find(l => l.id === 'INBOX')?.messagesUnread ?? 0;
    const loadedUnreadIds = threads.filter(t => !t.isRead).map(t => t.id);
    markPendingReadState(loadedUnreadIds, true);
    setThreads(prev => prev.map(t => t.isRead ? t : { ...t, isRead: true }));
    setLabels(prev => prev.map(l => l.id === 'INBOX' ? { ...l, messagesUnread: 0 } : l));
    try {
      const res = await fetch('/api/email/mark-all-read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark' }),
      });
      if (!res.ok) throw new Error('mark-all-read failed');
      const { marked, ids } = await res.json() as { marked: number; ids: string[] };
      if (marked === 0) {
        showToast('success', 'No unread emails in the inbox');
        return;
      }
      const undo = () => {
        const idSet = new Set(ids);
        markPendingReadState(ids, false);
        setThreads(prev => prev.map(t => idSet.has(t.id) ? { ...t, isRead: false } : t));
        setLabels(prev => prev.map(l => l.id === 'INBOX' ? { ...l, messagesUnread: prevUnreadBadge } : l));
        fetch('/api/email/mark-all-read', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'undo', ids }),
        }).then(r => {
          if (!r.ok) showToast('error', 'Could not undo — please refresh');
        }).catch(() => showToast('error', 'Could not undo — please refresh'));
      };
      showToast('success', `${marked} email${marked === 1 ? '' : 's'} marked as read`, undo, 3000);
    } catch {
      showToast('error', 'Could not mark all emails as read');
    }
  }

  // Right-click a category card → move everything in it to "No Action Needed",
  // with a short undo window. Per user, per email: only YOUR triage rows move.
  // The server returns the exact message ids changed, so undo restores
  // precisely that set.
  async function handleMarkAllNoAction(category: EmailCategory) {
    const label = CATEGORY_META[category].label;
    try {
      const res = await fetch('/api/email/triage-categories/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', from: category }),
      });
      if (!res.ok) throw new Error('bulk move failed');
      const { messageIds, restoreTo } = await res.json() as { messageIds: string[]; restoreTo: EmailCategory | 'none' };
      if (messageIds.length === 0) {
        showToast('success', `Nothing to move — ${label} is empty`);
        return;
      }
      setCategoryOverrides(prev => {
        const next = { ...prev };
        for (const id of messageIds) next[id] = { category: 'completed', source: 'user', updatedAt: new Date().toISOString() };
        return next;
      });
      const undo = () => {
        setCategoryOverrides(prev => {
          const next = { ...prev };
          for (const id of messageIds) {
            if (restoreTo === 'none') delete next[id];
            else next[id] = { category: restoreTo, source: 'user', updatedAt: new Date().toISOString() };
          }
          return next;
        });
        fetch('/api/email/triage-categories/bulk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'restore', messageIds, restoreTo }),
        }).then(r => {
          if (!r.ok) showToast('error', 'Could not undo — please refresh');
        }).catch(() => showToast('error', 'Could not undo — please refresh'));
      };
      showToast('success', `${messageIds.length} ${label} email${messageIds.length === 1 ? '' : 's'} moved to No Action Needed`, undo, 3000);
    } catch {
      showToast('error', `Could not mark all ${label} as No Action Needed`);
    }
  }
  // Summarise a thread with AI. Triage is manual-first: opening an email only
  // generates the summary — the AI's suggested category is applied ONLY when
  // Auto Triage passes `applyTo` (the specific EMAIL's message id — triage is
  // per email, while the summary cache stays per thread).
  const summariseThread = useCallback(async (key: string, subject: string, messages: EmailMessage[], clientContext: string, applyTo?: { messageId: string; threadId?: string }): Promise<EmailCategory | null> => {
    const threadText = messagesToText(messages);
    if (!threadText.trim()) return null;
    setSummaries(prev => ({ ...prev, [key]: { state: 'loading' } }));
    try {
      const res = await fetch('/api/email/ai-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, threadText, clientContext }),
      });
      if (!res.ok) throw new Error('summary failed');
      const data = await res.json() as { summary: string; actions: SummaryAction[]; category: EmailCategory | null };
      setSummaries(prev => ({ ...prev, [key]: { state: 'ready', summary: data.summary, actions: data.actions } }));
      // Apply the AI category to the email unless the user manually set one.
      if (applyTo && data.category) {
        const { messageId, threadId } = applyTo;
        setCategoryOverrides(prev => (
          prev[messageId]?.source === 'user' ? prev : { ...prev, [messageId]: { category: data.category!, source: 'ai', updatedAt: new Date().toISOString() } }
        ));
        // Persist (server skips if a manual choice already exists for this email).
        fetch('/api/email/triage-categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, threadId, category: data.category, setBy: 'ai' }),
        }).catch(() => {});
      }
      return data.category;
    } catch {
      setSummaries(prev => ({ ...prev, [key]: { state: 'error' } }));
      return null;
    }
  }, []);

  // ── Triage settings (per user, stored on users.email_triage_settings so the
  // preference follows the user across browsers/machines) ───────────────────
  interface TriageSettings {
    /** Mark an email as read once Auto Triage has categorised it. */
    markReadOnAutoTriage: boolean;
    /** Auto-file untriaged inbox emails older than `autoFileDays` as
     *  "No Action Needed" every time the page loads. No AI involved. */
    autoFileEnabled: boolean;
    autoFileDays: number;
  }
  const [triageSettings, setTriageSettings] = useState<TriageSettings>({ markReadOnAutoTriage: false, autoFileEnabled: false, autoFileDays: 90 });
  useEffect(() => {
    if (!connected) return;
    fetch('/api/email/triage-settings')
      .then(r => r.ok ? r.json() : null)
      .then((d: { settings?: TriageSettings } | null) => {
        if (d?.settings) setTriageSettings(d.settings);
      })
      .catch(() => {});
  }, [connected]);
  function updateTriageSettings(patch: Partial<TriageSettings>) {
    setTriageSettings(prev => {
      const next = { ...prev, ...patch };
      // Optimistic update; persisted to the user's account.
      fetch('/api/email/triage-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).then(r => {
        if (!r.ok) showToast('error', 'Could not save triage settings');
      }).catch(() => showToast('error', 'Could not save triage settings'));
      return next;
    });
  }
  const [triageSettingsOpen, setTriageSettingsOpen] = useState(false);
  // Live mirrors for the long-running Auto Triage loop — the async workers
  // would otherwise close over stale state.
  const triageSettingsRef = useRef(triageSettings);
  triageSettingsRef.current = triageSettings;
  const categoryOverridesRef = useRef(categoryOverrides);
  categoryOverridesRef.current = categoryOverrides;

  // ── Auto Triage ────────────────────────────────────────────────────────────
  // Sweeps untriaged inbox emails and asks the AI to categorise each one —
  // either just the loaded conversations or the whole inbox (page by page).
  // Runs a small worker pool so a big pile doesn't hit the API all at once.
  // Read/unread state is only touched when the "mark read" setting is on.
  const [autoTriage, setAutoTriage] = useState<{ done: number; total: number } | null>(null);
  const [autoTriageMenuOpen, setAutoTriageMenuOpen] = useState(false);
  const autoTriageCancelRef = useRef(false);

  function isAutoTriageCandidate(t: EmailThreadType): boolean {
    if (isDraftThread(t)) return false;
    // Per-email triage: rows are keyed by the list row's id (message id).
    const ov = categoryOverridesRef.current[t.id];
    return !ov || ov.category === 'untriaged';
  }

  /** Triage one batch of threads through a 3-wide worker pool. Returns how many were processed. */
  async function processAutoTriageBatch(candidates: EmailThreadType[]): Promise<number> {
    let processed = 0;
    const queue = [...candidates];
    const workers = Array.from({ length: 3 }, async () => {
      for (;;) {
        if (autoTriageCancelRef.current) return;
        const t = queue.shift();
        if (!t) return;
        try {
          const detailId = t.gmailThreadId ?? t.id;
          const detailUrl = t.gmailThreadId
            ? `/api/email/thread/${detailId}?messageId=${encodeURIComponent(t.id)}`
            : `/api/email/thread/${detailId}`;
          const res = await fetch(detailUrl);
          if (!res.ok) throw new Error('detail fetch failed');
          const data = await res.json() as ThreadDetail;
          // Summary caches per thread; the category applies to THIS email.
          const category = await summariseThread(detailId, t.subject, data.messages, data.allocations?.[0]?.clients?.name ?? '', { messageId: t.id, threadId: t.gmailThreadId });
          // Optionally mark the email read now that it's been triaged.
          if (category && triageSettingsRef.current.markReadOnAutoTriage && !t.isRead) {
            markPendingReadState([t.id], true);
            setThreads(prev => prev.map(x => x.id === t.id ? { ...x, isRead: true } : x));
            fetch('/api/email/modify', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ threadId: t.id, removeLabelIds: ['UNREAD'] }),
            }).catch(() => {});
          }
        } catch { /* skip this thread — it stays untriaged */ }
        processed++;
        setAutoTriage(prev => prev ? { done: prev.done + 1, total: Math.max(prev.total, prev.done + 1) } : prev);
      }
    });
    await Promise.all(workers);
    return processed;
  }

  async function runAutoTriage(scope: 'loaded' | 'inbox') {
    setAutoTriageMenuOpen(false);
    autoTriageCancelRef.current = false;
    let processed = 0;

    if (scope === 'loaded') {
      const candidates = threads.filter(isAutoTriageCandidate);
      if (candidates.length === 0) {
        showToast('success', 'Nothing to triage — every loaded email already has a category');
        return;
      }
      setAutoTriage({ done: 0, total: candidates.length });
      processed = await processAutoTriageBatch(candidates);
    } else {
      // Whole inbox: walk Gmail page by page, triaging each page's untriaged
      // threads before fetching the next. Total is the inbox-wide untriaged
      // estimate (it self-corrects upward if the sweep finds more).
      setAutoTriage({ done: 0, total: Math.max(1, categoryCounts.untriaged) });
      const seen = new Set<string>();
      let pageToken: string | undefined;
      // 40 pages × 50 = up to 2,000 emails per run — a backstop against
      // runaway API spend; re-run to continue (already-triaged are skipped).
      for (let page = 0; page < 40 && !autoTriageCancelRef.current; page++) {
        try {
          const url = `/api/email/threads?label=INBOX${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
          const res = await fetch(url);
          if (!res.ok) break;
          const data = await res.json() as { threads: EmailThreadType[]; nextPageToken?: string | null };
          const fresh = (data.threads ?? []).filter(t => {
            const key = t.gmailThreadId ?? t.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return isAutoTriageCandidate(t);
          });
          processed += await processAutoTriageBatch(fresh);
          pageToken = data.nextPageToken ?? undefined;
          if (!pageToken) break;
        } catch { break; }
      }
    }

    const stopped = autoTriageCancelRef.current;
    setAutoTriage(null);
    showToast('success', stopped
      ? `Auto Triage stopped — ${processed} email${processed === 1 ? '' : 's'} processed`
      : `Auto Triage complete — ${processed} email${processed === 1 ? '' : 's'} processed`);
  }

  // Track which individual EMAILS have been forwarded / replied to, keyed by
  // stable RFC Message-ID (not Gmail thread id — that flagged whole merged
  // threads and newer messages as replied when they hadn't been). Persisted
  // locally as [rfcMessageId, isoDate][] so chips survive refresh; re-populated
  // from the server (per-message reply-chain analysis) whenever a thread opens.
  // New localStorage keys ('-msgids') — the old thread-keyed caches are ignored.
  const parseMsgIdMap = (key: string): Map<string, string> => {
    if (typeof window === 'undefined') return new Map();
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return new Map();
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) return new Map();
      return new Map(
        parsed
          .map(entry => (Array.isArray(entry) ? [entry[0] as string, (entry[1] as string) ?? ''] as const : ['', ''] as const))
          .filter(([id]) => id),
      );
    } catch { return new Map(); }
  };
  const [forwardedMsgIds, setForwardedMsgIds] = useState<Map<string, string>>(() => parseMsgIdMap('email-forwarded-msgids'));
  const [repliedMsgIds, setRepliedMsgIds] = useState<Map<string, string>>(() => parseMsgIdMap('email-replied-msgids'));

  // Email rules
  const [emailRules, setEmailRules] = useState<EmailRule[]>([]);
  const [rulesOpen, setRulesOpen]   = useState(false);

  const [signature, setSignature] = useState<string | null>(null);
  const [signatureDisplayName, setSignatureDisplayName] = useState('');

  // Compose window now lives at AppShell level so the modal survives navigation.
  // EmailTriagePage just opens it via context.
  const composeWindow = useComposeWindow();
  const [draftingAIReply, setDraftingAIReply] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [bulkAllocateThreads, setBulkAllocateThreads] = useState<EmailThreadType[] | null>(null);
  const [pendingRemoveAllocation, setPendingRemoveAllocation] = useState<{ clientId: string; clientName: string } | null>(null);
  const [removingAllocation, setRemovingAllocation] = useState(false);

  // Task creation from email
  const [creatingTask, setCreatingTask]         = useState(false);
  const [showQuickTask, setShowQuickTask]       = useState(false);
  const [taskSuggestedTitle, setTaskSuggestedTitle]   = useState('');
  const [taskSuggestedSteps, setTaskSuggestedSteps]   = useState<string[]>([]);
  const [taskSuggestedDueDate, setTaskSuggestedDueDate] = useState('');
  const [taskSuggestedClientId, setTaskSuggestedClientId]     = useState('');
  const [taskSuggestedClientName, setTaskSuggestedClientName] = useState('');
  const [teamMembers, setTeamMembers] = useState<{ id: string; full_name: string | null; email: string }[]>([]);
  const [teamMembersLoaded, setTeamMembersLoaded] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Threads we've just trashed but Gmail's INBOX query may still return for a short
  // window. Filter these out of incoming poll/refresh results so deleted emails
  // don't ghost back into the list.
  const pendingTrashIdsRef = useRef<Set<string>>(new Set());
  function markPendingTrash(ids: string[]) {
    ids.forEach(id => pendingTrashIdsRef.current.add(id));
    // Clear after Gmail has had time to propagate the trash action.
    window.setTimeout(() => {
      ids.forEach(id => pendingTrashIdsRef.current.delete(id));
    }, 60_000);
  }
  // Undo helper: stop hiding these ids so an undone move/trash can reappear on
  // the next fetch instead of waiting out the 60s propagation window.
  function unmarkPendingTrash(ids: string[]) {
    ids.forEach(id => pendingTrashIdsRef.current.delete(id));
  }

  // Same propagation issue as trash — when we mark-as-read locally, Gmail's
  // index lags for a few seconds. Without this override, the next poll sees
  // the thread still UNREAD and the optimistic update flips back. Map keys
  // are thread.id (= what poll responses return), values are the desired
  // isRead state we want to enforce for the next 60s.
  const pendingReadStateRef = useRef<Map<string, boolean>>(new Map());
  function markPendingReadState(ids: string[], isRead: boolean) {
    ids.forEach(id => pendingReadStateRef.current.set(id, isRead));
    window.setTimeout(() => {
      ids.forEach(id => pendingReadStateRef.current.delete(id));
    }, 60_000);
  }

  // Resizable column widths (persisted to localStorage)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 192;
    return parseInt(localStorage.getItem('email-sidebar-width') ?? '192', 10);
  });
  const [threadListWidth, setThreadListWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 288;
    return parseInt(localStorage.getItem('email-threadlist-width') ?? '288', 10);
  });
  const colDragRef = useRef<{ col: 'sidebar' | 'threadlist'; startX: number; startWidth: number } | null>(null);

  // Transient banner used to surface non-blocking results (e.g. forward-email
  // failure). Optionally carries an Undo action (e.g. after labelling).
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string; undo?: () => void; undoMs?: number } | null>(null);
  function showToast(kind: 'success' | 'error', message: string, undo?: () => void, durationMs?: number) {
    const ms = durationMs ?? (undo ? 7000 : 5000);
    // undoMs drives the countdown donut on the Undo button — it must match
    // the auto-dismiss timer exactly so the ring empties as the window closes.
    setToast({ kind, message, undo, undoMs: undo ? ms : undefined });
    window.setTimeout(() => setToast(null), ms);
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const d = colDragRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      if (d.col === 'sidebar') {
        const w = Math.max(140, Math.min(360, d.startWidth + delta));
        setSidebarWidth(w);
        localStorage.setItem('email-sidebar-width', String(w));
      } else {
        const w = Math.max(180, Math.min(500, d.startWidth + delta));
        setThreadListWidth(w);
        localStorage.setItem('email-threadlist-width', String(w));
      }
    }
    function onMouseUp() {
      if (!colDragRef.current) return;
      colDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  function startColDrag(col: 'sidebar' | 'threadlist', e: React.MouseEvent) {
    e.preventDefault();
    colDragRef.current = {
      col,
      startX: e.clientX,
      startWidth: col === 'sidebar' ? sidebarWidth : threadListWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  // Load current user's name for compose display
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setCurrentUserId(user.id);
      supabase.from('users').select('full_name').eq('id', user.id).single()
        .then(({ data }) => { if (data?.full_name) setUserName(data.full_name); });
    });
  }, []);

  // Load connection status
  useEffect(() => {
    fetch('/api/email/status')
      .then(r => r.json())
      .then((data: { connected: boolean; googleEmail: string; showAsThreads: boolean }) => {
        setConnected(data.connected);
        setGoogleEmail(data.googleEmail ?? '');
        setShowAsThreads(data.showAsThreads ?? false);
      })
      .catch(() => setConnected(false));
  }, []);

  // Load labels — and keep their counts fresh on a poll. Each refresh also
  // re-fires the badge broadcast below, acting as the heartbeat that keeps
  // the sidebar's own poll suppressed while this page is open. The same poll
  // pulls the EXACT inbox-wide untriaged count from /api/email/unread (which
  // enumerates inbox threads against saved categories — see that route): we
  // snapshot the categorised total alongside it so local triage actions can
  // adjust the displayed number instantly between polls.
  useEffect(() => {
    if (!connected) return;
    function loadLabels() {
      fetch('/api/email/labels')
        .then(r => r.json())
        .then((data: { labels: GmailLabel[] }) => setLabels(data.labels ?? []))
        .catch(() => {});
      fetch('/api/email/unread')
        .then(r => r.ok ? r.json() : null)
        .then((d: { untriaged?: number } | null) => {
          if (typeof d?.untriaged !== 'number') return;
          const categorisedNow = Object.values(categoryOverridesRef.current).filter(v => v.category !== 'untriaged').length;
          setUntriagedServer({ base: d.untriaged, categorisedAtBase: categorisedNow });
        })
        .catch(() => {});
    }
    loadLabels();
    const id = setInterval(() => { if (!document.hidden) loadLabels(); }, 60_000);
    return () => clearInterval(id);
  }, [connected]);
  // Exact untriaged baseline from the server + the categorised count at that
  // moment — categoryCounts derives the live number from how far the local
  // overrides map has moved since the snapshot.
  const [untriagedServer, setUntriagedServer] = useState<{ base: number; categorisedAtBase: number } | null>(null);

  // Load email rules
  useEffect(() => {
    if (!connected) return;
    fetch('/api/email/rules')
      .then(r => r.ok ? r.json() : { rules: [] })
      .then((d: { rules: EmailRule[] }) => setEmailRules(d.rules ?? []))
      .catch(() => {});
  }, [connected]);

  // Load pinned thread IDs
  useEffect(() => {
    if (!connected) return;
    fetch('/api/email/pin')
      .then(r => r.json())
      .then((data: { pinnedIds: string[] }) => setPinnedIds(new Set(data.pinnedIds ?? [])))
      .catch(() => {});
  }, [connected]);

  // Bulk-load allocation/task-link state for the firm so the green & blue edge
  // bars appear on every relevant inbox row without needing the user to click
  // through each thread first. Reusable so we can refresh after a send (which
  // can create a new allocation) without waiting for the next mount.
  const refreshThreadMeta = useCallback(() => {
    fetch('/api/email/thread-meta')
      .then(r => r.ok ? r.json() : null)
      .then((data: { allocatedThreadIds?: string[]; taskLinkedThreadIds?: string[]; allocatedMessageKeys?: string[]; taskLinkedMessageKeys?: string[] } | null) => {
        if (!data) return;
        // Union with the current sets rather than replacing — so markers we've
        // already learned (from opening a thread this session) survive even if
        // the server hasn't caught up, and removals still reflect on next load.
        setAllocThreadIds(prev => new Set([...prev, ...(data.allocatedThreadIds ?? [])]));
        setTaskThreadIds(prev => new Set([...prev, ...(data.taskLinkedThreadIds ?? [])]));
        setAllocMsgKeys(prev => new Set([...prev, ...(data.allocatedMessageKeys ?? [])]));
        setTaskMsgKeys(prev => new Set([...prev, ...(data.taskLinkedMessageKeys ?? [])]));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!connected) return;
    refreshThreadMeta();
  }, [connected, refreshThreadMeta]);

  // Load the firm's persisted triage categories so they survive reloads and are
  // shared team-wide (keyed by gmail thread id, matching `categoryOf`).
  useEffect(() => {
    if (!connected) return;
    fetch('/api/email/triage-categories')
      .then(r => r.ok ? r.json() : null)
      .then((data: { categories?: Record<string, { category: string; setBy: string; updatedAt?: string }> } | null) => {
        if (!data?.categories) return;
        const map: Record<string, { category: EmailCategory; source: 'ai' | 'user'; updatedAt?: string }> = {};
        for (const [tid, v] of Object.entries(data.categories)) {
          map[tid] = { category: v.category as EmailCategory, source: v.setBy === 'user' ? 'user' : 'ai', updatedAt: v.updatedAt };
        }
        setCategoryOverrides(prev => ({ ...map, ...prev }));
      })
      .catch(() => {});
  }, [connected]);

  // (No "re-triage on new mail" machinery needed: triage is per EMAIL, so a
  // newly arrived message has no row for anyone and is untriaged by
  // construction — earlier emails in its conversation keep their categories.)

  // Age-based auto-file: when enabled in triage settings, every page load
  // quietly files untriaged inbox emails older than the cutoff as "No Action
  // Needed" (no AI — a bulk DB write server-side), then re-pulls the saved
  // categories so the card counts update. Runs once per mount.
  const autoFileRanRef = useRef(false);
  useEffect(() => {
    if (!connected || autoFileRanRef.current) return;
    if (!triageSettings.autoFileEnabled) return;
    autoFileRanRef.current = true;
    fetch('/api/email/triage-autofile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThanDays: triageSettings.autoFileDays }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(async (d: { filed?: number } | null) => {
        if (!d?.filed) return;
        showToast('success', `${d.filed} email${d.filed === 1 ? '' : 's'} older than ${triageSettings.autoFileDays} days filed as No Action Needed`);
        const res = await fetch('/api/email/triage-categories');
        if (!res.ok) return;
        const data = await res.json() as { categories?: Record<string, { category: string; setBy: string; updatedAt?: string }> };
        if (!data.categories) return;
        const map: Record<string, { category: EmailCategory; source: 'ai' | 'user'; updatedAt?: string }> = {};
        for (const [tid, v] of Object.entries(data.categories)) {
          map[tid] = { category: v.category as EmailCategory, source: v.setBy === 'user' ? 'user' : 'ai', updatedAt: v.updatedAt };
        }
        setCategoryOverrides(prev => ({ ...map, ...prev }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, triageSettings.autoFileEnabled, triageSettings.autoFileDays]);

  // Paint the allocation / task-link markers onto the loaded list rows. Rows key
  // by message id (flat view) but allocations/task-links are keyed by Gmail
  // thread id — so match on gmailThreadId. This makes the green/blue markers
  // persist on refresh without having to open each thread first.
  //
  // Gmail thread ids are per-mailbox, so `allocThreadIds` only matches for the
  // user who made the allocation. For everyone else we match on the stable RFC
  // Message-IDs: a row is allocated if its own Message-ID — or any message it
  // replies to (References) — belongs to an allocated conversation. That lights
  // the marker chain-wide across all users' mailboxes.
  useEffect(() => {
    if (threads.length === 0) return;
    setThreadMeta(prev => {
      const next = { ...prev };
      for (const t of threads) {
        const tid = t.gmailThreadId ?? t.id;
        // Chain-wide match: does any message in this row belong to an allocated
        // / task-linked conversation (by RFC Message-ID or reply-chain ref)?
        let allocByChain = false;
        let taskByChain = false;
        if (allocMsgKeys.size > 0 || taskMsgKeys.size > 0) {
          for (const m of t.messages ?? []) {
            const keys = [m.messageId, ...(m.references ?? [])].filter(Boolean);
            if (!allocByChain && keys.some(k => allocMsgKeys.has(k))) allocByChain = true;
            if (!taskByChain && keys.some(k => taskMsgKeys.has(k))) taskByChain = true;
            if (allocByChain && taskByChain) break;
          }
        }
        next[t.id] = {
          ...(next[t.id] ?? {}),
          hasAllocation: allocThreadIds.has(tid) || allocByChain,
          hasTaskLink: taskThreadIds.has(tid) || taskByChain,
        };
      }
      return next;
    });
  }, [threads, allocThreadIds, taskThreadIds, allocMsgKeys, taskMsgKeys]);

  // Load signature
  useEffect(() => {
    if (!connected) return;
    fetch('/api/email/signature')
      .then(r => r.json())
      .then((data: { signature: string | null; displayName: string | null }) => {
        setSignature(data.signature ?? null);
        setSignatureDisplayName(data.displayName ?? userName);
        // Push the latest identity into the global compose context too,
        // so a compose opened from anywhere uses the up-to-date signature.
        composeWindow.setIdentity({
          signature: data.signature ?? null,
          displayName: data.displayName ?? userName,
        });
      })
      .catch(() => {});
  // composeWindow.setIdentity is stable from useCallback in the provider
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, userName]);

  // Mirror googleEmail into the compose context once we know it
  useEffect(() => {
    if (googleEmail) composeWindow.setIdentity({ googleEmail });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleEmail]);

  // Listen for sends originating from anywhere in the app — refresh threads
  // and apply the appropriate replied/forwarded mark to the active thread.
  useEffect(() => {
    function onSent(e: Event) {
      const detail = (e as CustomEvent<{ threadId: string; originalThreadId: string | null; kind: 'fresh' | 'reply' | 'forward' }>).detail;
      fetchThreads(activeLabel);
      // A send may have allocated the thread to a client — refresh the firm-wide
      // alloc/task sets so the green line/icon appears on the list row too.
      refreshThreadMeta();
      if (detail.kind === 'reply' && detail.originalThreadId) {
        handleReplySent(detail.originalThreadId);
      } else if (detail.kind === 'forward' && detail.originalThreadId) {
        handleForwardSent(detail.originalThreadId);
      }
    }
    window.addEventListener(EMAIL_SENT_EVENT, onSent);
    return () => window.removeEventListener(EMAIL_SENT_EVENT, onSent);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLabel]);

  // A draft was discarded from the compose window — refresh so it drops out of
  // the Drafts list (and the Drafts count) without waiting for the next poll.
  useEffect(() => {
    function onDiscarded() {
      // Drop the Drafts tab count by one right away, then refresh the list.
      adjustLabelCount('DRAFT', 'messagesTotal', -1);
      fetchThreads(activeLabel);
    }
    // A brand-new draft just entered the Drafts folder — bump the tab count and
    // refresh the list if the user is sitting in Drafts.
    function onCreated() {
      adjustLabelCount('DRAFT', 'messagesTotal', 1);
      if (activeLabel === 'DRAFT') fetchThreads(activeLabel);
    }
    window.addEventListener(EMAIL_DRAFT_DISCARDED_EVENT, onDiscarded);
    window.addEventListener(EMAIL_DRAFT_CREATED_EVENT, onCreated);
    return () => {
      window.removeEventListener(EMAIL_DRAFT_DISCARDED_EVENT, onDiscarded);
      window.removeEventListener(EMAIL_DRAFT_CREATED_EVENT, onCreated);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLabel]);

  // When a "Create Task" send fires, the global mount stashes the payload
  // in sessionStorage and dispatches an event. If the email page is mounted,
  // pick it up and open the QuickTaskModal flow.
  useEffect(() => {
    function onCreateTask(e: Event) {
      const data = (e as CustomEvent<{ subject: string; plainBody: string; toEmail: string; toName: string }>).detail;
      handleCreateTaskFromSent(data);
    }
    window.addEventListener('smith:email-create-task', onCreateTask);
    return () => window.removeEventListener('smith:email-create-task', onCreateTask);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function matchesRule(thread: EmailThreadType, rule: EmailRule): boolean {
    if (!rule.is_active) return false;
    const val = rule.condition_value.toLowerCase();
    let target = '';
    switch (rule.condition_field) {
      case 'from':      target = (thread.from?.email ?? '' + ' ' + (thread.from?.name ?? '')).toLowerCase(); break;
      case 'to':        target = ''; break; // threads don't expose To at list level
      case 'subject':   target = (thread.subject ?? '').toLowerCase(); break;
      case 'has_words':  target = (thread.snippet ?? '').toLowerCase(); break;
    }
    switch (rule.condition_operator) {
      case 'contains':    return target.includes(val);
      case 'equals':      return target === val;
      case 'starts_with': return target.startsWith(val);
      case 'ends_with':   return target.endsWith(val);
    }
    return false;
  }

  function applyRulesToThreads(unreadThreads: EmailThreadType[]) {
    const activeRules = emailRules.filter(r => r.is_active);
    if (!activeRules.length || !unreadThreads.length) return;
    for (const thread of unreadThreads) {
      for (const rule of activeRules) {
        if (!matchesRule(thread, rule)) continue;
        switch (rule.action_type) {
          case 'archive':
            fetch('/api/email/modify', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ threadId: thread.id, removeLabelIds: ['INBOX'] }),
            }).then(() => setThreads(prev => prev.filter(t => t.id !== thread.id))).catch(() => {});
            break;
          case 'label':
            if (rule.action_label_id) {
              fetch('/api/email/modify', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ threadId: thread.id, addLabelIds: [rule.action_label_id] }),
              }).catch(() => {});
            }
            break;
          case 'mark_read':
            fetch('/api/email/modify', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ threadId: thread.id, removeLabelIds: ['UNREAD'] }),
            }).then(() => setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, isRead: true } : t))).catch(() => {});
            break;
          case 'star':
            fetch('/api/email/modify', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ threadId: thread.id, addLabelIds: ['STARRED'] }),
            }).then(() => setThreads(prev => prev.map(t => t.id === thread.id
              ? { ...t, labelIds: [...t.labelIds.filter(l => l !== 'STARRED'), 'STARRED'] }
              : t))).catch(() => {});
            break;
          case 'trash':
            markPendingTrash([thread.id]);
            fetch('/api/email/trash', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ threadId: thread.id }),
            }).then(() => setThreads(prev => prev.filter(t => t.id !== thread.id))).catch(() => {});
            break;
        }
        break; // only apply first matching rule per thread
      }
    }
  }

  const fetchThreads = useCallback(async (label: string, pageToken?: string) => {
    if (pageToken) setLoadingMore(true);
    else setLoadingThreads(true);
    try {
      // Build the Gmail query: combine free-text search and/or unread filter.
      // When using a query we must also preserve the label scope, otherwise Gmail
      // searches everywhere (including archived mail).
      const hasDbFilter = taskLinkedOnly || allocatedOnly || !!clientFilter || (!!categoryFilter && categoryFilter !== 'untriaged');

      const hasTextSearch = !!searchQuery.trim();
      let q = searchQuery;
      let needsScope = false;
      if (unreadOnly) { q = q ? `${q} is:unread` : 'is:unread'; needsScope = true; }
      // Sender + time. On the Gmail (non-DB) path they go into the query so they
      // apply across the WHOLE mailbox; on the DB-filter path they're passed as
      // params for the server to post-filter the matched set.
      if (!hasDbFilter) {
        if (senderFilter) { q = q ? `${q} from:${senderFilter}` : `from:${senderFilter}`; needsScope = true; }
        if (timeFilter !== 'all') {
          const tq = timeFilter === 'today' ? `after:${gmailDate(new Date())}` : `newer_than:${timeFilter === '7d' ? '7d' : '30d'}`;
          q = q ? `${q} ${tq}` : tq; needsScope = true;
        }
      }
      if (hasTextSearch) {
        // A typed search spans the WHOLE mailbox — Inbox, Sent, Spam, Trash and
        // every label. `in:anywhere` overrides Gmail's default of excluding
        // Spam/Trash from search, and we deliberately DON'T scope to the active
        // folder so results come from everywhere.
        q = `${q} in:anywhere`;
      } else if (needsScope) {
        // Folder filters (unread/sender/time) with no typed search stay scoped to
        // the active folder (otherwise Gmail would search everywhere).
        const labelScope: Record<string, string> = {
          INBOX: 'in:inbox', SENT: 'in:sent', STARRED: 'is:starred',
          SPAM: 'in:spam', TRASH: 'in:trash', DRAFT: 'in:drafts',
        };
        const scope = labelScope[label] ?? `label:${label.toLowerCase().replace(/\s+/g, '-')}`;
        q = `${q} ${scope}`;
      }
      // Task-linked / allocated / client / category filters bypass Gmail and pull
      // from our DB tables (inbox-wide); sender/time post-filter that set server-side.
      const dbFilterParams: string[] = [];
      if (taskLinkedOnly) dbFilterParams.push('taskLinkedOnly=true');
      if (allocatedOnly) dbFilterParams.push('allocatedOnly=true');
      if (clientFilter) dbFilterParams.push(`clientId=${encodeURIComponent(clientFilter.id)}`);
      if (categoryFilter && categoryFilter !== 'untriaged') dbFilterParams.push(`category=${categoryFilter}`);
      if (hasDbFilter) {
        if (senderFilter) dbFilterParams.push(`sender=${encodeURIComponent(senderFilter)}`);
        if (timeFilter !== 'all') dbFilterParams.push(`time=${timeFilter}`);
      }
      const base = dbFilterParams.length > 0
        ? `/api/email/threads?${dbFilterParams.join('&')}`
        : q
          ? `/api/email/threads?q=${encodeURIComponent(q)}`
          : `/api/email/threads?label=${encodeURIComponent(label)}`;
      // "Untriaged" = no saved category (read or unread). It rides the normal
      // Gmail list path with a server-side exclusion of categorised threads —
      // the server walks extra pages so a full page of real results comes back.
      const untriagedParam = categoryFilter === 'untriaged' ? '&category=untriaged' : '';
      const url = `${base}${untriagedParam}${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const res = await fetch(url);
      const data = await res.json() as { threads?: EmailThreadType[]; nextPageToken?: string | null; error?: string };
      if (!res.ok) {
        // 429 = Gmail rate limit — back off quietly; the next poll retries.
        // Don't surface it as an error banner to the user.
        if (res.status !== 429 && !pageToken) setFetchError(data.error ?? `Error ${res.status}`);
        return;
      }
      setFetchError(null);
      // Filter out threads that have been optimistically trashed but Gmail
      // hasn't reflected the change yet — otherwise they reappear briefly.
      const pendingTrash = pendingTrashIdsRef.current;
      const pendingRead = pendingReadStateRef.current;
      const newThreads = (data.threads ?? [])
        .filter(t => !pendingTrash.has(t.id))
        .map(t => {
          // Override read state if we have a recent local action — protects
          // mark-read / mark-unread from being undone by stale poll responses.
          const desired = pendingRead.get(t.id);
          if (desired === undefined) return t;
          return {
            ...t,
            isRead: desired,
            labelIds: desired
              ? t.labelIds.filter(l => l !== 'UNREAD')
              : Array.from(new Set([...t.labelIds, 'UNREAD'])),
          };
        });
      if (pageToken) {
        setThreads(prev => dedupeById([...prev, ...newThreads]));
      } else {
        setThreads(dedupeById(newThreads));
      }
      setNextPageToken(data.nextPageToken ?? null);

      // Apply active rules to unread threads (fire-and-forget)
      if (label === 'INBOX' && !pageToken) {
        applyRulesToThreads(newThreads.filter(t => !t.isRead));
      }
    } catch (err) {
      if (!pageToken) setFetchError('Could not reach the server. Please try again.');
    } finally {
      setLoadingThreads(false);
      setLoadingMore(false);
    }
  }, [searchQuery, unreadOnly, taskLinkedOnly, allocatedOnly, clientFilter, categoryFilter, senderFilter, timeFilter]);

  // Fetch threads when label, search, or any active filter changes
  useEffect(() => {
    if (!connected) return;
    setActiveThread(null);
    setThreadDetail(null);
    setFetchError(null);
    fetchThreads(activeLabel);
  }, [connected, activeLabel, searchQuery, unreadOnly, taskLinkedOnly, allocatedOnly, clientFilter, categoryFilter, senderFilter, timeFilter, fetchThreads]);

  // Start polling (skip during active search to avoid disrupting results)
  useEffect(() => {
    if (!connected || searchQuery) return;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    // Only poll Gmail for the visible tab — background tabs shouldn't keep
    // burning the user's Gmail API quota (a key cause of rate-limit 5xx).
    pollTimerRef.current = setInterval(() => {
      if (document.hidden) return;
      fetchThreads(activeLabel);
    }, POLL_INTERVAL_MS);
    // Refresh immediately when the user returns to the tab.
    const onVisible = () => { if (!document.hidden) fetchThreads(activeLabel); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connected, activeLabel, searchQuery, fetchThreads]);

  // Load thread detail
  async function openThread(thread: EmailThreadType) {
    // Drafts get a different treatment: instead of opening the read-only
    // thread view, we hand the saved draft contents to the compose window so
    // the user can edit and send. Detected either by being inside the Drafts
    // label or by the thread itself carrying the DRAFT system label.
    const isDraft = activeLabel === 'DRAFT' || thread.labelIds?.includes('DRAFT');
    if (isDraft) {
      const detailId = thread.gmailThreadId ?? thread.id;
      try {
        const dres = await fetch(`/api/email/draft?threadId=${encodeURIComponent(detailId)}`);
        const dj   = await dres.json() as {
          draft: null | {
            draftId:  string;
            subject:  string;
            to:       Array<{ name: string; email: string }>;
            cc:       Array<{ name: string; email: string }>;
            bcc:      Array<{ name: string; email: string }>;
            htmlBody: string;
            attachments: Array<{ messageId: string; attachmentId: string; filename: string; mimeType: string; size: number }>;
          };
        };
        const draft = dj.draft;
        if (draft) {
          // Pull the attachments down as File objects so they ride along
          // when the user re-saves or sends from compose. Best-effort —
          // a missing attachment is non-fatal, the user can re-add it.
          const files = await Promise.all(
            draft.attachments.map(async att => {
              try {
                const url = `/api/email/attachment?messageId=${encodeURIComponent(att.messageId)}&attachmentId=${encodeURIComponent(att.attachmentId)}&filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}`;
                const ar  = await fetch(url);
                const blob = await ar.blob();
                return new File([blob], att.filename, { type: att.mimeType || 'application/octet-stream' });
              } catch {
                return null;
              }
            })
          );
          composeWindow.open({
            defaultDraftId:   draft.draftId,
            defaultTo:        draft.to,
            defaultBcc:       draft.bcc,
            defaultSubject:   draft.subject,
            defaultHtmlBody:  draft.htmlBody,
            defaultAttachments: files.filter((f): f is File => f !== null),
          });
          return;
        }
        // Draft lookup failed (no matching draft on the thread, transient
        // error, etc.) — fall through to the normal read-only view so the
        // user still sees *something*.
      } catch { /* fall through */ }
    }

    setActiveThread(thread);
    setThreadDetail(null);
    setLoadingDetail(true);
    try {
      // In non-threaded view, gmailThreadId holds the real thread ID and
      // thread.id is the specific message ID — pass it so the server scopes
      // allocations to that message's sub-conversation (Gmail can merge
      // unrelated same-subject emails into one thread).
      const detailId = thread.gmailThreadId ?? thread.id;
      const detailUrl = thread.gmailThreadId
        ? `/api/email/thread/${detailId}?messageId=${encodeURIComponent(thread.id)}`
        : `/api/email/thread/${detailId}`;
      const res = await fetch(detailUrl);
      const data = await res.json() as ThreadDetail;
      setThreadDetail(data);

      // Kick off (or reuse) the AI summary for this thread.
      const summaryKey = thread.gmailThreadId ?? thread.id;
      const cachedSummary = summaries[summaryKey];
      if (!cachedSummary || cachedSummary.state === 'error') {
        void summariseThread(summaryKey, thread.subject, data.messages, data.allocations?.[0]?.clients?.name ?? '');
      }

      // Replied / forwarded come from the server's per-email reply-chain
      // analysis (data.replied / data.forwarded, keyed by stable RFC Message-ID).
      // The viewed row is replied/forwarded when ITS message is in those sets —
      // in flat view that's the single viewed message (thread.id); in grouped
      // view any message in the conversation counts. This is per-email, so it no
      // longer fires on a different correspondent's merged email or on a newer
      // message that arrived after the reply.
      const repliedSet = new Set((data.replied ?? []).map(r => r.messageId).filter(Boolean));
      const forwardedSet = new Set((data.forwarded ?? []).map(f => f.messageId).filter(Boolean));
      const viewedMsg = data.messages.find(m => m.id === thread.id);
      const viewedRfcIds = viewedMsg
        ? (viewedMsg.messageId ? [viewedMsg.messageId] : [])
        : data.messages.map(m => m.messageId).filter(Boolean);
      const isReplied = viewedRfcIds.some(id => repliedSet.has(id));
      const isForwarded = viewedRfcIds.some(id => forwardedSet.has(id));
      setThreadMeta(prev => ({
        ...prev,
        [thread.id]: {
          hasAllocation: data.allocations.length > 0,
          hasTaskLink: data.taskLinks.length > 0,
          isReplied,
          isForwarded,
        },
      }));
      // Reconcile the firm-wide alloc/task sets with what this thread actually
      // has, so the bulk reconcile effect (which paints markers from these sets)
      // can't clobber the green line/icon back off on the next list refetch.
      // This covers allocations created by *sending* a reply too — that path
      // never touches these sets, and thread-meta only loaded once at connect.
      {
        const tid = thread.gmailThreadId ?? thread.id;
        const allocated = data.allocations.length > 0;
        const taskLinked = data.taskLinks.length > 0;
        setAllocThreadIds(prev => {
          if (allocated === prev.has(tid)) return prev;
          const next = new Set(prev);
          if (allocated) next.add(tid); else next.delete(tid);
          return next;
        });
        setTaskThreadIds(prev => {
          if (taskLinked === prev.has(tid)) return prev;
          const next = new Set(prev);
          if (taskLinked) next.add(tid); else next.delete(tid);
          return next;
        });
      }
      // Persist per-email replied/forwarded (keyed by RFC Message-ID) so chips
      // survive refresh without re-opening. Merge the whole thread's sets — not
      // just the viewed message — so sibling rows in the same conversation paint
      // correctly too.
      if ((data.replied ?? []).length > 0) {
        setRepliedMsgIds(prev => {
          const next = new Map(prev);
          for (const r of data.replied ?? []) if (r.messageId) next.set(r.messageId, r.date || '');
          try { localStorage.setItem('email-replied-msgids', JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
        });
      }
      if ((data.forwarded ?? []).length > 0) {
        setForwardedMsgIds(prev => {
          const next = new Map(prev);
          for (const f of data.forwarded ?? []) if (f.messageId) next.set(f.messageId, f.date || '');
          try { localStorage.setItem('email-forwarded-msgids', JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
        });
      }
      // Deferred out-of-thread forward check: when the viewed message isn't
      // already known-forwarded, ask the server to search the Sent folder for a
      // forward of this subject (Gmail often breaks threading on forward). Runs
      // *after* render so its Gmail round-trips never delay the open. Attributed
      // to the viewed message's RFC id.
      const viewedRfc = viewedMsg?.messageId || '';
      if (viewedRfc && !forwardedSet.has(viewedRfc) && !forwardedMsgIds.has(viewedRfc)) {
        fetch(`/api/email/thread/${detailId}/forwarded?subject=${encodeURIComponent(thread.subject || '')}`)
          .then(r => (r.ok ? r.json() : null))
          .then((d: { externalForwardedAt?: string | null } | null) => {
            const date = d?.externalForwardedAt;
            if (!date) return;
            setForwardedMsgIds(prev => {
              if (prev.get(viewedRfc) === date) return prev;
              const next = new Map(prev);
              next.set(viewedRfc, date);
              try { localStorage.setItem('email-forwarded-msgids', JSON.stringify([...next])); } catch { /* ignore */ }
              return next;
            });
            setThreadMeta(prev => ({
              ...prev,
              [thread.id]: { ...(prev[thread.id] ?? { hasAllocation: false, hasTaskLink: false }), isForwarded: true },
            }));
          })
          .catch(() => {});
      }
      // Mark thread as read in local state
      setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, isRead: true } : t));
    } finally {
      setLoadingDetail(false);
    }
  }

  // Keep a live ref to openThread so the deep-link listeners below (registered
  // once) always call the current closure rather than a stale one.
  const openThreadRef = useRef(openThread);
  openThreadRef.current = openThread;

  // Open a specific thread from a single-email toast click. We build a minimal
  // thread object from the toast payload — openThread fetches the full detail
  // by id, so the placeholder is only used for the header until detail loads.
  const openEmailFromToast = useCallback((p: OpenEmailThreadPayload) => {
    if (!p?.threadId) return;
    const thread: EmailThreadType = {
      // Mirror the flat-view list keying: id = message id, gmailThreadId = the
      // real Gmail thread id. This sets targetMessageId so the reader shows the
      // single message — not the whole collapsible conversation. (p.id is the
      // message id; fall back to threadId if a payload lacks it.)
      id: p.id || p.threadId,
      gmailThreadId: p.threadId,
      subject: p.subject || '(no subject)',
      snippet: p.snippet,
      from: { name: p.fromName, email: p.fromEmail },
      date: p.internalDate ? new Date(p.internalDate).toISOString() : '',
      messageCount: 1,
      isRead: !p.isUnread,
      labelIds: p.isUnread ? ['INBOX', 'UNREAD'] : ['INBOX'],
      messages: [],
    };
    openThreadRef.current(thread);
  }, []);

  // Drain any pending toast handoff: an event fires when the page is already
  // mounted; sessionStorage covers the case where the toast click mounted us.
  const consumePendingOpen = useCallback((payload?: OpenEmailThreadPayload) => {
    let p = payload;
    if (!p) {
      try {
        const raw = sessionStorage.getItem(EMAIL_OPEN_THREAD_KEY);
        if (raw) p = JSON.parse(raw) as OpenEmailThreadPayload;
      } catch { /* ignore */ }
    }
    try { sessionStorage.removeItem(EMAIL_OPEN_THREAD_KEY); } catch { /* ignore */ }
    if (p) openEmailFromToast(p);
  }, [openEmailFromToast]);

  useEffect(() => {
    function onOpen(e: Event) {
      consumePendingOpen((e as CustomEvent<OpenEmailThreadPayload>).detail);
    }
    window.addEventListener(EMAIL_OPEN_THREAD_EVENT, onOpen);
    return () => window.removeEventListener(EMAIL_OPEN_THREAD_EVENT, onOpen);
  }, [consumePendingOpen]);

  // On first connection, pick up a thread the user clicked before this page mounted.
  useEffect(() => {
    if (connected) consumePendingOpen();
  }, [connected, consumePendingOpen]);

  function getAllocatedClients(): Client[] {
    return (threadDetail?.allocations ?? [])
      .filter(a => a.clients)
      .map(a => ({
        id: a.clients!.id,
        name: a.clients!.name,
        client_ref: a.clients!.client_ref,
        contact_email: null,
        risk_rating: a.clients!.risk_rating,
      }));
  }

  function handleReply(message: EmailMessage) {
    composeWindow.open({
      replyTo: message,
      defaultClients: getAllocatedClients(),
      threadMessages: activeThread?.messages ?? threadDetail?.messages ?? null,
    });
  }

  function handleReplyAll(message: EmailMessage) {
    // Build To: original sender (excluding self)
    const replyTo_list = [message.from]
      .concat(message.to.filter(a => a.email.toLowerCase() !== googleEmail.toLowerCase()))
      .filter((a, i, arr) => arr.findIndex(x => x.email === a.email) === i);
    // Build CC: original CC (excluding self)
    const replyCC = message.cc.filter(a => a.email.toLowerCase() !== googleEmail.toLowerCase());
    composeWindow.open({
      replyTo: message,
      replyAllRecipients: { to: replyTo_list, cc: replyCC },
      defaultClients: getAllocatedClients(),
      threadMessages: activeThread?.messages ?? threadDetail?.messages ?? null,
    });
  }

  function handleForward(message: EmailMessage) {
    composeWindow.open({
      forwardOf: message,
      defaultClients: getAllocatedClients(),
      threadMessages: activeThread?.messages ?? threadDetail?.messages ?? null,
    });
  }

  async function handleAIDraftReply(message: EmailMessage) {
    setDraftingAIReply(true);
    let prefilled: string | null = null;
    try {
      const threadSummary = message.body.replace(/<[^>]+>/g, ' ').slice(0, 2000);
      const res = await fetch('/api/email/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: message.subject,
          body: threadSummary,
          myName: signatureDisplayName || userName,
          mode: 'recommend',
        }),
      });
      const data = await res.json() as { result?: string };
      prefilled = data.result ?? null;
    } catch {
      prefilled = null;
    } finally {
      setDraftingAIReply(false);
      composeWindow.open({
        replyTo: message,
        defaultClients: getAllocatedClients(),
        prefilledBody: prefilled,
        threadMessages: activeThread?.messages ?? threadDetail?.messages ?? null,
      });
    }
  }

  function handleAllocated(clientIds: string[]) {
    if (activeThread) {
      // Add to the firm-wide allocated set (the source the bulk reconcile effect
      // reads) so the green marker survives the next list refetch — otherwise the
      // effect re-runs with a stale set and wipes the bar back off.
      const tid = activeThread.gmailThreadId ?? activeThread.id;
      setAllocThreadIds(prev => prev.has(tid) ? prev : new Set(prev).add(tid));
      setThreadMeta(prev => ({ ...prev, [activeThread.id]: { ...prev[activeThread.id], hasAllocation: true } }));
      openThread(activeThread);
    }
  }

  function handleRemoveAllocation(clientId: string) {
    if (!activeThread) return;
    const alloc = (threadDetail?.allocations ?? []).find(a => a.client_id === clientId);
    const clientName = alloc?.clients?.name ?? 'this client';
    setPendingRemoveAllocation({ clientId, clientName });
  }

  async function confirmRemoveAllocation() {
    if (!activeThread || !pendingRemoveAllocation) return;
    const { clientId } = pendingRemoveAllocation;
    setRemovingAllocation(true);
    try {
      const res = await fetch('/api/email/allocate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: activeThread.gmailThreadId ?? activeThread.id, clientId }),
      });
      // Cross-mailbox allocations made by another user can only be removed by an
      // admin. The server returns 403 admin_required (nothing removed) or, when
      // the caller removed their own row but a colleague's remains, partial:true.
      const payload = await res.json().catch(() => ({} as { message?: string; partial?: boolean }));
      if (res.status === 403) {
        showToast('error', payload.message || 'Only an admin can change another user’s client assignment for an email.');
        setPendingRemoveAllocation(null);
        return;
      }
      if (payload.partial && payload.message) {
        showToast('success', payload.message);
      }
      await openThread(activeThread);
      const remaining = (threadDetail?.allocations ?? []).filter(a => a.client_id !== clientId);
      setThreadMeta(prev => {
        const current = prev[activeThread.id];
        return { ...prev, [activeThread.id]: { ...current, hasAllocation: remaining.length > 0 } };
      });
      // Keep the firm-wide allocated set in sync so the bulk reconcile effect
      // doesn't re-paint a marker we just removed.
      if (remaining.length === 0) {
        const tid = activeThread.gmailThreadId ?? activeThread.id;
        setAllocThreadIds(prev => {
          if (!prev.has(tid)) return prev;
          const next = new Set(prev); next.delete(tid); return next;
        });
      }
    } finally {
      setRemovingAllocation(false);
      setPendingRemoveAllocation(null);
    }
  }

  async function handleRemoveTaskLink(taskId: string) {
    if (!activeThread) return;
    await fetch('/api/email/task-link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: activeThread.gmailThreadId ?? activeThread.id, taskId }),
    });
    await openThread(activeThread);
    const remaining = (threadDetail?.taskLinks ?? []).filter(t => t.task_id !== taskId);
    setThreadMeta(prev => {
      const current = prev[activeThread.id];
      return { ...prev, [activeThread.id]: { ...current, hasTaskLink: remaining.length > 0 } };
    });
    if (remaining.length === 0) {
      const tid = activeThread.gmailThreadId ?? activeThread.id;
      setTaskThreadIds(prev => {
        if (!prev.has(tid)) return prev;
        const next = new Set(prev); next.delete(tid); return next;
      });
    }
  }

  // Single chokepoint for opening the allocate modal — refuses drafts.
  function openAllocate() {
    if (isDraftThread(activeThread)) { showToast('error', "Drafts can't be allocated"); return; }
    setAllocateOpen(true);
  }

  async function handleCreateTaskFromEmail() {
    if (!activeThread) return;
    if (isDraftThread(activeThread)) { showToast('error', "Drafts can't be made into tasks"); return; }
    setCreatingTask(true);

    // Lazy-load team members once
    if (!teamMembersLoaded) {
      fetch('/api/users/team')
        .then(r => r.ok ? r.json() : { members: [] })
        .then((d: { members: { id: string; full_name: string | null; email: string }[] }) => {
          setTeamMembers(d.members ?? []);
          setTeamMembersLoaded(true);
        })
        .catch(() => {});
    }

    // Get the most recent message to extract sender + body
    const messages = activeThread.messages ?? [];
    const latest = messages[messages.length - 1] ?? messages[0];
    const fromEmail = latest?.from?.email ?? '';
    const fromName  = latest?.from?.name  ?? '';
    const body      = latest?.body ?? '';

    try {
      const res = await fetch('/api/email/suggest-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject:   activeThread.subject ?? '',
          body,
          fromEmail,
          fromName,
        }),
      });

      interface SuggestResult { title: string; steps: string[]; dueDate: string | null; clientId: string | null; clientName: string | null; }
      const data = res.ok
        ? await res.json() as SuggestResult
        : { title: activeThread.subject ?? '', steps: [], dueDate: null, clientId: null, clientName: null };

      setTaskSuggestedTitle(data.title ?? activeThread.subject ?? '');
      setTaskSuggestedSteps(data.steps ?? []);
      setTaskSuggestedDueDate(data.dueDate ?? '');
      setTaskSuggestedClientId(data.clientId ?? '');
      setTaskSuggestedClientName(data.clientName ?? '');
    } catch {
      setTaskSuggestedTitle(activeThread.subject ?? '');
      setTaskSuggestedSteps([]);
      setTaskSuggestedDueDate('');
      setTaskSuggestedClientId('');
      setTaskSuggestedClientName('');
    } finally {
      setCreatingTask(false);
      setShowQuickTask(true);
    }
  }

  async function handleCreateTaskFromSent({ subject, plainBody, toEmail, toName }: { subject: string; plainBody: string; toEmail: string; toName: string }) {
    // Lazy-load team members
    if (!teamMembersLoaded) {
      fetch('/api/users/team')
        .then(r => r.ok ? r.json() : { members: [] })
        .then((d: { members: { id: string; full_name: string | null; email: string }[] }) => {
          setTeamMembers(d.members ?? []);
          setTeamMembersLoaded(true);
        })
        .catch(() => {});
    }
    setCreatingTask(true);
    try {
      const res = await fetch('/api/email/suggest-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body: plainBody, fromEmail: toEmail, fromName: toName }),
      });
      interface SuggestResult { title: string; steps: string[]; dueDate: string | null; clientId: string | null; clientName: string | null; }
      const data = res.ok
        ? await res.json() as SuggestResult
        : { title: subject, steps: [], dueDate: null, clientId: null, clientName: null };
      setTaskSuggestedTitle(data.title ?? subject);
      setTaskSuggestedSteps(data.steps ?? []);
      setTaskSuggestedDueDate(data.dueDate ?? '');
      setTaskSuggestedClientId(data.clientId ?? '');
      setTaskSuggestedClientName(data.clientName ?? '');
    } catch {
      setTaskSuggestedTitle(subject);
      setTaskSuggestedSteps([]);
      setTaskSuggestedDueDate('');
      setTaskSuggestedClientId('');
      setTaskSuggestedClientName('');
    } finally {
      setCreatingTask(false);
      setShowQuickTask(true);
    }
  }

  // RFC Message-ID of the message the user is currently viewing/actioning, used
  // to record replied/forwarded per email. Prefers the exact viewed message
  // (flat view) and falls back to the latest message in the open conversation.
  function viewedRfcMessageId(): string {
    const msgs = threadDetail?.messages ?? [];
    const viewed = activeThread ? msgs.find(m => m.id === activeThread.id) : undefined;
    return (viewed?.messageId || msgs[msgs.length - 1]?.messageId || '');
  }

  function handleForwardSent(_originalThreadId: string) {
    // Immediately show forwarded chip in the list for the active thread
    if (activeThread) {
      setThreadMeta(prev => ({
        ...prev,
        [activeThread.id]: { ...(prev[activeThread.id] ?? { hasAllocation: false, hasTaskLink: false }), isForwarded: true },
      }));
    }
    const rfc = viewedRfcMessageId();
    if (!rfc) return;
    const sentAt = new Date().toISOString();
    setForwardedMsgIds(prev => {
      const next = new Map(prev);
      next.set(rfc, sentAt);
      try { localStorage.setItem('email-forwarded-msgids', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  function handleReacted(emoji: string) {
    if (!activeThread) return;
    setThreadMeta(prev => {
      const current = prev[activeThread.id] ?? { hasAllocation: false, hasTaskLink: false };
      const existing = current.reactions ?? [];
      if (existing.includes(emoji)) return prev;
      return { ...prev, [activeThread.id]: { ...current, reactions: [...existing, emoji] } };
    });
  }

  function handleReplySent(_originalThreadId: string) {
    // Immediately show replied chip in the list for the active thread
    if (activeThread) {
      setThreadMeta(prev => ({
        ...prev,
        [activeThread.id]: { ...(prev[activeThread.id] ?? { hasAllocation: false, hasTaskLink: false }), isReplied: true },
      }));
    }
    const rfc = viewedRfcMessageId();
    if (!rfc) return;
    const sentAt = new Date().toISOString();
    setRepliedMsgIds(prev => {
      const next = new Map(prev);
      next.set(rfc, sentAt);
      try { localStorage.setItem('email-replied-msgids', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  async function handleTaskCreated(data: CreateTaskData) {
    // When a task is created from inside the email triage flow, mark its title with
    // an envelope emoji so the source is immediately visible everywhere the task
    // is rendered. The user never sees this in the modal — we apply it on submit.
    const isFromEmail = !!activeThread;
    const submittedData: CreateTaskData = isFromEmail && !data.title.startsWith('📩')
      ? { ...data, title: `📩 ${data.title}` }
      : data;

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submittedData),
    });
    if (!res.ok) return;

    const created = await res.json() as { task?: { id: string } };
    const taskId = created.task?.id;

    // Link the new task to the email thread that triggered its creation
    if (taskId && activeThread) {
      await fetch('/api/email/task-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThread.gmailThreadId ?? activeThread.id,
          taskId,
          subject: activeThread.subject ?? '',
        }),
      }).catch(() => {});

      // Update the thread list indicator immediately — no need to re-fetch
      setThreadMeta(prev => ({
        ...prev,
        [activeThread.id]: {
          ...prev[activeThread.id],
          hasTaskLink: true,
        },
      }));
      // Sync the firm-wide set so the bulk reconcile effect keeps the marker.
      {
        const tid = activeThread.gmailThreadId ?? activeThread.id;
        setTaskThreadIds(prev => prev.has(tid) ? prev : new Set(prev).add(tid));
      }

      // Quick-task assigns to a single person via the first step. Forward the
      // email to that assignee with the task context — skip if it's the creator
      // themself (no point) or there's no assignee at all.
      const assigneeUserId = submittedData.steps?.[0]?.assignee_id ?? null;
      if (assigneeUserId && assigneeUserId !== currentUserId) {
        void fetch('/api/email/forward-task-assignment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: activeThread.gmailThreadId ?? activeThread.id,
            assigneeUserId,
            taskTitle: submittedData.title,
            dueDate: submittedData.due_date ?? null,
            steps: (submittedData.steps ?? []).map(s => s.title).filter(Boolean),
          }),
        }).then(async r => {
          if (!r.ok) {
            showToast('error', "Task created, but the forward email couldn't be sent.");
          }
        }).catch(() => {
          showToast('error', "Task created, but the forward email couldn't be sent.");
        });
      }
    }

    setShowQuickTask(false);
  }

  // ── Instant local count updates ────────────────────────────────────────────
  // Optimistically nudge the local counters so the Untriaged panel and the Inbox
  // unread badge react immediately to an action, rather than waiting for the
  // next server poll to re-anchor them. (handleMarkAllUnreadRead already does
  // this for the unread badge; these cover the delete + mark-read paths.)
  function adjustInboxUnread(delta: number) {
    adjustLabelCount('INBOX', 'messagesUnread', delta);
  }
  // Generic optimistic nudge for any folder tab's count. The top tabs read
  // `messagesTotal` for Drafts/Starred and `messagesUnread` for the rest
  // (see EmailTopTabs.countFor) — so pass the field that drives the tab you're
  // adjusting. Clamped at 0; the next 60s poll re-anchors to the server truth.
  function adjustLabelCount(id: string, field: 'messagesTotal' | 'messagesUnread', delta: number) {
    if (!delta) return;
    setLabels(prev => prev.map(l => l.id === id
      ? { ...l, [field]: Math.max(0, (l[field] ?? 0) + delta) }
      : l));
  }
  function adjustUntriagedBase(delta: number) {
    if (!delta) return;
    setUntriagedServer(prev => prev ? { ...prev, base: Math.max(0, prev.base + delta) } : prev);
  }
  // A categorised inbox email left the inbox (deleted / archived / spam): pull it
  // from its category card straight away. It was EXCLUDED from the untriaged
  // baseline, so we shrink categorisedAtBase in step — otherwise the untriaged
  // formula (base − (categorised − categorisedAtBase)) would read the smaller
  // `categorised` as a move back to untriaged and tick that count up by one.
  function removeCategoryOverride(id: string) {
    let existed = false;
    setCategoryOverrides(prev => {
      if (!prev[id] || prev[id].category === 'untriaged') return prev;
      existed = true;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (existed) {
      setUntriagedServer(prev => prev ? { ...prev, categorisedAtBase: Math.max(0, prev.categorisedAtBase - 1) } : prev);
    }
  }
  // An inbox email left the inbox (deleted / archived / moved): drop it from the
  // unread badge (if unread) and, depending on its triage state, either the
  // untriaged count or its category card. Guarded to inbox emails so acting in
  // another folder doesn't skew the inbox counters.
  function onInboxEmailRemoved(t: EmailThreadType | undefined) {
    if (!t || !t.labelIds.includes('INBOX')) return;
    if (!t.isRead) adjustInboxUnread(-1);
    if (isUntriaged(t)) adjustUntriagedBase(-1);
    else removeCategoryOverride(t.id);
  }
  // An inbox email's read state flipped: nudge the unread badge accordingly.
  function onReadStateChanged(t: EmailThreadType | undefined, nowRead: boolean) {
    if (!t || !t.labelIds.includes('INBOX')) return;
    if (nowRead && !t.isRead) adjustInboxUnread(-1);
    else if (!nowRead && t.isRead) adjustInboxUnread(1);
  }

  function handleDelete() {
    if (!activeThread) return;
    onInboxEmailRemoved(activeThread);
    markPendingTrash([activeThread.id]);
    setThreads(prev => prev.filter(t => t.id !== activeThread.id));
    setActiveThread(null);
    setThreadDetail(null);
  }

  function handleArchive() {
    if (!activeThread) return;
    onInboxEmailRemoved(activeThread);
    setThreads(prev => prev.filter(t => t.id !== activeThread.id));
    setActiveThread(null);
    setThreadDetail(null);
  }

  function handleStar(starred: boolean) {
    if (!activeThread) return;
    if (starred !== activeThread.labelIds.includes('STARRED')) {
      adjustLabelCount('STARRED', 'messagesTotal', starred ? 1 : -1);
    }
    setThreads(prev => prev.map(t => t.id === activeThread.id ? {
      ...t,
      labelIds: starred
        ? [...t.labelIds.filter(l => l !== 'STARRED'), 'STARRED']
        : t.labelIds.filter(l => l !== 'STARRED'),
    } : t));
  }

  function handleListStar(rowId: string, starred: boolean) {
    const wasStarred = threads.find(x => x.id === rowId)?.labelIds.includes('STARRED') ?? false;
    if (starred !== wasStarred) adjustLabelCount('STARRED', 'messagesTotal', starred ? 1 : -1);
    setThreads(prev => prev.map(t => t.id === rowId ? {
      ...t,
      labelIds: starred
        ? [...t.labelIds.filter(l => l !== 'STARRED'), 'STARRED']
        : t.labelIds.filter(l => l !== 'STARRED'),
    } : t));
    // In the flat (ungrouped) inbox a row is a single message and rowId is its
    // message id — star that message, not the thread. Gmail merges same-subject
    // senders (e.g. GoCardless) into one thread, so threads.modify with a later
    // message's id would 404 and the star wouldn't persist on refresh. In
    // grouped view there's no gmailThreadId and rowId is the real thread id.
    const t = threads.find(x => x.id === rowId);
    const body = t?.gmailThreadId
      ? { messageId: rowId }
      : { threadId: rowId };
    fetch('/api/email/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        addLabelIds: starred ? ['STARRED'] : [],
        removeLabelIds: starred ? [] : ['STARRED'],
      }),
    }).catch(() => {});
  }

  function handleListDelete(threadId: string) {
    // In non-threaded view, threadId is the message ID — but Gmail's threads.trash
    // requires the real thread ID. Resolve via gmailThreadId.
    const t = threads.find(x => x.id === threadId);
    const gmailId = t?.gmailThreadId ?? threadId;
    onInboxEmailRemoved(t);
    markPendingTrash([threadId]);
    setThreads(prev => prev.filter(x => x.id !== threadId));
    if (activeThread?.id === threadId) {
      setActiveThread(null);
      setThreadDetail(null);
    }
    fetch('/api/email/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: gmailId }),
    }).catch(() => {});
  }

  // Drag-and-drop: one or more email rows dropped onto a folder/label tab.
  // Accepts an array so a multi-selection moves/labels every selected email.
  function handleDropToLabel(threadIds: string[], label: GmailLabel) {
    if (threadIds.length === 0) return;
    const n = threadIds.length;
    const many = n > 1;
    // Resolve Gmail thread ids up front — later closures (undo) run after the
    // rows have been removed from state, so we can't look them up then.
    const gmailIdMap = new Map(threadIds.map(id => [id, threads.find(x => x.id === id)?.gmailThreadId ?? id]));
    const gmailIdOf = (id: string) => gmailIdMap.get(id) ?? id;
    const modify = (gmailId: string, addLabelIds: string[], removeLabelIds: string[]) =>
      fetch('/api/email/modify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: gmailId, addLabelIds, removeLabelIds }),
      }).catch(() => {});
    const removeFromList = (ids: string[]) => {
      const set = new Set(ids);
      setThreads(prev => prev.filter(x => !set.has(x.id)));
      if (activeThread && set.has(activeThread.id)) { setActiveThread(null); setThreadDetail(null); }
    };

    if (label.id === 'STARRED') {
      threadIds.forEach(id => handleListStar(id, true));
      showToast('success', many ? `Starred ${n}` : 'Starred');
      return;
    }
    if (label.id === 'TRASH') {
      threadIds.forEach(id => handleListDelete(id));
      showToast('success', many ? `Moved ${n} to Trash` : 'Moved to Trash');
      return;
    }
    if (label.id === 'SPAM') {
      threadIds.forEach(id => { onInboxEmailRemoved(threads.find(x => x.id === id)); modify(gmailIdOf(id), ['SPAM'], ['INBOX']); });
      markPendingTrash(threadIds);
      removeFromList(threadIds);
      showToast('success', many ? `Marked ${n} as spam` : 'Marked as spam');
      return;
    }
    if (label.id === 'INBOX') {
      threadIds.forEach(id => modify(gmailIdOf(id), ['INBOX'], ['SPAM']));
      showToast('success', many ? `Moved ${n} to Inbox` : 'Moved to Inbox');
      return;
    }
    if (label.type === 'user') {
      // Dragging onto a user label MOVES it (Gmail-style): apply the label AND
      // remove from the Inbox, then drop the row. (Just tagging without moving is
      // the label icon above the email / the context panel — handlePanelAddLabel.)
      // Emails not in the Inbox (e.g. viewing Sent) are only tagged — nothing to
      // archive out of.
      const movable: string[] = [];
      const taggable: string[] = [];
      for (const id of threadIds) {
        const t = threads.find(x => x.id === id);
        const inInbox = t?.labelIds.includes('INBOX') ?? (activeLabel === 'INBOX');
        (inInbox ? movable : taggable).push(id);
      }
      // Move: archive into the label.
      movable.forEach(id => { onInboxEmailRemoved(threads.find(x => x.id === id)); modify(gmailIdOf(id), [label.id], ['INBOX']); });
      if (movable.length) { markPendingTrash(movable); removeFromList(movable); }
      // Tag: apply the label, leave in place.
      if (taggable.length) {
        const set = new Set(taggable);
        setThreads(prev => prev.map(x => set.has(x.id) ? { ...x, labelIds: Array.from(new Set([...x.labelIds, label.id])) } : x));
        taggable.forEach(id => modify(gmailIdOf(id), [label.id], []));
      }
      const moved = movable.length, tagged = taggable.length;
      const msg = moved && tagged
        ? `Moved ${moved} to "${label.name}" · removed from inbox · labelled ${tagged}`
        : moved
          ? (moved > 1 ? `Moved ${moved} to "${label.name}" · removed from inbox` : `Moved to "${label.name}" · removed from inbox`)
          : (tagged > 1 ? `Labelled ${tagged} "${label.name}"` : `Labelled "${label.name}"`);
      showToast('success', msg, async () => {
        // Undo: restore moved emails to the Inbox + strip the label, and un-label
        // the tagged ones. Optimistically clear the label chip on any still-
        // visible (tagged) rows, and AWAIT the Gmail changes before refetching so
        // the reappearing moved rows don't come back still carrying the label.
        if (movable.length) unmarkPendingTrash(movable);
        if (taggable.length) {
          const set = new Set(taggable);
          setThreads(prev => prev.map(x => set.has(x.id) ? { ...x, labelIds: x.labelIds.filter(l => l !== label.id) } : x));
        }
        await Promise.all([
          ...movable.map(id => modify(gmailIdOf(id), ['INBOX'], [label.id])),
          ...taggable.map(id => modify(gmailIdOf(id), [], [label.id])),
        ]);
        if (movable.length) fetchThreads(activeLabel);
        showToast('success', 'Undone');
      });
      return;
    }
  }

  // Bulk: allocate every selected thread to the same client(s).
  function handleBulkAllocate(ids: string[]) {
    const all = ids
      .map(id => threads.find(t => t.id === id))
      .filter((t): t is EmailThreadType => !!t);
    const sel = all.filter(t => !isDraftThread(t)); // drafts can't be allocated
    const skipped = all.length - sel.length;
    if (skipped > 0) showToast('error', `Skipped ${skipped} draft${skipped > 1 ? 's' : ''} — drafts can't be allocated`);
    if (sel.length) setBulkAllocateThreads(sel);
  }

  // Bulk: open a print view (print or save-as-PDF) of the selected emails.
  async function handleBulkPrint(ids: string[]) {
    const win = window.open('', '_blank');
    if (!win) { showToast('error', 'Allow pop-ups to print emails.'); return; }
    win.document.write('<!doctype html><title>Preparing…</title><body style="font-family:Arial,sans-serif;padding:24px">Preparing print…</body>');

    const details = await Promise.all(ids.map(async id => {
      const t = threads.find(x => x.id === id);
      const gmailId = t?.gmailThreadId ?? id;
      try {
        const url = t?.gmailThreadId
          ? `/api/email/thread/${gmailId}?messageId=${encodeURIComponent(id)}`
          : `/api/email/thread/${gmailId}`;
        const res = await fetch(url);
        const data = await res.json() as ThreadDetail;
        return { subject: t?.subject ?? '(no subject)', messages: data.messages ?? [] };
      } catch { return null; }
    }));

    const sections = details
      .filter((d): d is { subject: string; messages: ThreadDetail['messages'] } => !!d)
      .map(d => {
        const msgs = d.messages.map(m => `
          <div style="margin:0 0 16px;">
            <div style="font-size:12px;color:#555;"><strong>${escapeHtml(m.from?.name || m.from?.email || '')}</strong> &lt;${escapeHtml(m.from?.email || '')}&gt; — ${escapeHtml(m.date ? new Date(m.date).toLocaleString('en-GB') : '')}</div>
            <div style="margin-top:6px;font-size:14px;line-height:1.5;">${m.body || ''}</div>
          </div>`).join('<hr style="border:none;border-top:1px solid #eee;margin:12px 0;"/>');
        return `<section style="page-break-after:always;margin-bottom:24px;"><h2 style="font-size:16px;margin:0 0 8px;">${escapeHtml(d.subject)}</h2>${msgs}</section>`;
      }).join('');

    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>SMITH — Emails</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#111;">${sections || '<p>No printable content.</p>'}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  // Bulk: download every attachment across the selected emails.
  async function handleBulkDownloadAttachments(ids: string[]) {
    let count = 0;
    for (const id of ids) {
      const t = threads.find(x => x.id === id);
      const gmailId = t?.gmailThreadId ?? id;
      try {
        const url = t?.gmailThreadId
          ? `/api/email/thread/${gmailId}?messageId=${encodeURIComponent(id)}`
          : `/api/email/thread/${gmailId}`;
        const res = await fetch(url);
        const data = await res.json() as ThreadDetail;
        const atts = (data.messages ?? []).flatMap(m => m.attachments ?? []);
        for (const a of atts) {
          if (!a.attachmentId || !a.messageId) continue;
          const dl = `/api/email/attachment?messageId=${encodeURIComponent(a.messageId)}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}&mimeType=${encodeURIComponent(a.mimeType)}`;
          const link = document.createElement('a');
          link.href = dl;
          link.download = a.filename || 'attachment';
          document.body.appendChild(link);
          link.click();
          link.remove();
          count++;
          await new Promise(r => setTimeout(r, 350)); // stagger so the browser allows multiple downloads
        }
      } catch { /* skip this thread */ }
    }
    showToast(count > 0 ? 'success' : 'error',
      count > 0 ? `Downloading ${count} attachment${count !== 1 ? 's' : ''}…` : 'No attachments on the selected emails.');
  }

  function handleBulkDelete(ids: string[]) {
    markPendingTrash(ids);
    ids.forEach(id => onInboxEmailRemoved(threads.find(t => t.id === id)));
    const gmailIds = ids.map(id => threads.find(t => t.id === id)?.gmailThreadId ?? id);
    setThreads(prev => prev.filter(t => !ids.includes(t.id)));
    if (activeThread && ids.includes(activeThread.id)) {
      setActiveThread(null);
      setThreadDetail(null);
    }
    // Fire-and-forget trash for each
    gmailIds.forEach(gmailId =>
      fetch('/api/email/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: gmailId }),
      }).catch(() => {})
    );
  }

  function handleMarkRead(threadId: string, markAsRead: boolean) {
    // Resolve the real Gmail thread ID — required for the modify API call
    // when running in non-threaded view (where threadId is a message ID).
    const t = threads.find(x => x.id === threadId);
    const gmailId = t?.gmailThreadId ?? threadId;
    onReadStateChanged(t, markAsRead);
    markPendingReadState([threadId], markAsRead);
    setThreads(prev => prev.map(x =>
      x.id === threadId
        ? { ...x, isRead: markAsRead, labelIds: markAsRead ? x.labelIds.filter(l => l !== 'UNREAD') : [...x.labelIds.filter(l => l !== 'UNREAD'), 'UNREAD'] }
        : x
    ));
    fetch('/api/email/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: gmailId,
        removeLabelIds: markAsRead ? ['UNREAD'] : [],
        addLabelIds: markAsRead ? [] : ['UNREAD'],
      }),
    }).catch(() => {});
  }

  function handleBulkMarkRead(ids: string[]) {
    markPendingReadState(ids, true);
    ids.forEach(id => onReadStateChanged(threads.find(t => t.id === id), true));
    const gmailIds = ids.map(id => threads.find(t => t.id === id)?.gmailThreadId ?? id);
    setThreads(prev => prev.map(t =>
      ids.includes(t.id)
        ? { ...t, isRead: true, labelIds: t.labelIds.filter(l => l !== 'UNREAD') }
        : t
    ));
    // Fire-and-forget mark-read for each
    gmailIds.forEach(gmailId =>
      fetch('/api/email/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: gmailId, removeLabelIds: ['UNREAD'], addLabelIds: [] }),
      }).catch(() => {})
    );
  }

  function handleMove() {
    if (!activeThread) return;
    onInboxEmailRemoved(activeThread);
    setThreads(prev => prev.filter(t => t.id !== activeThread.id));
    setActiveThread(null);
    setThreadDetail(null);
  }

  // Add/remove a Gmail user label on the open thread — drives the context panel
  // Tags. Optimistically updates local label state so the chips reflect at once.
  function handlePanelAddLabel(labelId: string) {
    if (!activeThread) return;
    const gmailId = activeThread.gmailThreadId ?? activeThread.id;
    const id = activeThread.id;
    fetch('/api/email/modify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: gmailId, addLabelIds: [labelId] }),
    }).catch(() => {});
    setActiveThread(prev => prev ? { ...prev, labelIds: [...new Set([...prev.labelIds, labelId])] } : prev);
    setThreads(prev => prev.map(t => t.id === id ? { ...t, labelIds: [...new Set([...t.labelIds, labelId])] } : t));
  }
  function handlePanelRemoveLabel(labelId: string) {
    if (!activeThread) return;
    const gmailId = activeThread.gmailThreadId ?? activeThread.id;
    const id = activeThread.id;
    fetch('/api/email/modify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: gmailId, removeLabelIds: [labelId] }),
    }).catch(() => {});
    setActiveThread(prev => prev ? { ...prev, labelIds: prev.labelIds.filter(l => l !== labelId) } : prev);
    setThreads(prev => prev.map(t => t.id === id ? { ...t, labelIds: t.labelIds.filter(l => l !== labelId) } : t));
  }

  // Run an AI "suggested action" from the summary panel against the open thread.
  function handleSummaryAction(action: SummaryAction) {
    const msgs = threadDetail?.messages ?? [];
    const last = msgs[msgs.length - 1];
    switch (action.type) {
      case 'reply':     if (last) handleReply(last); break;
      case 'reply_all': if (last) handleReplyAll(last); break;
      case 'forward':   if (last) handleForward(last); break;
      case 'task':      void handleCreateTaskFromEmail(); break;
      case 'allocate':  openAllocate(); break;
    }
  }

  function handleRestore() {
    if (!activeThread) return;
    setThreads(prev => prev.filter(t => t.id !== activeThread.id));
    setActiveThread(null);
    setThreadDetail(null);
  }

  function handleMarkUnread() {
    if (!activeThread) return;
    onReadStateChanged(activeThread, false);
    setThreads(prev => prev.map(t => t.id === activeThread.id
      ? { ...t, isRead: false, labelIds: [...t.labelIds.filter(l => l !== 'UNREAD'), 'UNREAD'] }
      : t
    ));
  }

  async function handlePin(threadId: string, pin: boolean) {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (pin) next.add(threadId); else next.delete(threadId);
      return next;
    });
    await fetch('/api/email/pin', {
      method: pin ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId }),
    }).catch(() => {});
  }

  const sortedThreads = useMemo(() => {
    if (pinnedIds.size === 0) return threads;
    return [
      ...threads.filter(t => pinnedIds.has(t.id)),
      ...threads.filter(t => !pinnedIds.has(t.id)),
    ];
  }, [threads, pinnedIds]);

  // Accumulate senders seen across fetches (never removes) so the dropdown
  // retains its options even when a server-side sender filter is active.
  useEffect(() => {
    setSeenSenders(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const t of threads) {
        const email = t.from?.email;
        if (email && !next.has(email)) { next.set(email, t.from?.name || ''); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [threads]);
  const senders = useMemo(
    () => Array.from(seenSenders.entries())
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    [seenSenders],
  );

  // Sender + time filtering is now server-side (whole mailbox), so the loaded
  // list is already scoped — nothing to filter client-side.
  const displayedThreads = sortedThreads;

  // Triage is per user, per EMAIL: a row's category is its saved override
  // (keyed by the row id = message id in flat view), or "untriaged" when
  // nothing has been set by this user.
  const categoryOf = useCallback((t: EmailThreadType): EmailCategory => {
    const ov = categoryOverrides[t.id];
    return ov ? ov.category : 'untriaged';
  }, [categoryOverrides]);
  // True when this user hasn't categorised the email yet (drafts never triage).
  const isUntriaged = useCallback((t: EmailThreadType): boolean => {
    const ov = categoryOverrides[t.id];
    return !ov || ov.category === 'untriaged';
  }, [categoryOverrides]);
  // Card counts: the actioned buckets come from the firm-wide saved categories
  // (loaded from DB). Untriaged is inbox-wide: the inbox's total message count
  // (from the Gmail label) minus everything that's been given a category — so
  // it covers the whole mailbox, not just the loaded page, and drops in real
  // time as Auto Triage / manual triage saves categories.
  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(EMAIL_CATEGORIES.map(c => [c, 0])) as Record<EmailCategory, number>;
    for (const v of Object.values(categoryOverrides)) counts[v.category]++;
    const categorised = Object.values(categoryOverrides).filter(v => v.category !== 'untriaged').length;
    if (untriagedServer) {
      // Exact server baseline, adjusted by how far the local overrides map has
      // moved since the snapshot — triaging ticks it down instantly, a reset
      // (new mail on a categorised thread) ticks it up, polls re-anchor it.
      counts.untriaged = Math.max(0, untriagedServer.base - (categorised - untriagedServer.categorisedAtBase));
    } else {
      // Fallback until the first exact fetch lands: thread count minus
      // categorised (approximate — Gmail's label counters can lag).
      const inbox = labels.find(l => l.id === 'INBOX');
      const inboxTotal = inbox?.threadsTotal || inbox?.messagesTotal || 0;
      counts.untriaged = Math.max(0, inboxTotal - categorised);
    }
    return counts;
  }, [categoryOverrides, labels, untriagedServer]);
  // Broadcast the Untriaged count so the sidebar badge tracks it in real time.
  // Only once the inbox label has loaded — otherwise the initial render would
  // push a misleading 0 over whatever the sidebar fetched itself.
  useEffect(() => {
    if (!labels.some(l => l.id === 'INBOX')) return;
    window.dispatchEvent(new CustomEvent('smith:email-untriaged', { detail: categoryCounts.untriaged }));
  }, [categoryCounts.untriaged, labels]);
  // Server-side fetch scopes the list to the active category, but we also hide
  // any row explicitly re-categorised to a DIFFERENT bucket this session, so a
  // triaged email leaves the current list immediately (no refetch needed).
  const finalThreads = useMemo(() => {
    if (!categoryFilter) return displayedThreads;
    if (categoryFilter === 'untriaged') return displayedThreads.filter(isUntriaged);
    return displayedThreads.filter(t => {
      const ov = categoryOverrides[t.id];
      return !ov || ov.category === categoryFilter;
    });
  }, [displayedThreads, categoryFilter, categoryOverrides, isUntriaged]);

  if (connected === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-[#5b21b6]" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center">
          <Mail size={24} className="text-[var(--accent)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Connect Gmail</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-xs">
            Link your Gmail account to start triaging emails directly in SMITH.
          </p>
        </div>
        <a href="/api/email/auth/connect" className="btn-primary flex items-center gap-2">
          <Mail size={15} /> Connect Gmail Account
        </a>
        <a href="/settings?tab=email-triage" className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] flex items-center gap-1">
          <Settings size={11} /> Email settings
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Transient toast banner */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 ${
            toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
          }`}
        >
          {toast.message}
          {toast.undo && (
            <button
              onClick={() => { toast.undo!(); setToast(null); }}
              className="ml-1 pl-1.5 pr-2 py-0.5 rounded-md bg-white/20 hover:bg-white/30 text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              {/* Countdown donut — empties clockwise over the undo window */}
              <svg width="14" height="14" viewBox="0 0 16 16" className="-rotate-90 shrink-0">
                <circle cx="8" cy="8" r="6.5" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
                <circle
                  cx="8" cy="8" r="6.5" fill="none" stroke="white" strokeWidth="3"
                  strokeDasharray="40.84"
                  style={{ animation: `smith-undo-countdown ${toast.undoMs ?? 7000}ms linear forwards` }}
                />
              </svg>
              Undo
            </button>
          )}
          <button onClick={() => setToast(null)} className="ml-1 opacity-80 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top folder tabs (replaces the old left folder sidebar) */}
      <EmailTopTabs
        labels={labels}
        activeLabel={activeLabel}
        onSelectLabel={(id) => {
          setActiveLabel(id);
          // Triage categories are an INBOX concept — a stale category filter
          // would otherwise force the DB path and hide a folder's real contents
          // (e.g. Drafts showing empty). Clear it whenever you switch folders.
          setCategoryFilter(null);
        }}
        onLabelCreated={label => setLabels(prev => [...prev, label])}
        onCompose={() => composeWindow.open()}
        onRules={() => setRulesOpen(true)}
        onDropThread={handleDropToLabel}
        onMarkAllRead={handleMarkAllUnreadRead}
        rightExtra={
          <EmailFilterBar
            clientId={clientFilter?.id ?? ''}
            clientName={clientFilter?.name ?? ''}
            onClientChange={(id, name) => setClientFilter(id ? { id, name } : null)}
            senders={senders}
            senderFilter={senderFilter}
            onSenderChange={setSenderFilter}
            timeFilter={timeFilter}
            onTimeChange={setTimeFilter}
          />
        }
      />

      {/* Triage category cards (left, scrollable) + Auto Triage controls — one
          row. relative z-30 lifts the row's stacking context above the body
          panels below (which create their own contexts via backdrop-blur), so
          the Auto Triage / settings popovers aren't clipped underneath them. */}
      <div className="shrink-0 relative z-30 flex items-center gap-3 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-card)] backdrop-blur-md">
        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-thin">
          {/* Category cards are inbox triage — hide them on Sent/Drafts/etc. */}
          {activeLabel === 'INBOX' && (
            <EmailCategoryCards
              counts={categoryCounts}
              active={categoryFilter}
              onSelect={setCategoryFilter}
              onDropCategory={handleDropCategory}
              untriagedProgress={autoTriage}
              onMarkAllNoAction={handleMarkAllNoAction}
            />
          )}
        </div>
        {activeLabel === 'INBOX' && (
          <div className="shrink-0 relative flex items-center gap-1.5">
            {autoTriage ? (
              <button
                onClick={() => { autoTriageCancelRef.current = true; }}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-400 hover:shadow-sm transition-all"
              >
                <X size={13} /> Stop Auto Triage
              </button>
            ) : (
              <Tooltip label="AI-categorise untriaged emails">
                <button
                  onClick={() => { setAutoTriageMenuOpen(o => !o); setTriageSettingsOpen(false); }}
                  aria-label="Auto Triage untriaged emails"
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-[var(--border-card)] bg-white/50 text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:shadow-sm transition-all"
                >
                  <Sparkles size={13} /> Auto Triage
                </button>
              </Tooltip>
            )}
            <Tooltip label="Triage settings">
              <button
                onClick={() => { setTriageSettingsOpen(o => !o); setAutoTriageMenuOpen(false); }}
                aria-label="Triage settings"
                className="p-2 rounded-lg border border-[var(--border-card)] bg-white/50 text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:shadow-sm transition-all"
              >
                <Settings2 size={14} />
              </button>
            </Tooltip>

            {/* Auto Triage scope chooser */}
            {autoTriageMenuOpen && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setAutoTriageMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-[61] w-80 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl p-1.5">
                  <button
                    onClick={() => runAutoTriage('loaded')}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors"
                  >
                    <p className="text-xs font-semibold text-[var(--text-primary)]">Loaded conversations</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Triage the {threads.filter(isAutoTriageCandidate).length} untriaged email{threads.filter(isAutoTriageCandidate).length === 1 ? '' : 's'} currently loaded in the list.
                    </p>
                  </button>
                  <button
                    onClick={() => runAutoTriage('inbox')}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors"
                  >
                    <p className="text-xs font-semibold text-[var(--text-primary)]">Entire inbox</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Sweep the whole inbox page by page (~{categoryCounts.untriaged.toLocaleString()} untriaged, up to 2,000 per run).
                      Uses AI on every email — a large inbox can take a long time and incur significant API costs.
                    </p>
                  </button>
                </div>
              </>
            )}

            {/* Triage settings popover */}
            {triageSettingsOpen && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setTriageSettingsOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-[61] w-80 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl p-3">
                  <p className="text-xs font-semibold text-[var(--text-primary)] mb-2.5">Triage settings</p>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={triageSettings.markReadOnAutoTriage}
                      onChange={e => updateTriageSettings({ markReadOnAutoTriage: e.target.checked })}
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block text-xs font-medium text-[var(--text-primary)]">Mark emails read when auto-triaged</span>
                      <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">Auto Triage marks each email as read once it has categorised it.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={triageSettings.autoFileEnabled}
                      onChange={e => updateTriageSettings({ autoFileEnabled: e.target.checked })}
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block text-xs font-medium text-[var(--text-primary)]">Auto-file old untriaged emails</span>
                      <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">
                        Untriaged inbox emails older than the limit are filed as No Action Needed automatically when this page loads. No AI is used.
                      </span>
                    </span>
                  </label>
                  <div className={`flex items-center gap-2 mt-2 pl-6 ${triageSettings.autoFileEnabled ? '' : 'opacity-50'}`}>
                    <span className="text-[11px] text-[var(--text-secondary)]">Older than</span>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={triageSettings.autoFileDays}
                      disabled={!triageSettings.autoFileEnabled}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) updateTriageSettings({ autoFileDays: Math.min(3650, Math.max(1, v)) });
                      }}
                      className="w-20 text-xs px-2 py-1 rounded-md border border-[var(--border-input)] bg-transparent outline-none text-[var(--text-primary)] focus:border-[var(--accent)] disabled:cursor-not-allowed"
                    />
                    <span className="text-[11px] text-[var(--text-secondary)]">days</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Body: list · reader · context panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Thread list */}
      <div style={{ width: threadListWidth }} className="shrink-0 overflow-hidden flex flex-col bg-[var(--bg-card)] backdrop-blur-md">
        <div className="flex-1 min-h-0 flex flex-col">
        <EmailList
          threads={finalThreads}
          activeThreadId={activeThread?.id ?? null}
          loading={loadingThreads}
          error={fetchError}
          threadMeta={threadMeta}
          searchQuery={searchQuery}
          onSearch={q => setSearchQuery(q)}
          onSelect={openThread}
          onStar={handleListStar}
          onDelete={handleListDelete}
          onMarkRead={handleMarkRead}
          onRefresh={() => { setFetchError(null); fetchThreads(activeLabel); }}
          hasNextPage={!!nextPageToken}
          onLoadMore={() => nextPageToken && fetchThreads(activeLabel, nextPageToken)}
          loadingMore={loadingMore}
          pinnedIds={pinnedIds}
          onPin={handlePin}
          forwardedMsgIds={forwardedMsgIds}
          repliedMsgIds={repliedMsgIds}
          unreadOnly={unreadOnly}
          onUnreadOnlyChange={v => { setUnreadOnly(v); }}
          taskLinkedOnly={taskLinkedOnly}
          onTaskLinkedOnlyChange={v => { setTaskLinkedOnly(v); if (v) { setAllocatedOnly(false); setUnreadOnly(false); } }}
          allocatedOnly={allocatedOnly}
          onAllocatedOnlyChange={v => { setAllocatedOnly(v); if (v) { setTaskLinkedOnly(false); setUnreadOnly(false); } }}
          activeLabel={activeLabel}
          userLabels={labels.filter(l => l.type === 'user').map(l => ({ id: l.id, name: l.name }))}
          onBulkDelete={handleBulkDelete}
          onBulkMarkRead={handleBulkMarkRead}
          onBulkAllocate={handleBulkAllocate}
          onBulkPrint={handleBulkPrint}
          onBulkDownloadAttachments={handleBulkDownloadAttachments}
          onBulkForward={async (ids, to, cc, note) => {
            // ids are EmailList's internal thread IDs; the server needs the
            // real Gmail thread IDs (non-threaded view uses message IDs as
            // the list key, so we resolve via the threads array first).
            const gmailIds = ids.map(id => threads.find(t => t.id === id)?.gmailThreadId ?? id);
            const res = await fetch('/api/email/bulk-forward', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ threadIds: gmailIds, toEmails: to, ccEmails: cc, note }),
            });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              throw new Error(j.error ?? 'Bulk forward failed');
            }
            const out = await res.json() as { success: number; failed: number };
            return { success: out.success, failed: out.failed };
          }}
        />
        </div>
      </div>

      {/* Drag handle / divider — thread list / detail. Uses --border-input (a
          dark translucent line) not --border (translucent white, invisible on
          the light panel) so the column is clearly separated. */}
      <div
        className="w-px shrink-0 cursor-col-resize bg-[var(--border-input)] hover:bg-[var(--accent)] hover:w-1 transition-all"
        onMouseDown={e => startColDrag('threadlist', e)}
        aria-label="Drag to resize"
      />

      {/* Thread detail */}
      <div className="flex-1 overflow-hidden relative bg-[var(--bg-card)] backdrop-blur-md">
        {draftingAIReply && (
          <div className="absolute inset-0 z-10 bg-[var(--bg-card-solid)]/70 flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin text-[var(--accent)]" />
            <span className="text-sm text-[var(--text-primary)]">Drafting AI reply…</span>
          </div>
        )}
        {loadingDetail ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin text-[#5b21b6]" />
          </div>
        ) : activeThread && threadDetail ? (
          <EmailThread
            thread={{ ...activeThread, messages: threadDetail.messages }}
            targetMessageId={activeThread.gmailThreadId ? activeThread.id : undefined}
            allocations={threadDetail.allocations}
            taskLinks={threadDetail.taskLinks}
            googleEmail={threadDetail.googleEmail || googleEmail}
            tasksModuleActive={tasksModuleActive}
            labels={labels}
            onAllocate={openAllocate}
            onCreateTask={() => void handleCreateTaskFromEmail()}
            creatingTask={creatingTask}
            onReply={handleReply}
            onReplyAll={handleReplyAll}
            onForward={handleForward}
            onAIDraftReply={handleAIDraftReply}
            onDelete={handleDelete}
            onArchive={handleArchive}
            onStar={handleStar}
            onMove={handleMove}
            onRestore={handleRestore}
            onMarkUnread={handleMarkUnread}
            onRemoveAllocation={handleRemoveAllocation}
            onRemoveTaskLink={handleRemoveTaskLink}
            isPinned={activeThread ? pinnedIds.has(activeThread.id) : false}
            onPin={activeThread ? (pin) => handlePin(activeThread.id, pin) : undefined}
            existingReactions={activeThread ? (threadMeta[activeThread.id]?.reactions ?? []) : []}
            onReacted={handleReacted}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2">
            <Mail size={32} className="text-[var(--text-muted)] opacity-30" />
            <p className="text-sm text-[var(--text-muted)]">Select an email to read</p>
          </div>
        )}
      </div>

      {/* Right context panel — client snapshot + tags. Collapses to a thin rail. */}
      {activeThread && threadDetail && (
        contextOpen ? (
          <div className="shrink-0 w-[300px] overflow-hidden border-l border-[var(--border)] bg-[var(--bg-card)] backdrop-blur-md">
            <EmailContextPanel
              allocations={threadDetail.allocations}
              taskLinks={threadDetail.taskLinks}
              threadLabelIds={activeThread.labelIds}
              userLabels={labels.filter(l => l.type === 'user').map(l => ({ id: l.id, name: l.name }))}
              aiSummary={summaries[activeThread.gmailThreadId ?? activeThread.id]}
              category={categoryOf(activeThread)}
              onCategoryChange={c => setThreadCategory(activeThread.id, c, activeThread.gmailThreadId)}
              onAllocate={openAllocate}
              onRemoveAllocation={handleRemoveAllocation}
              onRemoveTaskLink={handleRemoveTaskLink}
              onAddLabel={handlePanelAddLabel}
              onRemoveLabel={handlePanelRemoveLabel}
              onRegenerateSummary={() => summariseThread(
                activeThread.gmailThreadId ?? activeThread.id,
                activeThread.subject,
                threadDetail.messages,
                threadDetail.allocations[0]?.clients?.name ?? '',
              )}
              onSummaryAction={handleSummaryAction}
              onClose={() => setContextOpen(false)}
            />
          </div>
        ) : (
          <button
            onClick={() => setContextOpen(true)}
            aria-label="Show client panel"
            className="shrink-0 w-9 border-l border-[var(--border)] bg-[var(--bg-card)] backdrop-blur-md flex items-start justify-center pt-4 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <PanelRightOpen size={16} />
          </button>
        )
      )}
      </div>

      {/* Modals */}
      {/* ComposeModal is mounted globally at AppShell level so it survives
          navigation between tools (see GlobalComposeWindow). EmailTriagePage
          listens to the EMAIL_SENT_EVENT below to refresh its thread list and
          mark replied/forwarded threads when sends originate from anywhere. */}

      <AllocateModal
        open={allocateOpen}
        onClose={() => setAllocateOpen(false)}
        thread={activeThread}
        existingAllocations={threadDetail?.allocations ?? []}
        onAllocated={handleAllocated}
      />

      {/* Bulk allocate — allocate all selected emails to the same client(s). */}
      <AllocateModal
        open={!!bulkAllocateThreads}
        onClose={() => setBulkAllocateThreads(null)}
        bulkThreads={bulkAllocateThreads}
        onAllocated={() => {
          // Show the green allocation bar on each affected thread immediately.
          const affected = bulkAllocateThreads ?? [];
          setThreadMeta(prev => {
            const next = { ...prev };
            affected.forEach(t => {
              next[t.id] = { ...(next[t.id] ?? { hasAllocation: false, hasTaskLink: false }), hasAllocation: true };
            });
            return next;
          });
          // Sync the firm-wide set so a later refetch keeps the markers.
          setAllocThreadIds(prev => {
            const next = new Set(prev);
            affected.forEach(t => next.add(t.gmailThreadId ?? t.id));
            return next;
          });
          setBulkAllocateThreads(null);
          showToast('success', `Allocated ${affected.length} email${affected.length !== 1 ? 's' : ''}`);
        }}
      />

      <EmailRulesModal
        open={rulesOpen}
        onClose={() => {
          setRulesOpen(false);
          // Reload rules after editing
          fetch('/api/email/rules')
            .then(r => r.ok ? r.json() : { rules: [] })
            .then((d: { rules: EmailRule[] }) => setEmailRules(d.rules ?? []))
            .catch(() => {});
        }}
        labels={labels}
      />

      {showQuickTask && (
        <QuickTaskModal
          onClose={() => setShowQuickTask(false)}
          onCreate={handleTaskCreated}
          teamMembers={teamMembers}
          defaultTitle={taskSuggestedTitle}
          defaultSteps={taskSuggestedSteps}
          defaultDueDate={taskSuggestedDueDate}
          defaultClientId={taskSuggestedClientId}
          defaultClientName={taskSuggestedClientName}
        />
      )}

      {pendingRemoveAllocation && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50"
          onClick={() => { if (!removingAllocation) setPendingRemoveAllocation(null); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-allocation-title"
        >
          <div
            className="w-full max-w-md bg-[var(--bg-card-solid)] rounded-xl shadow-2xl border border-[var(--border)] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border)]">
              <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 id="remove-allocation-title" className="text-sm font-semibold text-[var(--text-primary)]">
                  Remove allocation?
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  This will unallocate the entire conversation, not just one email.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 text-sm text-[var(--text-primary)] space-y-2">
              <p>
                Every email in this thread is allocated to{' '}
                <span className="font-semibold">{pendingRemoveAllocation.clientName}</span>, and each one has its own entry on the client&apos;s timeline.
              </p>
              <p className="text-[var(--text-muted)]">
                Removing the allocation will delete <span className="font-medium text-[var(--text-primary)]">all</span> of those timeline entries for this conversation. This can&apos;t be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-subtle)] rounded-b-xl">
              <button
                onClick={() => setPendingRemoveAllocation(null)}
                disabled={removingAllocation}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmRemoveAllocation()}
                disabled={removingAllocation}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                {removingAllocation && <Loader2 size={12} className="animate-spin" />}
                Remove allocation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
