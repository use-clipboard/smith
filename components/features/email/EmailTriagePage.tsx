'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Mail, PenSquare, Loader2, Settings, Settings2, X, AlertTriangle } from 'lucide-react';
import EmailSidebar from './EmailSidebar';
import EmailList from './EmailList';
import EmailThread from './EmailThread';
import { useComposeWindow } from './ComposeWindowProvider';
import { EMAIL_SENT_EVENT } from './GlobalComposeWindow';
import AllocateModal from './AllocateModal';
import EmailRulesModal from './EmailRulesModal';
import QuickTaskModal from '@/components/features/tasks/QuickTaskModal';
import type { CreateTaskData } from '@/components/features/tasks/CreateTaskModal';
import { useModules } from '@/components/ui/ModulesProvider';
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
}

const POLL_INTERVAL_MS = 30_000;

export default function EmailTriagePage() {
  const { isModuleActive } = useModules();
  const tasksModuleActive = isModuleActive('tasks');
  const [userName, setUserName] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [googleEmail, setGoogleEmail] = useState('');
  const [activeLabel, setActiveLabel] = useState('INBOX');
  const [showAsThreads, setShowAsThreads] = useState(true);

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

  const [activeThread, setActiveThread] = useState<EmailThreadType | null>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [threadMeta, setThreadMeta] = useState<Record<string, { hasAllocation: boolean; hasTaskLink: boolean; isReplied?: boolean; isForwarded?: boolean; reactions?: string[] }>>({});

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  // Track which inbox threads have been forwarded (persisted locally)
  const [forwardedThreadIds, setForwardedThreadIds] = useState<Map<string, string>>(() => {
    if (typeof window === 'undefined') return new Map();
    try {
      const stored = localStorage.getItem('email-forwarded-ids');
      if (!stored) return new Map();
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        return new Map(
          parsed.map(entry =>
            typeof entry === 'string'
              ? [entry, ''] as const
              : Array.isArray(entry)
                ? [entry[0] as string, (entry[1] as string) ?? ''] as const
                : ['', ''] as const,
          ).filter(([id]) => id),
        );
      }
      return new Map();
    } catch { return new Map(); }
  });

  // Track which inbox threads have been replied to (persisted locally)
  // Persisted as [id, isoDate][] tuples so we can show "Replied · 9 May" right
  // after sending — without waiting for the next inbox poll to fetch the SENT
  // message back from Gmail. Backwards-compatible with the old Set<string>
  // format (just an array of IDs without dates).
  const [repliedThreadIds, setRepliedThreadIds] = useState<Map<string, string>>(() => {
    if (typeof window === 'undefined') return new Map();
    try {
      const stored = localStorage.getItem('email-replied-ids');
      if (!stored) return new Map();
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        return new Map(
          parsed.map(entry =>
            typeof entry === 'string'
              ? [entry, ''] as const           // legacy format — no date
              : Array.isArray(entry)            // new format — [id, date]
                ? [entry[0] as string, (entry[1] as string) ?? ''] as const
                : ['', ''] as const,
          ).filter(([id]) => id),
        );
      }
      return new Map();
    } catch { return new Map(); }
  });

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

  // Transient banner used to surface non-blocking results (e.g. forward-email failure)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  function showToast(kind: 'success' | 'error', message: string) {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 5000);
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
        setShowAsThreads(data.showAsThreads ?? true);
      })
      .catch(() => setConnected(false));
  }, []);

  // Load labels
  useEffect(() => {
    if (!connected) return;
    fetch('/api/email/labels')
      .then(r => r.json())
      .then((data: { labels: GmailLabel[] }) => setLabels(data.labels ?? []))
      .catch(() => {});
  }, [connected]);

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
  // through each thread first.
  useEffect(() => {
    if (!connected) return;
    fetch('/api/email/thread-meta')
      .then(r => r.ok ? r.json() : null)
      .then((data: { allocatedThreadIds?: string[]; taskLinkedThreadIds?: string[] } | null) => {
        if (!data) return;
        const allocSet = new Set(data.allocatedThreadIds ?? []);
        const taskSet = new Set(data.taskLinkedThreadIds ?? []);
        const allIds = new Set<string>([...allocSet, ...taskSet]);
        setThreadMeta(prev => {
          const next = { ...prev };
          for (const id of allIds) {
            next[id] = {
              ...(next[id] ?? {}),
              hasAllocation: allocSet.has(id),
              hasTaskLink: taskSet.has(id),
            };
          }
          return next;
        });
      })
      .catch(() => {});
  }, [connected]);

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
      let q = searchQuery;
      if (unreadOnly) {
        q = q ? `${q} is:unread` : 'is:unread';
        // Map the active label to its Gmail query equivalent so archived/other
        // folder emails are excluded even when switching to query mode.
        const labelScope: Record<string, string> = {
          INBOX:   'in:inbox',
          SENT:    'in:sent',
          STARRED: 'is:starred',
          SPAM:    'in:spam',
          TRASH:   'in:trash',
          DRAFT:   'in:drafts',
        };
        const scope = labelScope[label] ?? `label:${label.toLowerCase().replace(/\s+/g, '-')}`;
        q = `${q} ${scope}`;
      }
      // Task-linked / allocated filters bypass Gmail's label/search and pull from
      // our DB tables instead — same UX as the unread filter (inbox-wide).
      const dbFilterParams: string[] = [];
      if (taskLinkedOnly) dbFilterParams.push('taskLinkedOnly=true');
      if (allocatedOnly) dbFilterParams.push('allocatedOnly=true');
      const base = dbFilterParams.length > 0
        ? `/api/email/threads?${dbFilterParams.join('&')}`
        : q
          ? `/api/email/threads?q=${encodeURIComponent(q)}`
          : `/api/email/threads?label=${encodeURIComponent(label)}`;
      const url = `${base}${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const res = await fetch(url);
      const data = await res.json() as { threads?: EmailThreadType[]; nextPageToken?: string | null; error?: string };
      if (!res.ok) {
        if (!pageToken) setFetchError(data.error ?? `Error ${res.status}`);
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
        setThreads(prev => [...prev, ...newThreads]);
      } else {
        setThreads(newThreads);
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
  }, [searchQuery, unreadOnly, taskLinkedOnly, allocatedOnly]);

  // Fetch threads when label, search, or any active filter changes
  useEffect(() => {
    if (!connected) return;
    setActiveThread(null);
    setThreadDetail(null);
    setFetchError(null);
    fetchThreads(activeLabel);
  }, [connected, activeLabel, searchQuery, unreadOnly, taskLinkedOnly, allocatedOnly, fetchThreads]);

  // Start polling (skip during active search to avoid disrupting results)
  useEffect(() => {
    if (!connected || searchQuery) return;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => fetchThreads(activeLabel), POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
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
      // In non-threaded view, gmailThreadId holds the real thread ID; fall back to id
      const detailId = thread.gmailThreadId ?? thread.id;
      const res = await fetch(`/api/email/thread/${detailId}`);
      const data = await res.json() as ThreadDetail;
      setThreadDetail(data);
      // Detect replied / forwarded from the full thread messages.
      // Gmail uses "Fwd:" prefix; Outlook uses "FW:" — match both.
      const FORWARD_PREFIX = /^(fwd|fw):/i;
      const sentMsgs = data.messages.filter((m: { labelIds?: string[] }) => m.labelIds?.includes('SENT'));
      const hasInbound = data.messages.some((m: { labelIds?: string[] }) => !m.labelIds?.includes('SENT'));
      // isReplied: there are received messages AND at least one sent message that is not a forward
      const isReplied = hasInbound && sentMsgs.length > 0
        && sentMsgs.some((m: { subject?: string }) => !FORWARD_PREFIX.test(m.subject ?? ''));
      const isForwarded = sentMsgs.some((m: { subject?: string }) => FORWARD_PREFIX.test(m.subject ?? ''))
        || forwardedThreadIds.has(thread.gmailThreadId ?? thread.id)
        || !!data.externalForwardedAt;
      setThreadMeta(prev => ({
        ...prev,
        [thread.id]: {
          hasAllocation: data.allocations.length > 0,
          hasTaskLink: data.taskLinks.length > 0,
          isReplied,
          isForwarded,
        },
      }));
      // Persist detected reply/forward status to localStorage so it survives page refreshes
      const realId = thread.gmailThreadId ?? thread.id;
      // Pick the most recent matching SENT message's date so the chip can read
      // a real timestamp (vs the stale "" placeholder).
      function pickLatest(msgs: { subject?: string; date?: string }[], wantForward: boolean): string {
        const matches = msgs.filter(m =>
          wantForward
            ?  FORWARD_PREFIX.test(m.subject ?? '')
            : !FORWARD_PREFIX.test(m.subject ?? ''),
        );
        if (matches.length === 0) return '';
        const latest = matches.reduce((acc, m) =>
          (new Date(m.date ?? '').getTime() || 0) > (new Date(acc.date ?? '').getTime() || 0) ? m : acc
        );
        return latest.date ?? '';
      }
      if (isReplied) {
        const date = pickLatest(sentMsgs, false);
        setRepliedThreadIds(prev => {
          if (prev.get(realId) === date) return prev;
          const next = new Map(prev);
          next.set(realId, date);
          try { localStorage.setItem('email-replied-ids', JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
        });
      }
      if (isForwarded) {
        // Prefer the in-thread forward date; fall back to the date found via
        // Sent-folder search when threading was broken on forward.
        const date = pickLatest(sentMsgs, true) || data.externalForwardedAt || '';
        setForwardedThreadIds(prev => {
          if (prev.get(realId) === date) return prev;
          const next = new Map(prev);
          next.set(realId, date);
          try { localStorage.setItem('email-forwarded-ids', JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
        });
      }
      // Mark thread as read in local state
      setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, isRead: true } : t));
    } finally {
      setLoadingDetail(false);
    }
  }

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
      await fetch('/api/email/allocate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: activeThread.gmailThreadId ?? activeThread.id, clientId }),
      });
      await openThread(activeThread);
      setThreadMeta(prev => {
        const current = prev[activeThread.id];
        const remaining = (threadDetail?.allocations ?? []).filter(a => a.client_id !== clientId);
        return { ...prev, [activeThread.id]: { ...current, hasAllocation: remaining.length > 0 } };
      });
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
    setThreadMeta(prev => {
      const current = prev[activeThread.id];
      const remaining = (threadDetail?.taskLinks ?? []).filter(t => t.task_id !== taskId);
      return { ...prev, [activeThread.id]: { ...current, hasTaskLink: remaining.length > 0 } };
    });
  }

  async function handleCreateTaskFromEmail() {
    if (!activeThread) return;
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

  function handleForwardSent(originalThreadId: string) {
    // Immediately show forwarded chip in the list for the active thread
    if (activeThread) {
      setThreadMeta(prev => ({
        ...prev,
        [activeThread.id]: { ...(prev[activeThread.id] ?? { hasAllocation: false, hasTaskLink: false }), isForwarded: true },
      }));
    }
    const sentAt = new Date().toISOString();
    setForwardedThreadIds(prev => {
      const next = new Map(prev);
      next.set(originalThreadId, sentAt);
      try { localStorage.setItem('email-forwarded-ids', JSON.stringify([...next])); } catch { /* ignore */ }
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

  function handleReplySent(originalThreadId: string) {
    // Immediately show replied chip in the list for the active thread
    if (activeThread) {
      setThreadMeta(prev => ({
        ...prev,
        [activeThread.id]: { ...(prev[activeThread.id] ?? { hasAllocation: false, hasTaskLink: false }), isReplied: true },
      }));
    }
    const sentAt = new Date().toISOString();
    setRepliedThreadIds(prev => {
      const next = new Map(prev);
      next.set(originalThreadId, sentAt);
      try { localStorage.setItem('email-replied-ids', JSON.stringify([...next])); } catch { /* ignore */ }
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

  function handleDelete() {
    if (!activeThread) return;
    markPendingTrash([activeThread.id]);
    setThreads(prev => prev.filter(t => t.id !== activeThread.id));
    setActiveThread(null);
    setThreadDetail(null);
  }

  function handleArchive() {
    if (!activeThread) return;
    setThreads(prev => prev.filter(t => t.id !== activeThread.id));
    setActiveThread(null);
    setThreadDetail(null);
  }

  function handleStar(starred: boolean) {
    if (!activeThread) return;
    setThreads(prev => prev.map(t => t.id === activeThread.id ? {
      ...t,
      labelIds: starred
        ? [...t.labelIds.filter(l => l !== 'STARRED'), 'STARRED']
        : t.labelIds.filter(l => l !== 'STARRED'),
    } : t));
  }

  function handleListStar(threadId: string, starred: boolean) {
    setThreads(prev => prev.map(t => t.id === threadId ? {
      ...t,
      labelIds: starred
        ? [...t.labelIds.filter(l => l !== 'STARRED'), 'STARRED']
        : t.labelIds.filter(l => l !== 'STARRED'),
    } : t));
    fetch('/api/email/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
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

  function handleBulkDelete(ids: string[]) {
    markPendingTrash(ids);
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
    setThreads(prev => prev.filter(t => t.id !== activeThread.id));
    setActiveThread(null);
    setThreadDetail(null);
  }

  function handleRestore() {
    if (!activeThread) return;
    setThreads(prev => prev.filter(t => t.id !== activeThread.id));
    setActiveThread(null);
    setThreadDetail(null);
  }

  function handleMarkUnread() {
    if (!activeThread) return;
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

  if (connected === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
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
    <div className="flex h-full overflow-hidden relative">
      {/* Transient toast banner */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 ${
            toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
          }`}
        >
          {toast.message}
          <button onClick={() => setToast(null)} className="ml-2 opacity-80 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Labels sidebar */}
      <div style={{ width: sidebarWidth }} className="shrink-0 overflow-y-auto bg-[var(--bg-card-solid)]">
        <div className="p-3 border-b border-[var(--border)] space-y-2">
          <button
            onClick={() => composeWindow.open()}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            <PenSquare size={14} /> Compose
          </button>
          <button
            onClick={() => setRulesOpen(true)}
            className="w-full text-xs flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
          >
            <Settings2 size={12} /> Rules
          </button>
        </div>
        <EmailSidebar
          labels={labels}
          activeLabel={activeLabel}
          onSelectLabel={label => setActiveLabel(label)}
          onLabelCreated={label => setLabels(prev => [...prev, label])}
        />
      </div>

      {/* Drag handle — sidebar / thread list */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]/50 transition-colors"
        onMouseDown={e => startColDrag('sidebar', e)}
        aria-label="Drag to resize"
      />

      {/* Thread list */}
      <div style={{ width: threadListWidth }} className="shrink-0 overflow-hidden flex flex-col bg-[var(--bg-card-solid)]">
        <EmailList
          threads={sortedThreads}
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
          forwardedThreadIds={forwardedThreadIds}
          repliedThreadIds={repliedThreadIds}
          unreadOnly={unreadOnly}
          onUnreadOnlyChange={v => { setUnreadOnly(v); }}
          taskLinkedOnly={taskLinkedOnly}
          onTaskLinkedOnlyChange={v => { setTaskLinkedOnly(v); if (v) { setAllocatedOnly(false); setUnreadOnly(false); } }}
          allocatedOnly={allocatedOnly}
          onAllocatedOnlyChange={v => { setAllocatedOnly(v); if (v) { setTaskLinkedOnly(false); setUnreadOnly(false); } }}
          activeLabel={activeLabel}
          onBulkDelete={handleBulkDelete}
          onBulkMarkRead={handleBulkMarkRead}
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

      {/* Drag handle — thread list / detail */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]/50 transition-colors"
        onMouseDown={e => startColDrag('threadlist', e)}
        aria-label="Drag to resize"
      />

      {/* Thread detail */}
      <div className="flex-1 overflow-hidden relative">
        {draftingAIReply && (
          <div className="absolute inset-0 z-10 bg-[var(--bg-card-solid)]/70 flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin text-[var(--accent)]" />
            <span className="text-sm text-[var(--text-primary)]">Drafting AI reply…</span>
          </div>
        )}
        {loadingDetail ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
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
            onAllocate={() => setAllocateOpen(true)}
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
