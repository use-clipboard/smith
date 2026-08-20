'use client';

/**
 * AccountsImportModal — "Import from Accounts Studio" for a CT600 return.
 *
 * A double-panel lightbox modelled on the bookkeeping opening-balances flow:
 *   • Left — the figures SMITH pulled from the company's Accounts Studio
 *     accounts, mapped into the CT600 trading boxes. Editable.
 *   • Right — chat to SMITH about the mapping. SMITH explains, asks about
 *     anything ambiguous (depreciation to add back, capital allowances, other
 *     disallowables) and PROPOSES changes on a card the user approves.
 *
 * SMITH proposes, the user applies. Nothing touches the return until the user
 * presses "Apply to return", which calls onApply(mapping) with the mapped
 * Ct600Trading figures.
 */

import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Sparkles, Send, ChevronDown } from 'lucide-react';
import ChatMarkdown, { renderInline } from '@/components/ui/ChatMarkdown';
import { fetchJson } from '@/lib/fetchJson';
import type { TaxReturn, Ct600Trading } from './types';
import { fmtDateUK } from './data';

// ── Data shapes ──────────────────────────────────────────────────────────────
interface AccountsLine { label: string; amount: number; section: 'income' | 'expense' }
interface AccountsData {
  found: boolean;
  periodStart: string;
  periodEnd: string;
  entityLabel: string;
  isPartnership: boolean;
  netProfit: number;
  turnover: number;
  lines?: AccountsLine[];
  note?: string;
}

interface ChatMessage { role: 'user' | 'assistant'; content: string }
// Only the numeric trading boxes are mappable here (the calculator working
// objects — capitalAllowancesCalc / rdFilmsCalc — are not figures).
type NumericTradingKey = Exclude<keyof Ct600Trading, 'capitalAllowancesCalc' | 'rdFilmsCalc'>;
interface ProposalChange { field: NumericTradingKey; value: number }
interface Proposal { summary: string; changes: ProposalChange[] }

type Mapping = Partial<Ct600Trading>;

// The boxes shown as editable rows on the left panel.
const EDITABLE_ROWS: Array<{ field: NumericTradingKey; label: string }> = [
  { field: 'turnover', label: 'Turnover' },
  { field: 'profitPerAccount', label: 'Profit/(loss) per account' },
  { field: 'addBack', label: 'Add Back' },
  { field: 'disallowableExpenses', label: 'Disallowable Expenses' },
  { field: 'capitalAllowances', label: 'Capital Allowances' },
  { field: 'balancingCharges', label: 'Balancing Charges' },
];

const FIELD_LABELS: Record<string, string> = {
  turnover: 'Turnover',
  profitPerAccount: 'Profit/(loss) per account',
  addBack: 'Add Back',
  adjustments: 'Adjustments',
  disallowableExpenses: 'Disallowable Expenses',
  rdOrFilmsExpenditure: 'R&D or Films Expenditure',
  incomeNotCredited: 'Income not credited to profit',
  balancingCharges: 'Balancing Charges',
  rdec: 'Taxable R&D Expenditure Credit (RDEC)',
  avec: 'Taxable Audio Visual Expenditure Credit (AVEC)',
  vgec: 'Taxable Video Games Expenditure Credit (VGEC)',
  incomeNotAssessed: 'Income/(deficit) not assessed',
  expenditureNotInAccounts: 'Expenditure not in accounts',
  rdOrFilmsRelief: 'R&D or Films Relief',
  capitalAllowances: 'Capital Allowances',
  rdFilmsTaxCreditSurrender: 'R&D/Films Tax Credit surrender',
};

const money = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const OPENING_PROMPT =
  'Summarise the figures you pulled from the accounts and flag anything I should check before mapping them into the CT600 (e.g. depreciation to add back, capital allowances, disallowables).';

