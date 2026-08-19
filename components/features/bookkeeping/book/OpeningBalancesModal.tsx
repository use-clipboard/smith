'use client';

/**
 * OpeningBalancesModal — AI opening-balances wizard.
 *
 * Step 1 (upload): the user drops a prior-year trial balance / set of accounts
 * (PDF, image, CSV or Excel) and picks what to bring in — balance sheet only,
 * the full trial balance, or P&L only. PDFs and images go to the AI as base64;
 * CSV/Excel are parsed to text client-side first.
 *
 * Step 2 (review): a two-pane workspace.
 *   • Left — the figures. Every line the document carried is here, tagged 'bs'
 *     or 'pl'; the scope choice decides which arrive switched on, and can be
 *     changed here without re-running the AI because nothing was discarded.
 *   • Right — chat to SMITH about the extraction. SMITH proposes changes; the
 *     user approves them on a diff card before they touch the grid.
 *
 * Then one opening journal is posted through the existing /transactions
 * endpoint. Nothing posts without the user's click — the AI only prepares the
 * proposal.
 *
 * ─── The roll-up line ───────────────────────────────────────────────────────
 * Taking only the balance sheet off a full-year trial balance leaves the
 * reserves line at its BROUGHT-FORWARD figure — the year's result is in the
 * P&L nominals that have been set aside. So in 'bs' scope we add one line
 * carrying that net result to retained earnings, which makes the opening
 * reserve the CLOSING reserve (what a migration actually needs) and squares
 * the journal at the same time. The server suppresses it when the balance
 * sheet already balances on its own — that's a post-closing trial balance
 * whose reserves are already rolled, and adding it would double-count.
 * 'pl' scope gets the mirror image: a contra to the same account.
 */

import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  X, UploadCloud, Loader2, Sparkles, FileText, Check, Plus, Trash2,
  AlertTriangle, ShieldCheck, Scale, MessageSquare, Send, ChevronDown,
  ChevronRight, Eye, PanelRightClose, PanelRightOpen, Wand2,
} from 'lucide-react';
import AccountPicker from '../input/AccountPicker';
import ChatMarkdown, { renderInline } from '@/components/ui/ChatMarkdown';
import DateInput, { toIso, fromIso } from '../input/DateInput';
import { formatMoney } from '@/lib/bookkeeping/formatMoney';
import { fileToBase64, readFileAsText, compressImage } from '@/utils/fileUtils';
import type { BookAccountRef } from '@/types/bookkeeping';

type Scope = 'bs' | 'all' | 'pl';
type Section = 'bs' | 'pl';

interface NewAccountSuggestion { name: string; ledger: string; account_type: string }

interface ApiLine {
  account_id: string | null;
  account_name: string;
  account_ledger: string | null;
  new_account: NewAccountSuggestion | null;
  label: string;
  section: Section;
  debit: number;
  credit: number;
}

interface ApiRollup {
  account_id: string | null;
  account_name: string;
  account_ledger: string | null;
  label: string;
  debit: number;
  credit: number;
}

interface EditLine {
  key: string;
  account_id: string | null;
  account_display: string;
  suggestedNew: NewAccountSuggestion | null;
  label: string;
  section: Section;
  /** Switched on = part of the journal. Off = extracted but set aside. */
  included: boolean;
  /** Set on the derived retained-earnings line so it can be re-derived and
   *  explained differently from a line that came off the document. */
  synthetic: 'rollup' | 'contra' | null;
  debit: number;
  credit: number;
}

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface ProposalOp { op: string; [k: string]: unknown }
interface Proposal { summary: string; ops: ProposalOp[] }

const SCOPE_OPTIONS: Array<{ id: Scope; label: string; hint: string }> = [
  { id: 'bs', label: 'Balance sheet only', hint: 'Migrating from other software — the closing position carries in, and the year’s result is rolled into reserves.' },
  { id: 'all', label: 'Full trial balance', hint: 'Bring the year’s trading in too. Use when this book’s first period covers the document’s period.' },
  { id: 'pl', label: 'P&L only', hint: 'Income and expenses alone, with a contra to reserves.' },
];

