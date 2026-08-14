'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Send, Loader2, Check, Plus, X, MessageSquare, Tag, PencilLine, Flag, RotateCcw } from 'lucide-react';
import type { Transaction, TargetSoftware, FlaggedEntry } from '@/types';
import {
  buildCaptureProposals, resolveEditKeys, fetchCaptureChat,
  type CaptureEdit,
} from './captureChat';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  edits?: CaptureEdit[];
  refLabels?: Record<number, string>;   // ref → row description, for the Apply-chip title
  applied?: Set<number>;
}

const money = (n: number) => `£${(n ?? 0).toFixed(2)}`;

// Render a reply as spaced paragraphs. SMITH separates points with blank lines
// (\n\n); we split on those and give each block its own <p> with top margin, so
// a multi-point answer reads as paragraphs rather than one dense block. Single
// newlines within a block are preserved by the bubble's whitespace-pre-wrap.
function renderReply(text: string) {
  return text.trim().split(/\n{2,}/).map((para, i) => (
    <p key={i} className={i > 0 ? 'mt-2' : ''}>{para}</p>
  ));
}

// A one-line human title for an edit, shown on the Apply chip.
function describeEdit(edit: CaptureEdit, label: string): { verb: string; icon: typeof Tag; detail: string } {
  const row = label ? `"${label}"` : `row ${edit.ref}`;
  if (edit.action === 'recode') return { verb: 'Recode', icon: Tag, detail: `${row} → ${edit.account || '(unset)'}` };
  if (edit.action === 'flag') return { verb: 'Flag', icon: Flag, detail: row };
  if (edit.action === 'unflag') return { verb: 'Restore', icon: RotateCcw, detail: row };
  // update — summarise the changed fields
  const f = edit.fields ?? {};
  const parts: string[] = [];
  if (f.description != null) parts.push(`“${f.description}”`);
  if (f.date != null) parts.push(f.date);
  if (f.net != null) parts.push(`net ${money(f.net)}`);
  if (f.vat != null) parts.push(`VAT ${money(f.vat)}`);
  if (f.gross != null) parts.push(`gross ${money(f.gross)}`);
  return { verb: 'Update', icon: PencilLine, detail: `${row}: ${parts.join(' · ') || 'no change'}` };
}

export interface CaptureReviewChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  isVatRegistered: boolean;
  targetSoftware: TargetSoftware;
  accountLabel: string;
  accounts: string[];                          // chart-of-accounts names for recodes
  transactions: Transaction[];                 // live processedTransactions
  flagged: FlaggedEntry[];                     // live flagged entries
  // Returns true if the edit found its target row and was applied.
  onApplyEdit: (edit: CaptureEdit) => boolean;
}

export default function CaptureReviewChat(props: CaptureReviewChatProps) {
  const { open, onOpenChange, transactions, targetSoftware } = props;

  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    const v = transactions.length, f = props.flagged.length;
    const parts: string[] = [];
    if (v) parts.push(`${v} transaction${v === 1 ? '' : 's'}`);
    if (f) parts.push(`${f} flagged item${f === 1 ? '' : 's'}`);
    return [{
      role: 'assistant',
      content: `I've read your ${parts.join(' and ') || 'documents'}. Ask me to sanity-check the coding or VAT, explain why something's flagged, spot duplicates, or just tell me what to fix — I'll propose changes you apply with one click.`,
    }];
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

  const proposals = useMemo(() => buildCaptureProposals(transactions, props.flagged, targetSoftware), [transactions, props.flagged, targetSoftware]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    const history: ChatMsg[] = [...messages, { role: 'user', content: q }];
    setMessages(history);
    setInput('');
    setSending(true);
    try {
      const { reply, edits } = await fetchCaptureChat({
        clientName: props.clientName,
        isVatRegistered: props.isVatRegistered,
        targetSoftware: props.targetSoftware,
        accountLabel: props.accountLabel,
        accounts: props.accounts,
        proposals: proposals.filter(p => p.section === 'valid').map(p => ({ ref: p.ref, label: p.label, contact: p.contact, account: p.account, net: p.net, vat: p.vat, gross: p.gross, date: p.date })),
        flagged: proposals.filter(p => p.section === 'flagged').map(p => ({ ref: p.ref, label: p.label, contact: p.contact, amount: p.gross, date: p.date, reason: p.reason ?? '' })),
        messages: history.map(m => ({ role: m.role, content: m.content })),
      });
      // Resolve each edit's ref → stable content key against the snapshot the AI saw.
      const resolved = resolveEditKeys(edits, proposals);
      const refLabels: Record<number, string> = {};
      resolved.forEach(e => { refLabels[e.ref] = proposals.find(p => p.ref === e.ref)?.label ?? ''; });
      setMessages(ms => [...ms, {
        role: 'assistant', content: reply,
        edits: resolved.length ? resolved : undefined,
        refLabels, applied: new Set(),
      }]);
    } catch (e) {
      setMessages(ms => [...ms, { role: 'assistant', content: e instanceof Error ? e.message : 'SMITH is unavailable right now.' }]);
    } finally {
      setSending(false);
    }
  }

  function applyEdit(msgIdx: number, editIdx: number, edit: CaptureEdit) {
    const ok = props.onApplyEdit(edit);
    if (!ok) {
      setMessages(ms => [...ms, { role: 'assistant', content: `I couldn't find that row any more — it may have changed since. Ask me again and I'll re-check the current list.` }]);
      return;
    }
    setMessages(ms => ms.map((m, i) => i === msgIdx ? { ...m, applied: new Set([...(m.applied ?? []), editIdx]) } : m));
  }

  // The trigger button lives in the page's action bar (next to Flagged); this
  // component renders only the drawer, and only when open.
  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-black/10 bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-black/5 bg-white px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent)]/10">
          <Sparkles size={16} className="text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-[var(--text-primary)]">Ask SMITH</p>
          <p className="truncate text-[11px] text-[var(--text-muted)]">Review the extracted transactions</p>
        </div>
        <button onClick={() => onOpenChange(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-black/[0.015] px-3 py-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
              m.role === 'user' ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--text-primary)] shadow-sm'
            }`}>
              {renderReply(m.content)}
              {m.edits && m.edits.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {m.edits.map((e, j) => {
                    const applied = m.applied?.has(j);
                    const { verb, icon: Icon, detail } = describeEdit(e, m.refLabels?.[e.ref] ?? '');
                    return (
                      <div key={j} className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/[0.05] px-2 py-1.5">
                        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-[var(--text-primary)]">
                          <Icon size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                          <span>{verb}: {detail}</span>
                        </p>
                        {e.reason && <p className="mt-0.5 pl-[18px] text-[10.5px] text-[var(--text-muted)]">{e.reason}</p>}
                        <button
                          onClick={() => !applied && applyEdit(i, j, e)}
                          disabled={applied}
                          className={`mt-1 ml-[18px] inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold transition-colors ${
                            applied ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--accent)] text-white hover:opacity-90'
                          }`}
                        >
                          {applied ? <><Check size={11} /> Applied</> : <><Plus size={11} /> Apply</>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-white px-3 py-1.5 text-[12px] text-[var(--text-muted)] shadow-sm">
              <Loader2 size={13} className="inline animate-spin" /> SMITH is thinking…
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-black/5 bg-white px-3 py-2.5">
        <MessageSquare size={15} className="shrink-0 text-[var(--text-muted)]" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(input); }}
          placeholder="e.g. recode all the Shell receipts to Motor expenses"
          className="input-base flex-1 py-1.5 text-[12px]"
        />
        <button
          onClick={() => send(input)}
          disabled={sending || !input.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