export default function AccountsImportModal({
  ret, onApply, onClose,
}: {
  ret: TaxReturn;
  onApply: (trading: Partial<Ct600Trading>) => void;
  onClose: () => void;
}): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [accounts, setAccounts] = useState<AccountsData | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [showLines, setShowLines] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const kickedOff = useRef(false);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, proposal, chatBusy]);

  // ── Load the pulled figures ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const data = await fetchJson<AccountsData>(
          `/api/tax-studio/integrations/accounts-studio?clientId=${ret.clientId ?? ''}&taxYear=${encodeURIComponent(ret.taxYear)}`,
        );
        if (cancelled) return;
        setAccounts(data);
        if (data.found) {
          // Seed the mapping deterministically: pull turnover + net profit, but
          // only override a box that is currently 0/unset so we never clobber the
          // user's own edits already on the return.
          const existing = ret.ct600?.trading ?? {};
          const seed: Mapping = { ...existing };
          const setIfUnset = (field: NumericTradingKey, value: number) => {
            if (!seed[field]) seed[field] = value;
          };
          setIfUnset('turnover', data.turnover);
          setIfUnset('profitPerAccount', data.netProfit);
          setMapping(seed);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load the accounts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ret.clientId, ret.taxYear, ret.ct600]);

  // ── Chat send ───────────────────────────────────────────────────────────────
  async function sendMessages(history: ChatMessage[]) {
    if (!accounts?.found) return;
    setChatBusy(true);
    setChatError('');
    try {
      const res = await fetch('/api/tax-studio/ct600/accounts-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounts: {
            turnover: accounts.turnover,
            netProfit: accounts.netProfit,
            periodStart: accounts.periodStart,
            periodEnd: accounts.periodEnd,
            lines: accounts.lines ?? [],
          },
          mapping,
          messages: history,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? 'SMITH could not answer.');
      setMessages(prev => [...prev, { role: 'assistant', content: (d.reply as string) ?? '' }]);
      setProposal((d.proposal ?? null) as Proposal | null);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'SMITH could not answer.');
    } finally {
      setChatBusy(false);
    }
  }

  // Kick off SMITH's opening analysis once the accounts are loaded.
  useEffect(() => {
    if (loading || !accounts?.found || kickedOff.current) return;
    kickedOff.current = true;
    const opening: ChatMessage = { role: 'user', content: OPENING_PROMPT };
    setMessages([opening]);
    void sendMessages([opening]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accounts]);

  function send() {
    const text = draft.trim();
    if (!text || chatBusy) return;
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages(history);
    setDraft('');
    void sendMessages(history);
  }

  function applyProposal() {
    if (!proposal) return;
    setMapping(prev => {
      const next = { ...prev };
      for (const c of proposal.changes) next[c.field] = c.value;
      return next;
    });
    setProposal(null);
    setMessages(prev => [...prev, { role: 'assistant', content: '✓ Applied. Anything else?' }]);
  }

  function setBox(field: NumericTradingKey, raw: string) {
    const cleaned = raw.replace(/[^0-9.\-]/g, '');
    setMapping(prev => ({ ...prev, [field]: cleaned === '' || cleaned === '-' ? 0 : Number(cleaned) }));
  }

  const lines = accounts?.lines ?? [];
  const incomeLines = lines.filter(l => l.section === 'income');
  const expenseLines = lines.filter(l => l.section === 'expense');

  // The opening user prompt is boilerplate — don't show it in the transcript.
  const visibleMessages = messages.filter(m => m.content !== OPENING_PROMPT);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><Sparkles size={15} /></span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Import from Accounts Studio</h2>
            <p className="text-[11px] text-slate-500 truncate">SMITH maps this company&apos;s accounts into the CT600 trading boxes — refine with SMITH, then apply.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading the accounts…
          </div>
        ) : loadError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{loadError}</p>
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Close</button>
          </div>
        ) : !accounts?.found ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <span className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center"><Sparkles size={18} /></span>
            <p className="text-sm text-slate-600 max-w-sm">
              No Accounts Studio accounts found for this company&apos;s period — prepare the accounts in Accounts Studio first, or enter the figures manually.
            </p>
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Close</button>
          </div>
        ) : (
          <>
            <div className="flex-1 flex min-h-0" style={{ minHeight: 0 }}>
              {/* ── Left / figures ─────────────────────────────────────────── */}
              <div className="min-w-0 overflow-y-auto p-5 border-r border-slate-200" style={{ flex: '1.4 1 0%' }}>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <h3 className="text-xs font-semibold text-slate-700">Figures for the CT600</h3>
                  {(accounts.periodStart || accounts.periodEnd) && (
                    <span className="text-[11px] text-slate-400">
                      {accounts.periodStart ? fmtDateUK(accounts.periodStart) : '—'} to {accounts.periodEnd ? fmtDateUK(accounts.periodEnd) : '—'}
                    </span>
                  )}
                </div>

                {accounts.note && (
                  <div className="mb-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                    <Sparkles size={13} className="mt-0.5 shrink-0" /> {accounts.note}
                  </div>
                )}

                {/* Editable mapped boxes */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  {EDITABLE_ROWS.map((row, i) => (
                    <div
                      key={row.field}
                      className={`grid grid-cols-[1fr_140px] gap-x-3 items-center px-3 py-2 ${i > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      <label className="text-xs text-slate-700" htmlFor={`ct600-${row.field}`}>{row.label}</label>
                      <input
                        id={`ct600-${row.field}`}
                        type="text"
                        inputMode="decimal"
                        className="input-base text-right"
                        value={mapping[row.field] ? String(mapping[row.field]) : ''}
                        onChange={e => setBox(row.field, e.target.value)}
                        placeholder="0.00"
                        aria-label={row.label}
                      />
                    </div>
                  ))}
                </div>

                <p className="mt-2 text-[11px] text-slate-400">
                  Taxable trading profit = profit per accounts + add-backs (disallowables) − capital allowances. Ask SMITH on the right about anything to check.
                </p>

                {/* Accounts P&L reference */}
                <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowLines(s => !s)}
                    className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-50"
                  >
                    <ChevronDown size={13} className={`text-slate-400 transition-transform ${showLines ? '' : '-rotate-90'}`} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex-1">Accounts P&amp;L</span>
                    <span className="text-[10px] text-slate-400">source figures</span>
                  </button>
                  {showLines && (
                    <div className="border-t border-slate-100 px-3 py-2 text-xs space-y-2">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Income</div>
                        <ul className="space-y-0.5">
                          {incomeLines.length ? incomeLines.map((l, i) => (
                            <li key={i} className="flex justify-between gap-3 text-slate-600">
                              <span className="min-w-0 truncate">{l.label}</span>
                              <span className="tabular-nums shrink-0">{money(l.amount)}</span>
                            </li>
                          )) : <li className="text-slate-400">(none)</li>}
                        </ul>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Expenses</div>
                        <ul className="space-y-0.5">
                          {expenseLines.length ? expenseLines.map((l, i) => (
                            <li key={i} className="flex justify-between gap-3 text-slate-600">
                              <span className="min-w-0 truncate">{l.label}</span>
                              <span className="tabular-nums shrink-0">{money(l.amount)}</span>
                            </li>
                          )) : <li className="text-slate-400">(none)</li>}
                        </ul>
                      </div>
                      <div className="border-t border-slate-100 pt-1.5 space-y-0.5">
                        <div className="flex justify-between gap-3 text-slate-700 font-medium">
                          <span>Turnover</span><span className="tabular-nums">{money(accounts.turnover)}</span>
                        </div>
                        <div className="flex justify-between gap-3 text-slate-700 font-medium">
                          <span>Net profit</span><span className="tabular-nums">{money(accounts.netProfit)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right / chat ───────────────────────────────────────────── */}
              <div className="shrink-0 bg-slate-50/60 flex flex-col min-h-0" style={{ flex: '1 1 0%' }}>
                <div className="px-3.5 py-2 border-b border-slate-200 flex items-center gap-2 bg-white">
                  <Sparkles size={13} className="text-indigo-600" />
                  <h3 className="text-xs font-semibold text-slate-800 flex-1">Chat to SMITH</h3>
                  <span className="text-[10px] text-slate-400">proposes, you approve</span>
                </div>

                <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">
                  {visibleMessages.map((m, i) => (
                    <div
                      key={i}
                      className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${
                        m.role === 'user'
                          ? 'bg-indigo-600 text-white ml-6 whitespace-pre-wrap'
                          : 'bg-white border border-slate-200 text-slate-700 mr-2'
                      }`}
                    >
                      {m.role === 'assistant' ? <ChatMarkdown text={m.content} /> : m.content}
                    </div>
                  ))}

                  {chatBusy && (
                    <div className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" /> Thinking…
                    </div>
                  )}

                  {proposal && (
                    <div className="rounded-xl border border-indigo-200 bg-white overflow-hidden">
                      <div className="px-3 py-2 border-b border-indigo-100 bg-indigo-50/60">
                        <div className="text-[11px] font-semibold text-indigo-900 flex items-center gap-1.5">
                          <Sparkles size={12} /> Proposed change
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{renderInline(proposal.summary)}</p>
                      </div>
                      <ul className="px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
                        {proposal.changes.map((c, i) => (
                          <li key={i} className="text-[11px] text-slate-600 flex justify-between gap-3">
                            <span className="min-w-0 truncate">{FIELD_LABELS[c.field] ?? c.field}</span>
                            <span className="tabular-nums shrink-0">{money(c.value)}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setProposal(null)}
                          className="text-[11px] px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100"
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={applyProposal}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  )}

                  {chatError && (
                    <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{chatError}</div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="border-t border-slate-200 p-2.5 bg-white">
                  <div className="flex items-end gap-1.5">
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                      rows={2}
                      placeholder="e.g. add back the depreciation as a disallowable"
                      aria-label="Message SMITH"
                      className="flex-1 resize-none text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-400"
                    />
                    <button
                      type="button"
                      onClick={send}
                      disabled={chatBusy || !draft.trim()}
                      aria-label="Send"
                      className="w-8 h-8 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center shrink-0"
                    >
                      <Send size={13} />
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Nothing changes until you press Apply.</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-2 bg-slate-50">
              <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
              <button
                type="button"
                onClick={() => { onApply(mapping); onClose(); }}
                className="btn-primary text-sm"
              >
                Apply to return
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
