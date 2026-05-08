'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Mail, PenSquare, Loader2, Settings, Settings2 } from 'lucide-react';
import EmailSidebar from './EmailSidebar';
import EmailList from './EmailList';
import EmailThread from './EmailThread';
import ComposeModal from './ComposeModal';
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
}

const POLL_INTERVAL_MS = 30_000;

export default function EmailTriagePage() {
  const { isModuleActive } = useModules();
  const tasksModuleActive = isModuleActive('tasks');
  const [userName, setUserName] = useState('');
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

  const [activeThread, setActiveThread] = useState<EmailThreadType | null>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [threadMeta, setThreadMeta] = useState<Record<string, { hasAllocation: boolean; hasTaskLink: boolean; isReplied?: boolean; isForwarded?: boolean; reactions?: string[] }>>({});

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  // Track which inbox threads have been forwarded (persisted locally)
  const [forwardedThreadIds, setForwardedThreadIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('email-forwarded-ids');
      return stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  // Track which inbox threads have been replied to (persisted locally)
  const [repliedThreadIds, setRepliedThreadIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('email-replied-ids');
      return stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  // Email rules
  const [emailRules, setEmailRules] = useState<EmailRule[]>([]);
  const [rulesOpen, setRulesOpen]   = useState(false);

  const [signature, setSignature] = useState<string | null>(null);
  const [signatureDisplayName, setSignatureDisplayName] = useState('');

  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<EmailMessage | null>(null);
  const [replyAllRecipients, setReplyAllRecipients] = useState<{ to: { name: string; email: string }[]; cc: { name: string; email: string }[] } | null>(null);
  const [forwardOf, setForwardOf] = useState<EmailMessage | null>(null);
  const [prefilledBody, setPrefilledBody] = useState<string | null>(null);
  const [draftingAIReply, setDraftingAIReply] = useState(false);
  const [defaultClients, setDefaultClients] = useState<Client[] | null>(null);
  const [allocateOpen, setAllocateOpen] = useState(false);

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

  // Load signature
  useEffect(() => {
    if (!connected) return;
    fetch('/api/email/signature')
      .then(r => r.json())
      .then((data: { signature: string | null; displayName: string | null }) => {
        setSignature(data.signature ?? null);
        setSignatureDisplayName(data.displayName ?? userName);
      })
      .catch(() => {});
  }, [connected, userName]);

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
      const base = q
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
      const newThreads = data.threads ?? [];
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
  }, [searchQuery, unreadOnly]);

  // Fetch threads when label, search, or unread filter changes
  useEffect(() => {
    if (!connected) return;
    setActiveThread(null);
    setThreadDetail(null);
    setFetchError(null);
    fetchThreads(activeLabel);
  }, [connected, activeLabel, searchQuery, unreadOnly, fetchThreads]);

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
    setActiveThread(thread);
    setThreadDetail(null);
    setLoadingDetail(true);
    try {
      // In non-threaded view, gmailThreadId holds the real thread ID; fall back to id
      const detailId = thread.gmailThreadId ?? thread.id;
      const res = await fetch(`/api/email/thread/${detailId}`);
      const data = await res.json() as ThreadDetail;
      setThreadDetail(data);
      // Detect replied / forwarded from the full thread messages
      const sentMsgs = data.messages.filter((m: { labelIds?: string[] }) => m.labelIds?.includes('SENT'));
      const hasInbound = data.messages.some((m: { labelIds?: string[] }) => !m.labelIds?.includes('SENT'));
      // isReplied: there are received messages AND at least one sent message that is not a forward
      const isReplied = hasInbound && sentMsgs.length > 0
        && sentMsgs.some((m: { subject?: string }) => !/^fwd:/i.test(m.subject ?? ''));
      const isForwarded = sentMsgs.some((m: { subject?: string }) => /^fwd:/i.test(m.subject ?? ''))
        || forwardedThreadIds.has(thread.gmailThreadId ?? thread.id);
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
      if (isReplied) {
        setRepliedThreadIds(prev => {
          if (prev.has(realId)) return prev;
          const next = new Set(prev);
          next.add(realId);
          try { localStorage.setItem('email-replied-ids', JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
        });
      }
      if (isForwarded) {
        setForwardedThreadIds(prev => {
          if (prev.has(realId)) return prev;
          const next = new Set(prev);
          next.add(realId);
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
    setPrefilledBody(null);
    setReplyAllRecipients(null);
    setForwardOf(null);
    setDefaultClients(getAllocatedClients());
    setReplyTo(message);
    setComposeOpen(true);
  }

  function handleReplyAll(message: EmailMessage) {
    setPrefilledBody(null);
    setForwardOf(null);
    // Build To: original sender (excluding self)
    const replyTo_list = [message.from]
      .concat(message.to.filter(a => a.email.toLowerCase() !== googleEmail.toLowerCase()))
      .filter((a, i, arr) => arr.findIndex(x => x.email === a.email) === i);
    // Build CC: original CC (excluding self)
    const replyCC = message.cc.filter(a => a.email.toLowerCase() !== googleEmail.toLowerCase());
    setReplyAllRecipients({ to: replyTo_list, cc: replyCC });
    setDefaultClients(getAllocatedClients());
    setReplyTo(message);
    setComposeOpen(true);
  }

  function handleForward(message: EmailMessage) {
    setReplyTo(null);
    setReplyAllRecipients(null);
    setPrefilledBody(null);
    setDefaultClients(getAllocatedClients());
    setForwardOf(message);
    setComposeOpen(true);
  }

  async function handleAIDraftReply(message: EmailMessage) {
    setReplyAllRecipients(null);
    setForwardOf(null);
    setDefaultClients(getAllocatedClients());
    setDraftingAIReply(true);
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
      setPrefilledBody(data.result ?? null);
    } catch {
      setPrefilledBody(null);
    } finally {
      setDraftingAIReply(false);
      setReplyTo(message);
      setComposeOpen(true);
    }
  }

  function handleAllocated(clientIds: string[]) {
    if (activeThread) {
      setThreadMeta(prev => ({ ...prev, [activeThread.id]: { ...prev[activeThread.id], hasAllocation: true } }));
      openThread(activeThread);
    }
  }

  async function handleRemoveAllocation(clientId: string) {
    if (!activeThread) return;
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
    setForwardedThreadIds(prev => {
      const next = new Set(prev);
      next.add(originalThreadId);
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
    setRepliedThreadIds(prev => {
      const next = new Set(prev);
      next.add(originalThreadId);
      try { localStorage.setItem('email-replied-ids', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  async function handleTaskCreated(data: CreateTaskData) {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
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
    }

    setShowQuickTask(false);
  }

  function handleDelete() {
    if (!activeThread) return;
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
    setThreads(prev => prev.filter(t => t.id !== threadId));
    if (activeThread?.id === threadId) {
      setActiveThread(null);
      setThreadDetail(null);
    }
    fetch('/api/email/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId }),
    }).catch(() => {});
  }

  function handleBulkDelete(ids: string[]) {
    setThreads(prev => prev.filter(t => !ids.includes(t.id)));
    if (activeThread && ids.includes(activeThread.id)) {
      setActiveThread(null);
      setThreadDetail(null);
    }
    // Fire-and-forget trash for each
    ids.forEach(threadId =>
      fetch('/api/email/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      }).catch(() => {})
    );
  }

  function handleMarkRead(threadId: string, markAsRead: boolean) {
    // Optimistic update
    setThreads(prev => prev.map(t =>
      t.id === threadId
        ? { ...t, isRead: markAsRead, labelIds: markAsRead ? t.labelIds.filter(l => l !== 'UNREAD') : [...t.labelIds.filter(l => l !== 'UNREAD'), 'UNREAD'] }
        : t
    ));
    fetch('/api/email/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        removeLabelIds: markAsRead ? ['UNREAD'] : [],
        addLabelIds: markAsRead ? [] : ['UNREAD'],
      }),
    }).catch(() => {});
  }

  function handleBulkMarkRead(ids: string[]) {
    // Optimistically mark as read in state
    setThreads(prev => prev.map(t =>
      ids.includes(t.id)
        ? { ...t, isRead: true, labelIds: t.labelIds.filter(l => l !== 'UNREAD') }
        : t
    ));
    // Fire-and-forget mark-read for each
    ids.forEach(threadId =>
      fetch('/api/email/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, removeLabelIds: ['UNREAD'], addLabelIds: [] }),
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
    <div className="flex h-full overflow-hidden">
      {/* Labels sidebar */}
      <div style={{ width: sidebarWidth }} className="shrink-0 overflow-y-auto bg-[var(--bg-card-solid)]">
        <div className="p-3 border-b border-[var(--border)] space-y-2">
          <button
            onClick={() => { setReplyTo(null); setComposeOpen(true); }}
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
        title="Drag to resize"
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
          onBulkDelete={handleBulkDelete}
          onBulkMarkRead={handleBulkMarkRead}
        />
      </div>

      {/* Drag handle — thread list / detail */}
      <div
        className="w-1 shrink-0 cursor-col-resize bg-[var(--border)] hover:bg-[var(--accent)]/50 transition-colors"
        onMouseDown={e => startColDrag('threadlist', e)}
        title="Drag to resize"
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
      <ComposeModal
        open={composeOpen}
        onClose={() => { setComposeOpen(false); setReplyTo(null); setReplyAllRecipients(null); setForwardOf(null); setPrefilledBody(null); setDefaultClients(null); }}
        replyTo={replyTo}
        replyAllRecipients={replyAllRecipients}
        forwardOf={forwardOf}
        defaultClients={defaultClients}
        prefilledBody={prefilledBody}
        threadMessages={replyTo || forwardOf ? (activeThread?.messages ?? threadDetail?.messages ?? null) : null}
        signature={signature}
        googleEmail={googleEmail}
        displayName={signatureDisplayName || userName}
        tasksModuleActive={tasksModuleActive}
        onSent={() => fetchThreads(activeLabel)}
        onForwardSent={handleForwardSent}
        onReplySent={handleReplySent}
        onCreateTaskFromSent={handleCreateTaskFromSent}
      />

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
    </div>
  );
}
