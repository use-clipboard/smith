'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Mail, PenSquare, Loader2, Settings } from 'lucide-react';
import EmailSidebar from './EmailSidebar';
import EmailList from './EmailList';
import EmailThread from './EmailThread';
import ComposeModal from './ComposeModal';
import AllocateModal from './AllocateModal';
import TaskLinkModal from './TaskLinkModal';
import { useModules } from '@/components/ui/ModulesProvider';
import { createClient } from '@/lib/supabase';
import type { EmailThread as EmailThreadType, EmailMessage, GmailLabel } from '@/lib/gmail';
import type { Client } from './AllocateModal';

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

  const [activeThread, setActiveThread] = useState<EmailThreadType | null>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [threadMeta, setThreadMeta] = useState<Record<string, { hasAllocation: boolean; hasTaskLink: boolean }>>({});

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

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
  const [taskLinkOpen, setTaskLinkOpen] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const fetchThreads = useCallback(async (label: string, pageToken?: string) => {
    if (pageToken) setLoadingMore(true);
    else setLoadingThreads(true);
    try {
      const base = searchQuery
        ? `/api/email/threads?q=${encodeURIComponent(searchQuery)}`
        : `/api/email/threads?label=${encodeURIComponent(label)}`;
      const url = `${base}${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const res = await fetch(url);
      const data = await res.json() as { threads?: EmailThreadType[]; nextPageToken?: string | null; error?: string };
      if (!res.ok) {
        if (!pageToken) setFetchError(data.error ?? `Error ${res.status}`);
        return;
      }
      setFetchError(null);
      if (pageToken) {
        setThreads(prev => [...prev, ...(data.threads ?? [])]);
      } else {
        setThreads(data.threads ?? []);
      }
      setNextPageToken(data.nextPageToken ?? null);
    } catch (err) {
      if (!pageToken) setFetchError('Could not reach the server. Please try again.');
    } finally {
      setLoadingThreads(false);
      setLoadingMore(false);
    }
  }, [searchQuery]);

  // Fetch threads when label or search changes
  useEffect(() => {
    if (!connected) return;
    setActiveThread(null);
    setThreadDetail(null);
    setFetchError(null);
    fetchThreads(activeLabel);
  }, [connected, activeLabel, searchQuery, fetchThreads]);

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
      const res = await fetch(`/api/email/thread/${thread.id}`);
      const data = await res.json() as ThreadDetail;
      setThreadDetail(data);
      setThreadMeta(prev => ({
        ...prev,
        [thread.id]: {
          hasAllocation: data.allocations.length > 0,
          hasTaskLink: data.taskLinks.length > 0,
        },
      }));
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
      body: JSON.stringify({ threadId: activeThread.id, clientId }),
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
      body: JSON.stringify({ threadId: activeThread.id, taskId }),
    });
    await openThread(activeThread);
    setThreadMeta(prev => {
      const current = prev[activeThread.id];
      const remaining = (threadDetail?.taskLinks ?? []).filter(t => t.task_id !== taskId);
      return { ...prev, [activeThread.id]: { ...current, hasTaskLink: remaining.length > 0 } };
    });
  }

  function handleLinkedTask() {
    if (activeThread) {
      setThreadMeta(prev => ({ ...prev, [activeThread.id]: { ...prev[activeThread.id], hasTaskLink: true } }));
      openThread(activeThread);
    }
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
      <div className="w-48 shrink-0 border-r border-[var(--border)] overflow-y-auto bg-[var(--bg-card-solid)]">
        <div className="p-3 border-b border-[var(--border)]">
          <button
            onClick={() => { setReplyTo(null); setComposeOpen(true); }}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            <PenSquare size={14} /> Compose
          </button>
        </div>
        <EmailSidebar
          labels={labels}
          activeLabel={activeLabel}
          onSelectLabel={label => setActiveLabel(label)}
          onLabelCreated={label => setLabels(prev => [...prev, label])}
        />
      </div>

      {/* Thread list */}
      <div className="w-72 shrink-0 border-r border-[var(--border)] overflow-hidden flex flex-col bg-[var(--bg-card-solid)]">
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
          onRefresh={() => { setFetchError(null); fetchThreads(activeLabel); }}
          hasNextPage={!!nextPageToken}
          onLoadMore={() => nextPageToken && fetchThreads(activeLabel, nextPageToken)}
          loadingMore={loadingMore}
          pinnedIds={pinnedIds}
          onPin={handlePin}
        />
      </div>

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
            allocations={threadDetail.allocations}
            taskLinks={threadDetail.taskLinks}
            googleEmail={threadDetail.googleEmail || googleEmail}
            tasksModuleActive={tasksModuleActive}
            labels={labels}
            onAllocate={() => setAllocateOpen(true)}
            onLinkTask={() => setTaskLinkOpen(true)}
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
        signature={signature}
        googleEmail={googleEmail}
        displayName={signatureDisplayName || userName}
        tasksModuleActive={tasksModuleActive}
        onSent={() => fetchThreads(activeLabel)}
      />

      <AllocateModal
        open={allocateOpen}
        onClose={() => setAllocateOpen(false)}
        thread={activeThread}
        existingAllocations={threadDetail?.allocations ?? []}
        onAllocated={handleAllocated}
      />

      <TaskLinkModal
        open={taskLinkOpen}
        onClose={() => setTaskLinkOpen(false)}
        thread={activeThread}
        existingLinks={threadDetail?.taskLinks ?? []}
        onLinked={handleLinkedTask}
      />
    </div>
  );
}
