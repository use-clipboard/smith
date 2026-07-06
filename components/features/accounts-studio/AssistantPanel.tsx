'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2, Copy, Check } from 'lucide-react';
import type { Engagement, AssistantMessage } from './types';
import { ENTITY_LABELS } from './data';

const SUGGESTIONS = [
  'Explain FRS 102 Section 1A requirements',
  'Why is the related party disclosure required?',
  'Draft a going concern statement for these accounts',
  'Simplify the directors’ report',
  'Explain the Companies House validation',
];

export default function AssistantPanel({ engagement }: { engagement: Engagement }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: AssistantMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/accounts-studio/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'chat',
          messages: next.slice(-8),
          context: {
            companyName: engagement.companyName,
            entityType: ENTITY_LABELS[engagement.entityType],
            framework: engagement.framework,
            periodEnd: engagement.periodEnd,
            turnover: engagement.statements?.profitLoss.turnoverTotal ?? null,
            netProfit: engagement.statements?.profitLoss.netProfit ?? null,
            totalAssets: engagement.statements?.balanceSheet.totalAssets ?? null,
            netAssets: engagement.statements?.balanceSheet.netAssets ?? null,
          },
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'The assistant is unavailable right now.');
      }
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', content: data.reply || 'No response.' }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: err instanceof Error ? err.message : 'Something went wrong.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[22px] border border-white/60 bg-white/70 shadow-[0_8px_32px_rgba(31,38,88,0.10)] backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent)]/10">
          <Sparkles size={16} className="text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-[var(--text-primary)]">AI assistant</p>
          <p className="truncate text-[11px] text-[var(--text-muted)]">Statutory accounts &amp; UK standards</p>
        </div>
        <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--accent)]">Beta</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
              Ask anything about preparing these statutory accounts — I focus on production and UK accounting standards, not analytical review.
            </p>
            <div className="space-y-1.5">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full rounded-xl border border-black/5 bg-white/60 px-3 py-2 text-left text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 hover:text-[var(--accent)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`group relative max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
              m.role === 'user'
                ? 'bg-[var(--accent)] text-white'
                : 'border border-black/5 bg-white/80 text-[var(--text-primary)]'
            }`}>
              {m.content}
              {m.role === 'assistant' && (
                <button
                  onClick={() => { navigator.clipboard.writeText(m.content); setCopied(i); setTimeout(() => setCopied(null), 1500); }}
                  className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-black/5 bg-white text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--accent)] group-hover:opacity-100"
                  aria-label="Copy"
                >
                  {copied === i ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </button>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <Loader2 size={13} className="animate-spin" /> SMITH is thinking…
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-black/5 p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-black/10 bg-white/80 px-3 py-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask a question…"
            rows={1}
            className="max-h-28 flex-1 resize-none bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-opacity disabled:opacity-40"
            aria-label="Send"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
