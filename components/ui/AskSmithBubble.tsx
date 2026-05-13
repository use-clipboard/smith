'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, MessageSquare, Sparkles, Paperclip, FileText, Image, Undo2, Loader2, Check } from 'lucide-react';
import Tooltip from './Tooltip';
import AgentHatIcon from './AgentHatIcon';
import AgentPreview, { MarkdownText, type AgentProposal, type AgentReport } from './AgentPreview';

interface Attachment {
  name: string;
  mimeType: string;
  base64: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

export default function AskSmithBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Agent mode (admin-only) ────────────────────────────────────────────────
  const [agentMode, setAgentMode] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [report, setReport]     = useState<AgentReport   | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedSummary, setAppliedSummary] = useState<string | null>(null);
  const [lastActionId, setLastActionId] = useState<string | null>(null);
  const [undoToastTimer, setUndoToastTimer] = useState<number | null>(null);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Fetch role once to gate the Agent toggle
  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.userRole === 'admin') setIsAdmin(true); })
      .catch(() => {});
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setAttachments(prev => [...prev, ...files].slice(0, 5));
    e.target.value = '';
  }

  function removeAttachment(index: number) {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }

  function toggleAgentMode() {
    if (!isAdmin) return;
    setAgentMode(m => !m);
    // Clear any previous state when switching modes — keeps things tidy
    setMessages([]);
    setProposal(null);
    setReport(null);
    setAppliedSummary(null);
  }

  async function sendAgentMessage(userText: string) {
    const newMessages = [...messages, { role: 'user' as const, content: userText }];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);
    setMessages(m => [...m, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Failed to reach Agent Smith' }));
        setMessages(m => {
          const u = [...m];
          u[u.length - 1] = { role: 'assistant', content: `**Error:** ${err.error ?? 'Failed to reach Agent Smith'}` };
          return u;
        });
        return;
      }
      // SSE stream: each `data: { ... }` line is a JSON event
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          let evt: { type: string; [k: string]: unknown };
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === 'text') {
            const text = String(evt.text ?? '');
            setMessages(m => {
              const u = [...m];
              u[u.length - 1] = { role: 'assistant', content: u[u.length - 1].content + text };
              return u;
            });
          } else if (evt.type === 'ui') {
            const update = evt.update as { kind: string; [k: string]: unknown };
            if (update.kind === 'proposal') {
              const p = update.proposal as { id: string; kind: AgentProposal['kind']; summary: string; affectedCount: number };
              const sample = (update.sample as Array<Record<string, unknown>>) ?? [];
              setProposal({
                id: p.id, kind: p.kind, summary: p.summary, affectedCount: p.affectedCount, sample,
              });
              setReport(null);
              setAppliedSummary(null);
            } else if (update.kind === 'report') {
              setReport(update.report as AgentReport);
              setProposal(null);
              setAppliedSummary(null);
            }
          } else if (evt.type === 'error') {
            setMessages(m => {
              const u = [...m];
              u[u.length - 1] = { role: 'assistant', content: u[u.length - 1].content + `\n\n**Error:** ${String(evt.error)}` };
              return u;
            });
          }
        }
      }
    } finally {
      setIsStreaming(false);
    }
  }

  async function sendAskMessage(userText: string, encodedAttachments: Attachment[]) {
    const userMessage: Message = {
      role: 'user',
      content: userText,
      attachments: encodedAttachments.length > 0 ? encodedAttachments : undefined,
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setAttachments([]);
    setIsStreaming(true);
    setMessages(m => [...m, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok || !res.body) throw new Error('Failed to get response');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        setMessages(m => {
          const updated = [...m];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: updated[updated.length - 1].content + chunk,
          };
          return updated;
        });
      }
    } catch {
      setMessages(m => {
        const updated = [...m];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  async function sendMessage() {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;

    if (agentMode) {
      await sendAgentMessage(input.trim());
      return;
    }

    const encodedAttachments: Attachment[] = await Promise.all(
      attachments.map(async f => {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        return { name: f.name, mimeType: f.type || 'application/octet-stream', base64 };
      })
    );
    await sendAskMessage(input.trim(), encodedAttachments);
  }

  async function confirmProposal() {
    if (!proposal) return;
    setApplying(true);
    try {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')?.content?.slice(0, 500) ?? null;
      const res = await fetch('/api/agent/actions/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.id, plainDescription: lastAssistant }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages(m => [...m, { role: 'assistant', content: `**Apply failed:** ${data.error}` }]);
        return;
      }
      setAppliedSummary(data.summary);
      setLastActionId(data.actionId);
      setProposal(null);
      setShowUndoToast(true);
      if (undoToastTimer) window.clearTimeout(undoToastTimer);
      const t = window.setTimeout(() => setShowUndoToast(false), 30_000);
      setUndoToastTimer(t);
      setMessages(m => [...m, { role: 'assistant', content: `✅ Applied — ${data.summary}. ${data.affectedCount} row${data.affectedCount !== 1 ? 's' : ''} changed. You can undo within 24 hours from Settings → Agent Smith.` }]);
    } finally {
      setApplying(false);
    }
  }

  function cancelProposal() {
    setProposal(null);
    setMessages(m => [...m, { role: 'assistant', content: 'Cancelled — no changes were made.' }]);
  }

  async function undoLast() {
    if (!lastActionId) return;
    setUndoing(true);
    try {
      const res = await fetch(`/api/agent/actions/${lastActionId}/undo`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setMessages(m => [...m, { role: 'assistant', content: `**Undo failed:** ${data.error}` }]);
        return;
      }
      setAppliedSummary(null);
      setLastActionId(null);
      setShowUndoToast(false);
      setMessages(m => [...m, { role: 'assistant', content: `↩ Undone — ${data.summary}. The data has been restored to its prior state.` }]);
    } finally {
      setUndoing(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const isAgent = agentMode && isAdmin;
  const windowCls = isAgent
    ? 'fixed bottom-24 right-6 z-50 w-[min(1100px,calc(100vw-3rem))] h-[min(720px,calc(100vh-8rem))] flex rounded-2xl overflow-hidden shadow-dropdown border border-[var(--border-card)] bg-[var(--bg-card-solid)] animate-slide-up'
    : 'fixed bottom-24 right-6 z-50 w-[360px] max-h-[560px] flex flex-col rounded-2xl overflow-hidden shadow-dropdown border border-[var(--border-card)] bg-[var(--bg-card-solid)] animate-slide-up';

  return (
    <>
      {open && (
        <div className={windowCls}>
          {/* Chat column */}
          <div className={`flex flex-col min-h-0 ${isAgent ? 'w-[400px] border-r border-[var(--border)]' : 'flex-1'}`}>
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b border-[var(--border)] ${isAgent ? 'bg-gray-900' : 'bg-[var(--accent)]'}`}>
              <div className="flex items-center gap-2 min-w-0">
                {isAgent
                  ? <AgentHatIcon size={18} className="text-white" />
                  : <Sparkles size={16} className="text-white" />}
                <span className="text-sm font-semibold text-white truncate">{isAgent ? 'Agent Smith' : 'Ask Smith'}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${isAgent ? 'bg-white/15 text-amber-200' : 'bg-white/10 text-indigo-200'}`}>
                  {isAgent ? 'Admin · changes data' : 'AI Assistant'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <Tooltip label={isAgent ? 'Switch to Ask Smith' : 'Switch to Agent Smith (admin only)'} side="bottom">
                    <button
                      onClick={toggleAgentMode}
                      aria-label="Toggle agent mode"
                      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${isAgent ? 'bg-amber-400' : 'bg-white/30'}`}
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${isAgent ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </Tooltip>
                )}
                <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3 min-h-0">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${isAgent ? 'bg-gray-100' : 'bg-[var(--accent-light)]'}`}>
                    {isAgent
                      ? <AgentHatIcon size={22} className="text-gray-700" />
                      : <MessageSquare size={22} className="text-[var(--accent)]" />}
                  </div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {isAgent ? 'What can I change for you?' : 'How can I help you?'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[260px]">
                    {isAgent
                      ? 'Ask for reports or bulk changes (tasks, clients). I\'ll always preview before saving.'
                      : 'Ask about UK accounting, bookkeeping, tax, or how to use SMITH.'}
                  </p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed
                    ${msg.role === 'user'
                      ? (isAgent ? 'bg-gray-900 text-white' : 'bg-[var(--accent)] text-white')
                      : 'bg-[var(--bg-nav-hover)] text-[var(--text-primary)] border border-[var(--border)]'
                    }`}>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {msg.attachments.map((a, ai) => (
                          <span key={ai} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/20 rounded text-xs">
                            {a.mimeType.startsWith('image/') ? <Image size={10} /> : <FileText size={10} />}
                            {a.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">
                      {msg.content
                        ? (msg.role === 'assistant' ? <MarkdownText text={msg.content} /> : msg.content)
                        : (isStreaming && i === messages.length - 1 && msg.role === 'assistant' ? '…' : '')}
                      {isStreaming && i === messages.length - 1 && msg.role === 'assistant' && msg.content && (
                        <span className={`inline-block w-1 h-3.5 rounded-sm ml-0.5 animate-pulse align-text-bottom ${isAgent ? 'bg-gray-900' : 'bg-[var(--accent)]'}`} />
                      )}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-[var(--border)]">
              {!isAgent && attachments.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {attachments.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-[var(--accent-light)] border border-[var(--accent)]/30 rounded text-xs text-[var(--accent)] font-medium">
                      {f.type.startsWith('image/') ? <Image size={10} /> : <FileText size={10} />}
                      <span className="max-w-[120px] truncate">{f.name}</span>
                      <button type="button" onClick={() => removeAttachment(i)} className="p-0.5 hover:opacity-70">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-end">
                {!isAgent && (
                  <>
                    <Tooltip label="Attach a file" side="top" className="shrink-0">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isStreaming || attachments.length >= 5}
                        aria-label="Attach a file"
                        className="h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors disabled:opacity-40"
                      >
                        <Paperclip size={14} />
                      </button>
                    </Tooltip>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </>
                )}

                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isAgent ? 'Try "Reassign all Self Assessment tasks from Anna to Ben"' : 'Ask a question…'}
                  rows={1}
                  disabled={isStreaming}
                  className="flex-1 input-base resize-none min-h-[38px] max-h-[120px] py-2 text-sm"
                  style={{ height: 'auto' }}
                  onInput={e => {
                    const t = e.currentTarget;
                    t.style.height = 'auto';
                    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
                  }}
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={(!input.trim() && (isAgent || attachments.length === 0)) || isStreaming}
                  className={`h-[38px] px-3 shrink-0 rounded-lg text-white transition-colors disabled:opacity-50 ${isAgent ? 'bg-gray-900 hover:bg-gray-800' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'}`}
                >
                  {isStreaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </div>

          {/* Preview column (agent mode only) */}
          {isAgent && (
            <div className="flex-1 min-w-0 bg-gray-50">
              <AgentPreview
                proposal={proposal}
                report={report}
                applying={applying}
                appliedSummary={appliedSummary}
                onConfirm={confirmProposal}
                onCancel={cancelProposal}
              />
            </div>
          )}
        </div>
      )}

      {/* Undo toast */}
      {showUndoToast && lastActionId && (
        <div className="fixed bottom-6 right-24 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-600 text-white shadow-2xl animate-slide-up">
          <Check size={16} />
          <span className="text-sm font-medium">{appliedSummary ?? 'Change applied'}</span>
          <button
            onClick={undoLast}
            disabled={undoing}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {undoing ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />} Undo
          </button>
          <button onClick={() => setShowUndoToast(false)} className="text-white/70 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Open Ask Smith chat"
        className={`fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-dropdown transition-all duration-200
          ${open
            ? 'bg-[var(--text-primary)] text-[var(--bg-page)] scale-95'
            : 'bg-[#1A1A2E] dark:bg-white text-white dark:text-[#0F0F1A] hover:scale-105 hover:shadow-accent-glow'
          }`}
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>
    </>
  );
}

