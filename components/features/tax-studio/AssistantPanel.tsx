'use client';

import { useRef, useState } from 'react';
import { Sparkles, Send, Loader2, Copy, Check } from 'lucide-react';
import { returnType } from './data';
import { estimateSa100 } from './calc';
import type { TaxReturn, StageId } from './types';

interface Msg { role: 'user' | 'assistant'; content: string }

function startersFor(stage: StageId, r: TaxReturn): string[] {
  const base = [`What changed since last year for ${r.clientName}?`, 'Can this client reduce their tax?'];
  switch (stage) {
    case 'setup':    return ['Which data should I connect for this client?', ...base];
    case 'analyse':  return ['Explain the imported figures', 'What looks unusual this year?', ...base];
    case 'review':   return ['Explain why the tax increased', 'Draft notes for review', ...base];
    case 'approval': return ['Draft the client approval email', 'Summarise the return for the client', ...base];
    case 'submit':   return ['What happens after I file?', 'Draft a filing confirmation email', ...base];
    default:         return base;
  }
}

export default function AssistantPanel({ ret, stage }: { ret: TaxReturn; stage: StageId }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rt = returnType(ret.returnType);
  const est = estimateSa100(ret.income, ret.taxYear);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/tax-studio/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.slice(-8),
          context: {
            clientName: ret.clientName, returnForm: rt.form, returnLabel: rt.label,
            taxYear: ret.taxYear, entity: ret.entityLabel, stage,
            estimatedTax: est.totalTax, totalIncome: est.totalIncome, context: ret.context ?? '',
          },
        }),
      });
      const d = await res.json().catch(() => ({}));
      const reply = res.ok ? (d.reply as string) : (d.error as string) || 'Sorry — I couldn’t answer that just now.';
      setMessages(m => [...m, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Sorry — the assistant is unavailable right now.' }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  }

  return (
    <div className="flex h-full flex-col rounded-[22px] border border-white/60 bg-white/70 shadow-[0_8px_32px_rgba(31,38,88,0.10)] backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><Sparkles size={15} /></div>
        <div>
          <p className="text-[13px] font-bold text-[var(--text-primary)]">Tax Assistant</p>
          <p className="text-[11px] text-[var(--text-muted)]">Knows this client&apos;s return</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] text-[var(--text-muted)]">Ask about {ret.clientName}&apos;s {rt.form} return, or try:</p>
            {startersFor(stage, ret).map(s => (
              <button key={s} onClick={() => send(s)}
                className="block w-full rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2 text-left text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent)]/5 hover:text-[var(--text-primary)]">
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              <div className={`group relative max-w-[92%] rounded-2xl px-3 py-2 text-[12.5px] ${
                m.role === 'user' ? 'bg-[var(--accent)] text-white' : 'bg-white/80 text-[var(--text-primary)]'
              }`}>
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                {m.role === 'assistant' && (
                  <button
                    onClick={() => { navigator.clipboard.writeText(m.content); setCopied(i); setTimeout(() => setCopied(null), 1500); }}
                    className="absolute -right-1 -top-1 rounded-md bg-white p-1 text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                  >
                    {copied === i ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        {busy && <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]"><Loader2 size={13} className="animate-spin" /> Thinking…</div>}
      </div>

      <div className="border-t border-black/5 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            placeholder="Ask the assistant…"
            className="max-h-24 flex-1 resize-none rounded-xl border border-[var(--border)] bg-white/80 px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button onClick={() => send(input)} disabled={busy || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white transition-opacity disabled:opacity-40">
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
