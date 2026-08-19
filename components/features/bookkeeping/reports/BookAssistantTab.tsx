'use client';

/**
 * BookAssistantTab — conversational bookkeeping adviser.
 *
 * The user describes a scenario ("the client sold the business for £100k — how
 * do we account for it?"). SMITH explains the treatment and, where useful,
 * PROPOSES one or more balanced journals via the assistant API. Each proposal
 * renders as an editable preview card: the user can adjust accounts, amounts,
 * date and narrative, then post it — which goes through the SAME validated
 * POST /transactions endpoint a manual journal uses. Nothing posts without a
 * click; the AI has no direct path into the ledger.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Sparkles, Loader2, Send, Bot, User as UserIcon, ShieldCheck, AlertTriangle,
  Check, Plus, Trash2, RotateCcw, Printer,
} from 'lucide-react';
import AccountPicker from '../input/AccountPicker';
import DateInput, { toIso, fromIso } from '../input/DateInput';
import JournalTAccount, { type JournalLine } from '../book/JournalTAccount';
import MarkdownBlock from '@/components/ui/ChatMarkdown';
import { printReport } from './printReport';
import { formatMoney } from '@/lib/bookkeeping/formatMoney';
import type { BookAccountRef } from '@/types/bookkeeping';

// ── Server proposal shapes (mirror the assistant route) ──────────────────────
interface ApiSplit {
  account_id: string | null;
  account_name: string;
  account_ledger: string | null;
  new_account: { name: string; ledger: string; account_type: string } | null;
  debit: number;
  credit: number;
  entry_details: string | null;
}
interface ApiEntry {
  id: string;
  type: 'JRN' | 'RJN';
  reverses_on_date: string | null;   // ISO, RJN only
  date: string;          // ISO yyyy-mm-dd
  narrative: string;
  explanation: string;
  splits: ApiSplit[];
}

// ── Local editable state ─────────────────────────────────────────────────────
interface EditSplit {
  key: string;
  account_id: string | null;
  account_display: string;        // "Ledger: Account"
  suggestedNew: { name: string; ledger: string; account_type: string } | null;
  debit: number;
  credit: number;
  entry_details: string | null;
}
type PostStatus = 'draft' | 'posting' | 'posted' | 'error';
interface EditEntry {
  id: string;
  type: 'JRN' | 'RJN';
  reversesUk: string | null;      // dd/mm/yyyy, RJN only
  dateUk: string;                 // dd/mm/yyyy
  narrative: string;
  explanation: string;
  splits: EditSplit[];
  status: PostStatus;
  postedRef?: string;
  error?: string;
}
interface ThreadMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  entries: EditEntry[];
}

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

function toEditEntry(e: ApiEntry): EditEntry {
  return {
    id: e.id,
    type: e.type === 'RJN' ? 'RJN' : 'JRN',
    reversesUk: e.reverses_on_date ? fromIso(e.reverses_on_date) : null,
    dateUk: fromIso(e.date),
    narrative: e.narrative,
    explanation: e.explanation,
    status: 'draft',
    splits: e.splits.map(s => ({
      key: nextKey(),
      account_id: s.account_id,
      account_display: s.account_ledger ? `${s.account_ledger}: ${s.account_name}` : s.account_name,
      suggestedNew: s.new_account,
      debit: s.debit,
      credit: s.credit,
      entry_details: s.entry_details,
    })),
  };
}

const SUGGESTIONS = [
  'The client sold the business for £100,000 — how do we account for that?',
  'How do I record a director’s loan repayment?',
  'We need to accrue £2,400 of accountancy fees for the year. What’s the journal?',
  'A customer balance of £850 is irrecoverable — how do I write it off?',
];

export default function BookAssistantTab({
  bookId, bookName, onPosted, active, fromIso: periodFrom, toIso: periodTo,
}: {
  bookId: string;
  bookName?: string;
  onPosted?: () => void;
  active?: boolean;
  /** Active period bounds (ISO) — anchor the adviser's default journal dates.
   *  Aliased internally to avoid colliding with the toIso/fromIso date helpers. */
  fromIso?: string | null;
  toIso?: string | null;
}) {
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [thread, sending]);

  useEffect(() => { if (active) inputRef.current?.focus(); }, [active]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError('');
    const userMsg: ThreadMsg = { id: nextKey(), role: 'user', content: trimmed, entries: [] };
    const nextThread = [...thread, userMsg];
    setThread(nextThread);
    setInput('');
    setSending(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextThread.map(m => ({ role: m.role, content: m.content })),
          period: { from: periodFrom ?? null, to: periodTo ?? null },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'The adviser could not respond.');
      const entries: EditEntry[] = Array.isArray(d.proposals) ? (d.proposals as ApiEntry[]).map(toEditEntry) : [];
      setThread(t => [...t, { id: nextKey(), role: 'assistant', content: String(d.reply ?? ''), entries }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The adviser could not respond.');
    } finally {
      setSending(false);
    }
  }

  // ── Mutating a proposal in place (by message + entry id) ───────────────────
  function updateEntry(msgId: string, entryId: string, patch: Partial<EditEntry>) {
    setThread(t => t.map(m => m.id !== msgId ? m : {
      ...m,
      entries: m.entries.map(e => e.id !== entryId ? e : { ...e, ...patch }),
    }));
  }
  function updateSplit(msgId: string, entryId: string, key: string, patch: Partial<EditSplit>) {
    setThread(t => t.map(m => m.id !== msgId ? m : {
      ...m,
      entries: m.entries.map(e => e.id !== entryId ? e : {
        ...e,
        splits: e.splits.map(s => s.key !== key ? s : { ...s, ...patch }),
      }),
    }));
  }

  async function postEntry(msgId: string, entry: EditEntry) {
    // Every line needs a resolved account and a single-sided amount.
    if (entry.splits.some(s => !s.account_id)) {
      updateEntry(msgId, entry.id, { status: 'error', error: 'Choose an account for every line first.' });
      return;
    }
    const totalDebit = entry.splits.reduce((s, l) => s + l.debit, 0);
    const totalCredit = entry.splits.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      updateEntry(msgId, entry.id, { status: 'error', error: 'The journal must balance before posting.' });
      return;
    }
    if (entry.type === 'RJN' && !entry.reversesUk) {
      updateEntry(msgId, entry.id, { status: 'error', error: 'Set the reversal date before posting.' });
      return;
    }
    updateEntry(msgId, entry.id, { status: 'posting', error: undefined });
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: entry.type,
          date: toIso(entry.dateUk),
          details: entry.narrative || null,
          total: +totalDebit.toFixed(2),
          vat_total: 0,
          vat_treatment: null,
          primary_account_id: null,
          reverses_on_date: entry.type === 'RJN' && entry.reversesUk ? toIso(entry.reversesUk) : null,
          splits: entry.splits.map(s => ({
            account_id: s.account_id,
            debit: +s.debit.toFixed(2),
            credit: +s.credit.toFixed(2),
            entry_details: s.entry_details,
          })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not post the journal.');
      updateEntry(msgId, entry.id, { status: 'posted', postedRef: d.transaction?.ref_no ?? 'JRN' });
      onPosted?.();
    } catch (e) {
      updateEntry(msgId, entry.id, { status: 'error', error: e instanceof Error ? e.message : 'Could not post the journal.' });
    }
  }

  const empty = thread.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] min-h-[420px] max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="shrink-0 pb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 inline-flex items-center gap-2">
            <Sparkles size={15} className="text-indigo-600" /> AI Adviser
          </h2>
          <p className="text-xs text-slate-500">
            Ask how to account for something. SMITH explains the treatment and can prepare journals for you to review and post — it never posts on its own.
          </p>
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => printRef.current && printReport(printRef.current, `AI Adviser — ${bookName ?? 'Book'}`)}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shrink-0"
          >
            <Printer size={12} /> Print
          </button>
        )}
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-1">
        {empty && (
          <div className="text-center py-10 px-6 border border-slate-200 rounded-xl bg-white shadow-sm">
            <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-indigo-50 text-indigo-600 mb-2">
              <Bot size={18} />
            </div>
            <p className="text-sm font-medium text-slate-900 mb-0.5">Discuss an entry or adjustment</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
              Describe what’s happened in plain English. SMITH knows this book’s chart of accounts and will suggest the correct double-entry.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-xs text-left px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.map(msg => (
          <div key={msg.id}>
            <div className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <span className="shrink-0 w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mt-0.5">
                  <Bot size={14} />
                </span>
              )}
              <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[85%] ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-800 shadow-sm'
              }`}>
                {msg.role === 'assistant' ? <ChatMarkdown text={msg.content} /> : msg.content}
              </div>
              {msg.role === 'user' && (
                <span className="shrink-0 w-7 h-7 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center mt-0.5">
                  <UserIcon size={14} />
                </span>
              )}
            </div>

            {/* Proposed journals for this message */}
            {msg.entries.length > 0 && (
              <div className="mt-2.5 ml-9 space-y-3">
                {msg.entries.map(entry => (
                  <ProposalCard
                    key={entry.id}
                    bookId={bookId}
                    entry={entry}
                    onPatch={patch => updateEntry(msg.id, entry.id, patch)}
                    onPatchSplit={(key, patch) => updateSplit(msg.id, entry.id, key, patch)}
                    onPost={() => postEntry(msg.id, entry)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-2.5">
            <span className="shrink-0 w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <Bot size={14} />
            </span>
            <div className="rounded-2xl px-3.5 py-2.5 bg-white border border-slate-200 shadow-sm text-sm text-slate-400 inline-flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 mt-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Composer */}
      <div className="shrink-0 mt-3">
        <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white shadow-sm px-3 py-2 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            rows={1}
            placeholder="Ask how to account for something…"
            disabled={sending}
            className="flex-1 resize-none outline-none text-sm text-slate-800 placeholder:text-slate-400 max-h-32 bg-transparent"
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={sending || !input.trim()}
            aria-label="Send"
            className="shrink-0 w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center disabled:opacity-40 hover:bg-indigo-700 transition-colors"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5">
          AI-assisted — always apply your own professional judgement. Journals are only posted when you click Post.
        </p>
      </div>

      {/* Hidden print transcript — captured by printReport. Kept in the DOM
          (display:none on screen) so it renders the same ChatMarkdown / journal
          panels; the print stylesheet flips .bk-print-only visible. */}
      <div ref={printRef} hidden className="bk-print-root bk-print-area bk-print-only">
        <h1 className="text-lg font-bold text-slate-900">AI Adviser — conversation log{bookName ? ` — ${bookName}` : ''}</h1>
        <p className="text-xs text-slate-500 mb-4">Printed {new Date().toLocaleString('en-GB')}</p>
        {thread.map(m => (
          <div key={m.id} className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{m.role === 'user' ? 'You' : 'SMITH'}</div>
            <div className="text-sm text-slate-800 leading-relaxed">
              {m.role === 'assistant' ? <ChatMarkdown text={m.content} /> : m.content}
            </div>
            {m.entries.map(e => (
              <div key={e.id} className="mt-2">
                <div className="text-xs font-medium text-slate-700">
                  {e.type === 'RJN' ? 'Proposed reversing journal' : 'Proposed journal'} · {e.dateUk}
                  {e.type === 'RJN' && e.reversesUk ? ` (auto-reverses ${e.reversesUk})` : ''}
                  {e.status === 'posted' ? ` — POSTED ${e.postedRef ?? ''}` : ''}
                </div>
                <JournalTAccount title={e.narrative} date={e.dateUk} lines={entryToJournalLines(e)} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Map an editable proposal to the read-only T-account panel for printing.
function entryToJournalLines(entry: EditEntry): JournalLine[] {
  return entry.splits.map(s => {
    const [ledger, ...rest] = s.account_display.split(': ');
    const account = rest.length ? rest.join(': ') : s.account_display;
    return {
      ledger: rest.length ? ledger : null,
      account,
      debit: s.debit || undefined,
      credit: s.credit || undefined,
      detail: s.entry_details,
    };
  });
}

// ── Proposal card ─────────────────────────────────────────────────────────────
function ProposalCard({
  bookId, entry, onPatch, onPatchSplit, onPost,
}: {
  bookId: string;
  entry: EditEntry;
  onPatch: (patch: Partial<EditEntry>) => void;
  onPatchSplit: (key: string, patch: Partial<EditSplit>) => void;
  onPost: () => void;
}) {
  const totalDebit = entry.splits.reduce((s, l) => s + l.debit, 0);
  const totalCredit = entry.splits.reduce((s, l) => s + l.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;
  const allAccountsSet = entry.splits.every(s => s.account_id);
  const reversalSet = entry.type !== 'RJN' || !!entry.reversesUk;
  const posted = entry.status === 'posted';
  const posting = entry.status === 'posting';
  const canPost = balanced && allAccountsSet && reversalSet && !posted && !posting;

  function setAccount(key: string, account: BookAccountRef | null) {
    onPatchSplit(key, {
      account_id: account?.id ?? null,
      account_display: account ? (account.ledger ? `${account.ledger}: ${account.name}` : account.name) : '',
      suggestedNew: null,
    });
  }

  function setAmount(key: string, side: 'debit' | 'credit', raw: string) {
    const n = Math.max(0, Number(raw.replace(/[^0-9.]/g, '')) || 0);
    // A line is one-sided — entering one side zeroes the other.
    onPatchSplit(key, side === 'debit' ? { debit: n, credit: 0 } : { credit: n, debit: 0 });
  }

  return (
    <div className={`rounded-xl border bg-white shadow-sm overflow-hidden ${posted ? 'border-emerald-200' : 'border-slate-200'}`}>
      {/* Header: date + narrative */}
      <div className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-mono font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
          entry.type === 'RJN' ? 'bg-teal-100 text-teal-700' : 'bg-violet-100 text-violet-700'
        }`}>
          {entry.type === 'RJN' && <RotateCcw size={10} />}{entry.type}
        </span>
        {posted ? (
          <span className="text-sm text-slate-700">{entry.dateUk}</span>
        ) : (
          <div className="w-32">
            <DateInput value={entry.dateUk} onChange={v => onPatch({ dateUk: v })} ariaLabel="Journal date" />
          </div>
        )}
        {posted ? (
          <span className="text-sm font-medium text-slate-800 flex-1">{entry.narrative}</span>
        ) : (
          <input
            type="text"
            value={entry.narrative}
            onChange={e => onPatch({ narrative: e.target.value })}
            placeholder="Narrative / details"
            className="flex-1 min-w-[160px] text-sm text-slate-800 bg-white border border-slate-200 rounded-md px-2 py-1 outline-none focus:border-indigo-400"
          />
        )}
      </div>

      {/* Reversal date (RJN only) — the system auto-posts the reversal here. */}
      {entry.type === 'RJN' && (
        <div className="px-3.5 pt-2.5 flex items-center gap-2 text-xs text-teal-700">
          <RotateCcw size={12} className="shrink-0" />
          <span>Auto-reverses on</span>
          {posted ? (
            <span className="font-medium">{entry.reversesUk}</span>
          ) : (
            <div className="w-32">
              <DateInput value={entry.reversesUk ?? ''} onChange={v => onPatch({ reversesUk: v })} ariaLabel="Reversal date" />
            </div>
          )}
        </div>
      )}

      {/* Explanation */}
      {entry.explanation && (
        <div className="px-3.5 pt-2.5 text-xs text-slate-600 leading-snug">{entry.explanation}</div>
      )}

      {/* Lines */}
      <div className="px-3.5 py-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_84px_84px_24px] gap-x-2 gap-y-1 items-center text-[11px] text-slate-400 uppercase tracking-wide mb-1">
          <span>Account</span>
          <span className="text-right">Debit</span>
          <span className="text-right">Credit</span>
          <span />
        </div>
        {entry.splits.map(s => (
          <div key={s.key} className="grid grid-cols-[minmax(0,1fr)_84px_84px_24px] gap-x-2 gap-y-1 items-start py-1 border-t border-slate-50 first:border-t-0">
            <div className="min-w-0">
              {posted ? (
                <span className="text-sm text-slate-700">{s.account_display}</span>
              ) : (
                <AccountPicker
                  bookId={bookId}
                  value={s.account_id}
                  valueDisplay={s.account_id ? s.account_display : undefined}
                  onChange={acct => setAccount(s.key, acct)}
                  placeholder={s.suggestedNew ? `Suggested: ${s.suggestedNew.ledger}: ${s.suggestedNew.name}` : 'Choose account'}
                />
              )}
              {!posted && s.suggestedNew && !s.account_id && (
                <SuggestedAccountHint
                  bookId={bookId}
                  suggestion={s.suggestedNew}
                  onCreated={acct => setAccount(s.key, acct)}
                />
              )}
              {!posted && (
                <input
                  type="text"
                  value={s.entry_details ?? ''}
                  onChange={e => onPatchSplit(s.key, { entry_details: e.target.value || null })}
                  placeholder="Line detail (optional)"
                  className="mt-1 w-full text-[11px] text-slate-500 bg-transparent border-b border-dashed border-slate-200 outline-none focus:border-indigo-300 px-0.5"
                />
              )}
            </div>
            {posted ? (
              <span className="text-right text-sm tabular-nums text-slate-700">{s.debit ? formatMoney(s.debit) : ''}</span>
            ) : (
              <input
                type="text" inputMode="decimal"
                value={s.debit ? String(s.debit) : ''}
                onChange={e => setAmount(s.key, 'debit', e.target.value)}
                placeholder="0.00"
                aria-label="Debit"
                className="text-right text-sm tabular-nums bg-white border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-indigo-400 w-full"
              />
            )}
            {posted ? (
              <span className="text-right text-sm tabular-nums text-slate-700">{s.credit ? formatMoney(s.credit) : ''}</span>
            ) : (
              <input
                type="text" inputMode="decimal"
                value={s.credit ? String(s.credit) : ''}
                onChange={e => setAmount(s.key, 'credit', e.target.value)}
                placeholder="0.00"
                aria-label="Credit"
                className="text-right text-sm tabular-nums bg-white border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-indigo-400 w-full"
              />
            )}
            <div className="flex justify-center pt-1.5">
              {!posted && entry.splits.length > 2 && (
                <button
                  type="button"
                  onClick={() => onPatch({ splits: entry.splits.filter(x => x.key !== s.key) })}
                  aria-label="Remove line"
                  className="text-slate-300 hover:text-rose-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Totals + add line */}
        <div className="grid grid-cols-[minmax(0,1fr)_84px_84px_24px] gap-x-2 items-center pt-2 mt-1 border-t border-slate-200 text-sm">
          {!posted ? (
            <button
              type="button"
              onClick={() => onPatch({ splits: [...entry.splits, { key: nextKey(), account_id: null, account_display: '', suggestedNew: null, debit: 0, credit: 0, entry_details: null }] })}
              className="text-xs text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 justify-self-start"
            >
              <Plus size={12} /> Add line
            </button>
          ) : <span />}
          <span className="text-right tabular-nums font-medium text-slate-800">{formatMoney(totalDebit)}</span>
          <span className="text-right tabular-nums font-medium text-slate-800">{formatMoney(totalCredit)}</span>
          <span />
        </div>
      </div>

      {/* Footer: status + post */}
      <div className="px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs">
          {posted ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-700"><Check size={14} /> Posted as {entry.postedRef}</span>
          ) : !balanced ? (
            <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertTriangle size={13} /> Out of balance by {formatMoney(Math.abs(totalDebit - totalCredit))}</span>
          ) : !allAccountsSet ? (
            <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertTriangle size={13} /> Choose an account for every line</span>
          ) : !reversalSet ? (
            <span className="inline-flex items-center gap-1.5 text-amber-700"><AlertTriangle size={13} /> Set the auto-reversal date</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-emerald-700"><ShieldCheck size={13} /> Balanced — ready to post{entry.type === 'RJN' ? ' (auto-reverses)' : ''}</span>
          )}
          {entry.status === 'error' && entry.error && (
            <span className="block text-rose-600 mt-0.5">{entry.error}</span>
          )}
        </div>
        {!posted && (
          <button
            type="button"
            onClick={onPost}
            disabled={!canPost}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {posting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {posting ? 'Posting…' : entry.type === 'RJN' ? 'Post reversing journal' : 'Post journal'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Chat content rendering ────────────────────────────────────────────────────
// The adviser writes prose plus fenced ```journal blocks (structured JSON) for
// any double-entry it describes. Journal blocks render as the inline purple
// T-account panel (matching the transaction hover preview); everything else
// renders as lightweight markdown — no raw ###/---/pipe-tables leaking through.

interface RawJournalLine {
  ledger?: string | null; account?: string; debit?: number; credit?: number;
  dr?: boolean; cr?: boolean; side?: string; detail?: string | null;
}
interface JournalBlockData {
  title?: string;
  ref?: string;
  date?: string;
  lines?: RawJournalLine[];
}

function normalizeJournalLine(l: RawJournalLine): JournalLine {
  const debit = typeof l.debit === 'number' ? l.debit : undefined;
  const credit = typeof l.credit === 'number' ? l.credit : undefined;
  const side = (l.side ?? '').toLowerCase();
  return {
    ledger: l.ledger ?? null,
    account: l.account ?? '—',
    debit,
    credit,
    drMark: debit === undefined && credit === undefined && (l.dr === true || side === 'dr' || side === 'debit'),
    crMark: debit === undefined && credit === undefined && (l.cr === true || side === 'cr' || side === 'credit'),
    detail: l.detail ?? null,
  };
}

function ChatMarkdown({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  const fence = /```journal\s*([\s\S]*?)```/g;
  let last = 0, key = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) out.push(<MarkdownBlock key={key++} text={text.slice(last, m.index)} />);
    let data: JournalBlockData | null = null;
    try { data = JSON.parse(m[1].trim()) as JournalBlockData; } catch { data = null; }
    if (data && Array.isArray(data.lines) && data.lines.length > 0) {
      out.push(
        <JournalTAccount
          key={key++}
          title={data.title}
          refNo={data.ref}
          date={data.date}
          lines={data.lines.map(normalizeJournalLine)}
        />,
      );
    } else {
      out.push(<MarkdownBlock key={key++} text={m[1].trim()} />);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<MarkdownBlock key={key++} text={text.slice(last)} />);
  return <>{out}</>;
}

// ── "Use suggested account" affordance for AI-proposed new accounts ──────────
function SuggestedAccountHint({
  bookId, suggestion, onCreated,
}: {
  bookId: string;
  suggestion: { name: string; ledger: string; account_type: string };
  onCreated: (acct: BookAccountRef) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(suggestion),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.account) {
        onCreated(d.account as BookAccountRef);
        return;
      }
      // Already exists — find it so the suggestion still resolves cleanly.
      if (r.status === 409) {
        const g = await fetch(`/api/bookkeeping/books/${bookId}/accounts?ledger=${encodeURIComponent(suggestion.ledger)}&search=${encodeURIComponent(suggestion.name)}`);
        const gd = await g.json().catch(() => ({}));
        const match = (gd.accounts ?? []).find((a: BookAccountRef) => a.name.toLowerCase() === suggestion.name.toLowerCase());
        if (match) { onCreated(match); return; }
      }
      throw new Error(d.error ?? 'Could not create the account.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 text-[11px] text-indigo-600 flex items-center gap-1.5 flex-wrap">
      <Sparkles size={11} />
      <span>SMITH suggests a new account: <strong>{suggestion.ledger}: {suggestion.name}</strong></span>
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="underline hover:text-indigo-800 disabled:opacity-50 inline-flex items-center gap-1"
      >
        {busy && <Loader2 size={10} className="animate-spin" />} Create &amp; use
      </button>
      {err && <span className="text-rose-600 w-full">{err}</span>}
    </div>
  );
}