let keySeq = 0;
const nextKey = () => `ob${++keySeq}`;

function isPdf(f: File) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); }
function isImage(f: File) { return f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name); }
function isSheet(f: File) { return /\.(csv|xlsx?|xls)$/i.test(f.name) || f.type.includes('csv') || f.type.includes('sheet') || f.type.includes('excel'); }

/** Create an account (or find it if it already exists) — shared by the inline
 *  "Create & use" hint and by applying a SMITH proposal. */
async function ensureAccount(bookId: string, suggestion: NewAccountSuggestion): Promise<BookAccountRef> {
  const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(suggestion),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.account) return d.account as BookAccountRef;
  if (r.status === 409) {
    const g = await fetch(`/api/bookkeeping/books/${bookId}/accounts?ledger=${encodeURIComponent(suggestion.ledger)}&search=${encodeURIComponent(suggestion.name)}`);
    const gd = await g.json().catch(() => ({}));
    const match = (gd.accounts ?? []).find((a: BookAccountRef) => a.name.toLowerCase() === suggestion.name.toLowerCase());
    if (match) return match;
  }
  throw new Error(d.error ?? 'Could not create the account.');
}

const displayOf = (ledger: string | null, name: string) => (ledger ? `${ledger}: ${name}` : name);

export default function OpeningBalancesModal({
  bookId, bookName, firstPeriodStart, onClose, onPosted,
}: {
  bookId: string;
  bookName?: string;
  firstPeriodStart: string | null;
  onClose: () => void;
  onPosted?: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const [scope, setScope] = useState<Scope>('bs');
  const [lines, setLines] = useState<EditLine[]>([]);
  const [rollup, setRollup] = useState<ApiRollup | null>(null);
  const [rollupNeeded, setRollupNeeded] = useState(false);
  const [dateUk, setDateUk] = useState('');
  const [detectedDate, setDetectedDate] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postedRef, setPostedRef] = useState<string | null>(null);

  // Chat state
  const [chatOpen, setChatOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applying, setApplying] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, proposal, chatBusy]);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    // Snapshot NOW, not inside the state updater. `list` is the input's live
    // FileList, and the caller resets `input.value` (so re-picking the same
    // file still fires change) the moment this returns — which empties it.
    // Reading it lazily in the updater got us an empty array every time.
    const picked = Array.from(list);
    setError('');
    setFiles(prev => [...prev, ...picked]);
  }

  // ── Scope ──────────────────────────────────────────────────────────────────
  // Switching scope only flips `included` and re-derives the synthetic line —
  // every figure the document carried stays in state, so this costs nothing and
  // the user's own edits survive the switch.
  function buildSynthetic(next: Scope, rl: ApiRollup, needed: boolean): EditLine | null {
    if (next === 'bs') {
      if (!needed) return null;
      return {
        key: nextKey(), account_id: rl.account_id,
        account_display: rl.account_id ? displayOf(rl.account_ledger, rl.account_name) : '',
        suggestedNew: null, label: rl.label, section: 'bs', included: true,
        synthetic: 'rollup', debit: rl.debit, credit: rl.credit,
      };
    }
    if (next === 'pl') {
      // Mirror: the nominals alone never balance, so the contra is the opposite
      // side of the same roll-up figure.
      return {
        key: nextKey(), account_id: rl.account_id,
        account_display: rl.account_id ? displayOf(rl.account_ledger, rl.account_name) : '',
        suggestedNew: null, label: 'Contra to reserves', section: 'bs', included: true,
        synthetic: 'contra', debit: rl.credit, credit: rl.debit,
      };
    }
    return null;
  }

  function applyScope(next: Scope) {
    setScope(next);
    setLines(prev => {
      const base = prev.filter(l => !l.synthetic).map(l => ({
        ...l,
        included: next === 'all' ? true : l.section === next,
      }));
      const synth = rollup ? buildSynthetic(next, rollup, rollupNeeded) : null;
      return synth ? [...base, synth] : base;
    });
  }

  async function extract() {
    if (files.length === 0) { setError('Choose a trial balance or set of accounts first.'); return; }
    setBusy(true);
    setError('');
    try {
      const apiFiles: { name: string; mimeType: string; base64: string }[] = [];
      const textParts: string[] = [];
      for (const f of files) {
        if (isSheet(f)) {
          if (/\.(xlsx?|xls)$/i.test(f.name) || f.type.includes('sheet') || f.type.includes('excel')) {
            const buf = await f.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const csv = wb.SheetNames.map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
            textParts.push(`${f.name}:\n${csv}`);
          } else {
            textParts.push(`${f.name}:\n${await readFileAsText(f)}`);
          }
        } else if (isImage(f)) {
          const compressed = await compressImage(f).catch(() => f);
          apiFiles.push({ name: f.name, mimeType: 'image/jpeg', base64: await fileToBase64(compressed) });
        } else if (isPdf(f)) {
          apiFiles.push({ name: f.name, mimeType: 'application/pdf', base64: await fileToBase64(f) });
        } else {
          // Unknown — try as text.
          textParts.push(`${f.name}:\n${await readFileAsText(f).catch(() => '')}`);
        }
      }

      const r = await fetch(`/api/bookkeeping/books/${bookId}/opening-balances/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: apiFiles, textContent: textParts.join('\n\n') || null, scope }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not read the document.');

      const apiLines = (d.lines ?? []) as ApiLine[];
      if (apiLines.length === 0) throw new Error('No balances were found in that document.');

      const rl = (d.rollup ?? null) as ApiRollup | null;
      const needed = Boolean(d.rollupNeeded);
      setRollup(rl);
      setRollupNeeded(needed);

      const base: EditLine[] = apiLines.map(l => ({
        key: nextKey(),
        account_id: l.account_id,
        account_display: displayOf(l.account_ledger, l.account_name),
        suggestedNew: l.new_account,
        label: l.label,
        section: l.section,
        included: scope === 'all' ? true : l.section === scope,
        synthetic: null,
        debit: l.debit,
        credit: l.credit,
      }));
      const synth = rl ? buildSynthetic(scope, rl, needed) : null;
      setLines(synth ? [...base, synth] : base);

      setDetectedDate(d.detectedDate ?? null);
      setDateUk(fromIso(d.defaultDate ?? firstPeriodStart ?? new Date().toISOString().slice(0, 10)));
      const extractionNote = (d.note ?? '') as string;
      setNote(extractionNote);
      setMessages([{
        role: 'assistant',
        content: extractionNote
          ? `${extractionNote}\n\nTell me what to change and I'll restate the figures for you to approve.`
          : 'I\'ve mapped the document to this book. Tell me what to change and I\'ll restate the figures for you to approve.',
      }]);
      setProposal(null);
      setChatError('');
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the document.');
    } finally {
      setBusy(false);
    }
  }

  function patchLine(key: string, patch: Partial<EditLine>) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  }
  function setAccount(key: string, account: BookAccountRef | null) {
    patchLine(key, {
      account_id: account?.id ?? null,
      account_display: account ? displayOf(account.ledger, account.name) : '',
      suggestedNew: null,
    });
  }
  function setAmount(key: string, side: 'debit' | 'credit', raw: string) {
    const n = Math.max(0, Number(raw.replace(/[^0-9.]/g, '')) || 0);
    patchLine(key, side === 'debit' ? { debit: n, credit: 0 } : { credit: n, debit: 0 });
  }

  const activeLines = lines.filter(l => l.included);
  const excludedLines = lines.filter(l => !l.included);
  const totalDebit = activeLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = activeLines.reduce((s, l) => s + l.credit, 0);
  const diff = +(totalDebit - totalCredit).toFixed(2);
  const balanced = Math.abs(diff) < 0.005;
  const allAccountsSet = activeLines.every(l => l.account_id);
  const canPost = balanced && allAccountsSet && activeLines.length > 0 && !posting && !postedRef;

  function addBalancingLine() {
    // Append a line carrying the difference on the side that squares the books.
    // The user picks the contra account (Opening balances contra / Suspense).
    setLines(prev => [...prev, {
      key: nextKey(), account_id: null, account_display: '', suggestedNew: null,
      label: 'Opening balance contra', section: 'bs', included: true, synthetic: null,
      debit: diff < 0 ? Math.abs(diff) : 0,
      credit: diff > 0 ? diff : 0,
    }]);
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  async function send() {
    const text = draft.trim();
    if (!text || chatBusy) return;
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages(history);
    setDraft('');
    setChatBusy(true);
    setChatError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/opening-balances/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          lines: lines.map(l => ({
            key: l.key, account_id: l.account_id, account_display: l.account_display,
            label: l.label, section: l.section, included: l.included,
            debit: l.debit, credit: l.credit,
          })),
          openingDate: dateUk ? toIso(dateUk) : null,
          scope,
          note,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'SMITH could not answer.');
      setMessages(prev => [...prev, { role: 'assistant', content: d.reply ?? '' }]);
      setProposal((d.proposal ?? null) as Proposal | null);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'SMITH could not answer.');
    } finally {
      setChatBusy(false);
    }
  }

  /** Apply an approved proposal. New accounts are created here — on the user's
   *  click, never on SMITH's say-so. */
  async function applyProposal() {
    if (!proposal || applying) return;
    setApplying(true);
    setChatError('');
    try {
      // Resolve every new_account first so a mid-way failure doesn't leave the
      // grid half-changed.
      const created = new Map<string, BookAccountRef>();
      for (const op of proposal.ops) {
        const na = op.new_account as NewAccountSuggestion | null | undefined;
        if (!na) continue;
        const k = `${na.ledger}:::${na.name}`;
        if (!created.has(k)) created.set(k, await ensureAccount(bookId, na));
      }
      const resolve = (op: ProposalOp): BookAccountRef | null => {
        const na = op.new_account as NewAccountSuggestion | null | undefined;
        if (na) return created.get(`${na.ledger}:::${na.name}`) ?? null;
        return null;
      };

      let nextScope: Scope | null = null;
      setLines(prev => {
        let next = [...prev];
        for (const op of proposal.ops) {
          const key = typeof op.key === 'string' ? op.key : '';
          switch (op.op) {
            case 'include_line':
              next = next.map(l => l.key === key ? { ...l, included: true } : l);
              break;
            case 'exclude_line':
              next = next.map(l => l.key === key ? { ...l, included: false } : l);
              break;
            case 'remove_line':
              next = next.filter(l => l.key !== key);
              break;
            case 'update_line': {
              const acct = resolve(op);
              next = next.map(l => {
                if (l.key !== key) return l;
                const patch: Partial<EditLine> = {};
                if (typeof op.account_id === 'string') {
                  patch.account_id = op.account_id;
                  patch.suggestedNew = null;
                } else if (acct) {
                  patch.account_id = acct.id;
                  patch.account_display = displayOf(acct.ledger, acct.name);
                  patch.suggestedNew = null;
                }
                if (typeof op.label === 'string') patch.label = op.label;
                if (typeof op.debit === 'number' || typeof op.credit === 'number') {
                  patch.debit = Number(op.debit ?? 0);
                  patch.credit = Number(op.credit ?? 0);
                }
                return { ...l, ...patch };
              });
              break;
            }
            case 'add_line': {
              const acct = resolve(op);
              next = [...next, {
                key: nextKey(),
                account_id: typeof op.account_id === 'string' ? op.account_id : acct?.id ?? null,
                account_display: acct ? displayOf(acct.ledger, acct.name) : '',
                suggestedNew: null,
                label: typeof op.label === 'string' ? op.label : '',
                section: op.section === 'pl' ? 'pl' : 'bs',
                included: true,
                synthetic: null,
                debit: Number(op.debit ?? 0),
                credit: Number(op.credit ?? 0),
              }];
              break;
            }
            case 'set_scope':
              nextScope = op.scope as Scope;
              break;
            default:
              break;
          }
        }
        return next;
      });

      for (const op of proposal.ops) {
        if (op.op === 'set_opening_date' && typeof op.date === 'string') setDateUk(fromIso(op.date));
      }
      // Scope last — it re-derives `included` across the board, so it must not
      // be overwritten by the per-line ops above.
      if (nextScope) applyScope(nextScope);

      setProposal(null);
      setMessages(prev => [...prev, { role: 'assistant', content: '✓ Applied. Anything else?' }]);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Could not apply those changes.');
    } finally {
      setApplying(false);
    }
  }

  async function post() {
    if (!canPost) return;
    setPosting(true);
    setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'JRN',
          date: toIso(dateUk),
          details: 'Opening balances',
          total: +totalDebit.toFixed(2),
          vat_total: 0,
          vat_treatment: null,
          primary_account_id: null,
          splits: activeLines.map(l => ({
            account_id: l.account_id,
            debit: +l.debit.toFixed(2),
            credit: +l.credit.toFixed(2),
            entry_details: l.label || 'Opening balance',
          })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not post the opening balances.');
      setPostedRef(d.transaction?.ref_no ?? 'JRN');
      onPosted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post the opening balances.');
    } finally {
      setPosting(false);
    }
  }

  const wide = step === 'review' && !postedRef && chatOpen;

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-6xl' : 'max-w-3xl'} max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden transition-[max-width]`}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><Sparkles size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Opening Balances{bookName ? ` — ${bookName}` : ''}</h2>
            <p className="text-[11px] text-slate-500">Upload last year&apos;s accounts or trial balance — SMITH maps them to this book and prepares the opening journal.</p>
          </div>
          {step === 'review' && !postedRef && (
            <button
              type="button"
              onClick={() => setChatOpen(o => !o)}
              className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              {chatOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
              {chatOpen ? 'Hide chat' : 'Chat to SMITH'}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* ── Left / main pane ─────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            {error && <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

            {step === 'upload' && (
              <div className="space-y-4">
                <label
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-10 px-6 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
                >
                  <UploadCloud size={26} className="text-slate-400" />
                  <span className="text-sm font-medium text-slate-700">Drop files here, or click to choose</span>
                  <span className="text-xs text-slate-500">Trial balance or accounts — PDF, JPG, PNG, CSV or Excel</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.csv,.xlsx,.xls,.jpg,.jpeg,.png,image/*,application/pdf"
                    className="hidden"
                    onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                  />
                </label>

                {files.length > 0 && (
                  <ul className="space-y-1.5">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                        <FileText size={14} className="text-slate-400 shrink-0" />
                        <span className="flex-1 truncate">{f.name}</span>
                        <span className="text-xs text-slate-400">{Math.round(f.size / 1024)} KB</span>
                        <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} aria-label="Remove" className="text-slate-400 hover:text-rose-500"><X size={14} /></button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* What to bring in */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-1.5">What should SMITH bring in?</h3>
                  <div className="space-y-1.5">
                    {SCOPE_OPTIONS.map(o => (
                      <label
                        key={o.id}
                        className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                          scope === o.id ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="ob-scope"
                          checked={scope === o.id}
                          onChange={() => setScope(o.id)}
                          className="mt-0.5 accent-indigo-600"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-slate-800">{o.label}</span>
                          <span className="block text-[11px] text-slate-500 leading-snug">{o.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    SMITH reads the whole document either way — you can switch this after seeing the figures without paying for a second read.
                  </p>
                </div>

                <div className="flex justify-end">
                  <button type="button" onClick={extract} disabled={busy || files.length === 0} className="btn-primary text-sm disabled:opacity-50">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {busy ? 'Reading…' : 'Extract balances'}
                  </button>
                </div>
              </div>
            )}

            {step === 'review' && (
              <div className="space-y-3">
                {postedRef ? (
                  <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800">
                    <ShieldCheck size={18} className="text-emerald-600" />
                    Opening balances posted as <span className="font-semibold">{postedRef}</span>.
                  </div>
                ) : (
                  <>
                    {note && (
                      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                        <Sparkles size={13} className="mt-0.5 shrink-0" /> {note}
                      </div>
                    )}

                    {/* Scope */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Bringing in</span>
                      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px]">
                        {SCOPE_OPTIONS.map((o, i) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => applyScope(o.id)}
                            className={`px-2.5 py-1 ${i > 0 ? 'border-l border-slate-200' : ''} ${
                              scope === o.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-white text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-xs text-slate-600 inline-flex items-center gap-2">
                        Opening date
                        <span className="w-32"><DateInput value={dateUk} onChange={setDateUk} ariaLabel="Opening balance date" /></span>
                      </label>
                      <span className="text-[11px] text-slate-400">
                        {detectedDate ? 'Balance date read from the document.' : 'Posted as a single opening journal on this date.'}
                      </span>
                    </div>

                    {/* Grid */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-[1fr_110px_110px_32px] gap-x-2 px-3 py-1.5 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                        <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
                      </div>
                      <div className="divide-y divide-slate-100">
                        {activeLines.map(l => (
                          <div key={l.key} className={`grid grid-cols-[1fr_110px_110px_32px] gap-x-2 px-3 py-1.5 items-start ${l.synthetic ? 'bg-indigo-50/40' : ''}`}>
                            <div>
                              <AccountPicker
                                bookId={bookId}
                                value={l.account_id}
                                valueDisplay={l.account_id ? l.account_display : undefined}
                                onChange={acct => setAccount(l.key, acct)}
                                placeholder={l.suggestedNew ? `New: ${l.suggestedNew.ledger}: ${l.suggestedNew.name}` : (l.label || 'Choose account')}
                              />
                              {l.synthetic && (
                                <p className="mt-0.5 text-[11px] text-indigo-600 flex items-start gap-1">
                                  <Wand2 size={11} className="mt-0.5 shrink-0" />
                                  {l.synthetic === 'rollup'
                                    ? 'Net result of the excluded P&L nominals — carries the brought-forward reserve to its closing figure.'
                                    : 'Contra to reserves — P&L nominals alone don’t balance.'}
                                </p>
                              )}
                              {l.suggestedNew && !l.account_id && (
                                <SuggestedAccountHint bookId={bookId} suggestion={l.suggestedNew} onCreated={acct => setAccount(l.key, acct)} />
                              )}
                              {!l.account_id && !l.suggestedNew && !l.synthetic && (
                                <p className="mt-0.5 text-[11px] text-amber-600">From “{l.label}” — choose an account.</p>
                              )}
                            </div>
                            <input type="text" inputMode="decimal" aria-label="Debit" value={l.debit ? String(l.debit) : ''} onChange={e => setAmount(l.key, 'debit', e.target.value)} placeholder="0.00" className="text-right text-sm tabular-nums bg-white border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-indigo-400 w-full" />
                            <input type="text" inputMode="decimal" aria-label="Credit" value={l.credit ? String(l.credit) : ''} onChange={e => setAmount(l.key, 'credit', e.target.value)} placeholder="0.00" className="text-right text-sm tabular-nums bg-white border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-indigo-400 w-full" />
                            <div className="flex justify-center pt-1.5">
                              <button type="button" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} aria-label="Remove line" className="text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Totals */}
                      <div className="grid grid-cols-[1fr_110px_110px_32px] gap-x-2 px-3 py-2 border-t border-slate-200 bg-slate-50/60 items-center text-sm">
                        <button type="button" onClick={() => setLines(prev => [...prev, { key: nextKey(), account_id: null, account_display: '', suggestedNew: null, label: '', section: 'bs', included: true, synthetic: null, debit: 0, credit: 0 }])} className="text-xs text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 justify-self-start">
                          <Plus size={12} /> Add line
                        </button>
                        <span className="text-right tabular-nums font-semibold text-slate-800">{formatMoney(totalDebit)}</span>
                        <span className="text-right tabular-nums font-semibold text-slate-800">{formatMoney(totalCredit)}</span>
                        <span />
                      </div>
                    </div>

                    {/* Set aside — never silently dropped */}
                    {excludedLines.length > 0 && (
                      <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowExcluded(s => !s)}
                          className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-50"
                        >
                          {showExcluded ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex-1">
                            {excludedLines.length} line{excludedLines.length === 1 ? '' : 's'} set aside
                          </span>
                          <span className="text-[10px] text-slate-400">read from the document, not in the journal</span>
                        </button>
                        {showExcluded && (
                          <ul className="divide-y divide-slate-50 max-h-52 overflow-y-auto border-t border-slate-100">
                            {excludedLines.map(l => (
                              <li key={l.key} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                                <span className="flex-1 min-w-0 truncate text-slate-500">
                                  {l.account_display || l.label}
                                  {l.section === 'pl' && <span className="ml-1.5 text-[10px] text-slate-400">P&amp;L</span>}
                                </span>
                                <span className="tabular-nums text-slate-400 shrink-0">
                                  {l.debit ? `Dr ${formatMoney(l.debit)}` : `Cr ${formatMoney(l.credit)}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => patchLine(l.key, { included: true })}
                                  className="text-[11px] text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 shrink-0"
                                >
                                  <Eye size={11} /> Include
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Balance status */}
                    <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                      {balanced ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700"><ShieldCheck size={14} /> Balanced{!allAccountsSet ? ' — assign an account to every line' : ''}</span>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-amber-700 flex-wrap">
                          <AlertTriangle size={14} /> Out of balance by {formatMoney(Math.abs(diff))}
                          <button type="button" onClick={addBalancingLine} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 underline"><Scale size={12} /> Add balancing line</button>
                          {!chatOpen && (
                            <button type="button" onClick={() => setChatOpen(true)} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 underline"><MessageSquare size={12} /> Ask SMITH why</button>
                          )}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Right pane — chat to SMITH ────────────────────────────────────── */}
          {wide && (
            <div className="w-[360px] shrink-0 border-l border-slate-200 bg-slate-50/60 flex flex-col min-h-0">
              <div className="px-3.5 py-2 border-b border-slate-200 flex items-center gap-2 bg-white">
                <MessageSquare size={13} className="text-indigo-600" />
                <h3 className="text-xs font-semibold text-slate-800 flex-1">Chat to SMITH</h3>
                <span className="text-[10px] text-slate-400">proposes, you approve</span>
              </div>

              <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`text-xs leading-relaxed rounded-xl px-3 py-2 ${
                      m.role === 'user'
                        ? 'bg-indigo-600 text-white ml-6 whitespace-pre-wrap'
                        : 'bg-white border border-slate-200 text-slate-700 mr-2'
                    }`}
                  >
                    {/* SMITH's replies come back as markdown; the user's own
                        words are shown verbatim. */}
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
                        <Wand2 size={12} /> Proposed change
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{renderInline(proposal.summary)}</p>
                    </div>
                    <ul className="px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
                      {proposal.ops.map((op, i) => (
                        <li key={i} className="text-[11px] text-slate-600">• {describeOp(op, lines)}</li>
                      ))}
                    </ul>
                    <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setProposal(null)}
                        disabled={applying}
                        className="text-[11px] px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={applyProposal}
                        disabled={applying}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        {applying ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                        {applying ? 'Applying…' : 'Apply'}
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
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    rows={2}
                    placeholder="e.g. include the income and expenses too"
                    aria-label="Message SMITH"
                    className="flex-1 resize-none text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    onClick={() => void send()}
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
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-2 bg-slate-50">
            <button type="button" onClick={() => { setStep('upload'); setPostedRef(null); }} className="text-sm text-slate-500 hover:text-slate-700">{postedRef ? '← Start over' : '← Back'}</button>
            {postedRef ? (
              <button type="button" onClick={onClose} className="btn-primary text-sm">Done</button>
            ) : (
              <button type="button" onClick={post} disabled={!canPost} className="btn-primary text-sm disabled:opacity-50">
                {posting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {posting ? 'Posting…' : `Post opening balances${activeLines.length ? ` (${activeLines.length} lines)` : ''}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Plain-English rendering of one proposed operation for the approval card. */
function describeOp(op: ProposalOp, lines: EditLine[]): string {
  const line = lines.find(l => l.key === op.key);
  const name = line ? (line.account_display || line.label || 'line') : 'line';
  const amount = (typeof op.debit === 'number' && op.debit > 0)
    ? `Dr ${formatMoney(Number(op.debit))}`
    : (typeof op.credit === 'number' && op.credit > 0) ? `Cr ${formatMoney(Number(op.credit))}` : '';
  const na = op.new_account as NewAccountSuggestion | null | undefined;

  switch (op.op) {
    case 'include_line': return `Bring in ${name}`;
    case 'exclude_line': return `Set aside ${name}`;
    case 'remove_line': return `Delete ${name}`;
    case 'update_line': {
      const bits: string[] = [];
      if (na) bits.push(`new account ${na.ledger}: ${na.name}`);
      else if (op.account_id) bits.push('reassign the account');
      if (amount) bits.push(amount);
      if (typeof op.label === 'string' && op.label) bits.push(`narrative “${op.label}”`);
      return `Change ${name}${bits.length ? ` — ${bits.join(', ')}` : ''}`;
    }
    case 'add_line':
      return `Add ${na ? `${na.ledger}: ${na.name} (new account)` : (typeof op.label === 'string' && op.label ? op.label : 'a line')}${amount ? ` — ${amount}` : ''}`;
    case 'set_opening_date':
      return `Set the opening date to ${typeof op.date === 'string' ? fromIso(op.date) : ''}`;
    case 'set_scope':
      return op.scope === 'all' ? 'Bring in the full trial balance (P&L included)'
        : op.scope === 'bs' ? 'Bring in the balance sheet only'
        : 'Bring in the P&L only';
    default:
      return op.op;
  }
}

// "Create & use" for an AI-suggested new account.
function SuggestedAccountHint({
  bookId, suggestion, onCreated,
}: {
  bookId: string;
  suggestion: NewAccountSuggestion;
  onCreated: (acct: BookAccountRef) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function create() {
    setBusy(true); setErr('');
    try {
      onCreated(await ensureAccount(bookId, suggestion));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the account.');
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-0.5 text-[11px] text-indigo-600 flex items-center gap-1.5 flex-wrap">
      <Sparkles size={11} /><span>New account suggested</span>
      <button type="button" onClick={create} disabled={busy} className="underline hover:text-indigo-800 disabled:opacity-50 inline-flex items-center gap-1">{busy && <Loader2 size={10} className="animate-spin" />} Create &amp; use</button>
      {err && <span className="text-rose-600 w-full">{err}</span>}
    </div>
  );
}
