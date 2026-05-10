'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, BookOpen, Pencil, Loader2, AlertTriangle, Trash2 } from 'lucide-react';

type Mode = 'educational' | 'drafting';
interface ChatMessage { role: 'user' | 'assistant'; content: string }

const STARTER_PROMPTS: Record<Mode, string[]> = {
  educational: [
    'What does the Employment Rights Bill 2026 change about probation periods?',
    'When is statutory sick pay payable from in 2026?',
    'What\'s the legal difference between a grievance and a capability process?',
    'How long must we keep employee records under UK GDPR?',
  ],
  drafting: [
    'Draft a friendly email confirming a holiday request has been approved.',
    'Draft a kind, supportive message checking in on a team member who has been off sick for two weeks.',
    'Draft a paragraph for our handbook explaining the half-day holiday policy.',
    'Draft a meeting agenda for a quarterly 1:1 with a junior staff member.',
  ],
};

export default function AiAdviceTab() {
  const [mode, setMode] = useState<Mode>('educational');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // Switching mode resets the chat — different system prompt should start fresh
  function switchMode(m: Mode) {
    if (m === mode) return;
    if (messages.length > 0 && !confirm('Switching mode clears the current chat. Continue?')) return;
    setMode(m);
    setMessages([]);
    setError(null);
  }

  function clearChat() {
    if (messages.length === 0) return;
    if (!confirm('Clear this conversation?')) return;
    setMessages([]);
    setError(null);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput('');
    setBusy(true);

    // Add an empty assistant message we'll stream into
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/hr/ai-advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, messages: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed');
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        // Update the last (assistant) message with the accumulated text
        setMessages(prev => {
          const copy = [...prev];
          if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
            copy[copy.length - 1] = { role: 'assistant', content: acc };
          }
          return copy;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      // Drop the empty assistant message we appended
      setMessages(prev => prev[prev.length - 1]?.content === '' ? prev.slice(0, -1) : prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Mode switcher + clear */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex bg-white border border-[var(--border)] rounded-full p-0.5 text-xs">
          <button
            onClick={() => switchMode('educational')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ${mode === 'educational' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'}`}
          >
            <BookOpen size={12} />Educational
          </button>
          <button
            onClick={() => switchMode('drafting')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ${mode === 'drafting' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'}`}
          >
            <Pencil size={12} />Drafting
          </button>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} className="text-xs text-[var(--text-muted)] hover:text-red-600 inline-flex items-center gap-1">
            <Trash2 size={11} />Clear chat
          </button>
        )}
      </div>

      {/* Chat surface */}
      <div className="bg-white border border-[var(--border)] rounded-xl flex flex-col" style={{ height: 560 }}>
        <div ref={scrollerRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="h-12 w-12 rounded-full bg-[var(--accent-light)] flex items-center justify-center mb-3">
                <Sparkles size={20} className="text-[var(--accent)]" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {mode === 'educational' ? 'HR education adviser' : 'HR drafting helper'}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md">
                {mode === 'educational'
                  ? 'Ask about UK employment law, the new Employment Rights Bill 2026, or HR best practice. Plain-English answers; not specific legal advice.'
                  : 'Describe what you want to draft — a message, an email, a policy paragraph — and I\'ll produce a starting point you can edit.'}
              </p>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
                {STARTER_PROMPTS[mode].map(p => (
                  <button
                    key={p}
                    onClick={() => void send(p)}
                    className="text-left text-xs text-[var(--text-secondary)] bg-[var(--bg-nav-hover)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] border border-[var(--border)] rounded-lg p-2.5 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-nav-hover)] text-[var(--text-primary)] border border-[var(--border)]'
                  }`}
                >
                  {m.content || (busy && i === messages.length - 1 ? <span className="opacity-50 inline-flex items-center gap-2"><Loader2 size={11} className="animate-spin" />Thinking…</span> : null)}
                </div>
              </div>
            ))
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2.5 mx-4 mb-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={e => { e.preventDefault(); void send(input); }}
          className="border-t border-[var(--border)] p-3 flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); }
            }}
            rows={1}
            placeholder={mode === 'educational' ? 'Ask anything about UK HR / employment law…' : 'Describe what you\'d like a draft for…'}
            className="input-base text-sm flex-1 resize-none max-h-32"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className="btn-primary disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Send
          </button>
        </form>
      </div>

      {/* Persistent disclaimer */}
      <p className="text-[11px] text-[var(--text-muted)] italic text-center">
        ⚠ This adviser provides general information only — not legal or HR advice. For any specific situation involving an individual, consult a qualified HR adviser or solicitor.
      </p>
    </div>
  );
}
