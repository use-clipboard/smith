'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Bold, Italic, List, Link2, Sparkles, HelpCircle, History, RotateCcw,
  ArrowRight, Check, Loader2, X, FileText, Wand2, Plus, Eye, EyeOff,
  AlertTriangle, Info, ChevronDown, ShieldCheck, Undo2, Redo2,
} from 'lucide-react';
import { StudioCard, SectionStatusPill, SectionStatusDot } from '../primitives';
import Tooltip from '@/components/ui/Tooltip';
import { ENTITY_LABELS } from '../data';
import { addableNotes, makeNote, noteRuleMeta, type DisclosureContext } from '@/lib/accounts-studio/disclosures';
import { checkDisclosures } from '@/lib/accounts-studio/disclosureCheck';
import { hasPlaceholders, countPlaceholders, highlightPlaceholders } from '@/lib/accounts-studio/placeholders';
import type { Engagement, DisclosureSection, SectionStatus, NoteLevel } from '../types';

const LEVEL_BADGE: Record<NoteLevel, { label: string; cls: string; dot: string; hint: string }> = {
  mandatory: { label: 'Required', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400', hint: 'Required — this note must be included in the accounts under the applicable framework.' },
  conditional: { label: 'Conditional', cls: 'bg-sky-100 text-sky-700', dot: 'bg-sky-400', hint: 'Conditional — included because the figures in the trial balance call for it (e.g. there are fixed assets or creditors).' },
  optional: { label: 'Optional', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-300', hint: 'Optional — a best-practice note. Include it only if it is relevant to these accounts.' },
};

export default function StageDisclosures({
  engagement, patch, advance,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
  advance: () => void;
}) {
  const sections = engagement.disclosures;
  const [selectedId, setSelectedId] = useState(sections[0]?.id ?? '');
  const [mountKey, setMountKey] = useState(0);
  const [aiBusy, setAiBusy] = useState<'rewrite' | 'explain' | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [draftingAll, setDraftingAll] = useState<{ done: number; total: number } | null>(null);
  const [checksOpen, setChecksOpen] = useState(true);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewReply, setReviewReply] = useState<string | null>(null);
  // Prior-period note wording for this client (roll a note forward year to year).
  const [priorNotes, setPriorNotes] = useState<Record<string, { title: string; content: string }>>({});
  const [priorLabel, setPriorLabel] = useState('');
  const [priorOpen, setPriorOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!engagement.clientId) return;
    const params = new URLSearchParams({ clientId: engagement.clientId, periodEnd: engagement.periodEnd, excludeId: engagement.id });
    fetch(`/api/accounts-studio/prior-disclosures?${params.toString()}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.found) { setPriorNotes(d.notes ?? {}); setPriorLabel(typeof d.periodEnd === 'string' ? d.periodEnd.slice(-4) : ''); } })
      .catch(() => {});
  }, [engagement.clientId, engagement.periodEnd, engagement.id]);

  const section = sections.find(s => s.id === selectedId) ?? sections[0];

  // Rule-engine context for this engagement (drives the ＋ Add note library + badges).
  const dctx: DisclosureContext = {
    entityType: engagement.entityType,
    size: engagement.size,
    framework: engagement.framework,
    statements: engagement.statements ?? null,
    priorYear: engagement.comparativePeriod ? engagement.comparativePeriod.slice(-4) : '',
    directors: engagement.directors,
  };
  const levelOf = (s: DisclosureSection): NoteLevel | undefined => s.level ?? noteRuleMeta(s.id, dctx)?.level ?? undefined;

  const isIncluded = (s: DisclosureSection) => s.included !== false;
  const includedSections = sections.filter(isIncluded);
  const completeCount = includedSections.filter(s => s.status === 'complete').length;
  const addable = addableNotes(dctx, sections.map(s => s.id));

  // Notes that still contain a placeholder / "please confirm" the user must fill.
  const notesNeedingInput = includedSections.filter(s => hasPlaceholders(s.content));
  const currentPh = countPlaceholders(section?.content ?? '');

  // Deterministic "is a needed note missing?" check (see disclosureCheck.ts).
  const warnings = checkDisclosures(engagement);
  const warnCount = warnings.filter(w => w.severity === 'warn').length;

  // One-click resolution for a warning: re-include an excluded note, add one
  // from the library, or (fallback) just jump to it.
  function resolveWarning(noteId: string) {
    const existing = sections.find(s => s.id === noteId);
    if (existing) {
      if (existing.included === false) toggleIncluded(noteId);
      selectSection(noteId);
      return;
    }
    if (addable.some(t => t.id === noteId)) addNote(noteId);
  }
  const resolveLabel = (noteId: string) => {
    const existing = sections.find(s => s.id === noteId);
    if (existing) return existing.included === false ? 'Include' : 'Open';
    return addable.some(t => t.id === noteId) ? 'Add note' : null;
  };

  const updateSection = useCallback((id: string, updater: (s: DisclosureSection) => DisclosureSection) => {
    patch(e => ({ ...e, disclosures: e.disclosures.map(s => s.id === id ? updater(s) : s) }));
  }, [patch]);

  // ── Undo / redo over the whole disclosures array ────────────────────────────
  // A snapshot stack. Discrete actions (AI rewrite, add/remove note, include/
  // exclude, mark complete, restore) push one step; a typing burst is coalesced
  // into a single step via a debounce so undo doesn't go character-by-character.
  const undoPast = useRef<DisclosureSection[][]>([]);
  const undoFuture = useRef<DisclosureSection[][]>([]);
  const [, bumpHist] = useState(0);
  const bump = useCallback(() => bumpHist(n => n + 1), []);
  const preEditRef = useRef<DisclosureSection[] | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushTyping = useCallback(() => {
    if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; }
    if (preEditRef.current) {
      undoPast.current.push(preEditRef.current);
      preEditRef.current = null;
      bump();
    }
  }, [bump]);

  // Record the current disclosures, then apply a discrete change.
  const commitDisclosures = useCallback((updater: (ds: DisclosureSection[]) => DisclosureSection[]) => {
    flushTyping();
    undoPast.current.push(engagement.disclosures);
    undoFuture.current = [];
    patch(e => ({ ...e, disclosures: updater(e.disclosures) }));
    bump();
  }, [engagement.disclosures, patch, flushTyping, bump]);

  const canUndo = undoPast.current.length > 0 || preEditRef.current !== null;
  const canRedo = undoFuture.current.length > 0;

  const undo = useCallback(() => {
    flushTyping();
    const prev = undoPast.current.pop();
    if (!prev) return;
    undoFuture.current.push(engagement.disclosures);
    patch(e => ({ ...e, disclosures: prev }));
    setMountKey(k => k + 1);
    bump();
  }, [engagement.disclosures, patch, flushTyping, bump]);

  const redo = useCallback(() => {
    const next = undoFuture.current.pop();
    if (!next) return;
    undoPast.current.push(engagement.disclosures);
    patch(e => ({ ...e, disclosures: next }));
    setMountKey(k => k + 1);
    bump();
  }, [engagement.disclosures, patch, bump]);

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  // Load a note's content into the editor IMPERATIVELY — only when the note
  // changes or on a deliberate content replace (mountKey bump), never on typing.
  // The editor is otherwise fully uncontrolled (no dangerouslySetInnerHTML /
  // children), so React never rewrites its DOM mid-edit and the caret stays put.
  // Live edits flow out via onEditorInput.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = section?.content || '<p></p>';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section?.id, mountKey]);

  function toggleIncluded(id: string) {
    commitDisclosures(ds => ds.map(s => s.id === id ? { ...s, included: s.included === false ? true : false } : s));
  }

  function addNote(noteId: string) {
    const note = makeNote(noteId, dctx);
    if (!note) return;
    commitDisclosures(ds => [...ds, note]);
    setShowAddNote(false);
    selectSection(note.id);
  }

  function selectSection(id: string) {
    flushTyping();
    setSelectedId(id);
    setExplanation(null);
    setShowHistory(false);
    setPriorOpen(false);
    setMountKey(k => k + 1);
  }

  // Uncontrolled editor — commit innerHTML to state on input (cursor stays put
  // because we never re-set the editor's children after mount).
  function onEditorInput() {
    const html = editorRef.current?.innerHTML ?? '';
    // Begin a typing burst — snapshot the pre-edit state once and drop the redo stack.
    if (!preEditRef.current) { preEditRef.current = engagement.disclosures; undoFuture.current = []; bump(); }
    updateSection(section.id, s => ({ ...s, content: html, status: s.status === 'missing' ? 'draft' : s.status }));
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => flushTyping(), 700);
  }

  function replaceContent(html: string, versionLabel: string, newStatus?: SectionStatus) {
    if (editorRef.current) editorRef.current.innerHTML = html;
    commitDisclosures(ds => ds.map(s => s.id === section.id ? {
      ...s,
      content: html,
      status: newStatus ?? s.status,
      history: [{ id: `v${s.history.length + 1}`, label: versionLabel, at: nowStamp(), content: html }, ...s.history],
    } : s));
    setMountKey(k => k + 1);
  }

  function format(cmd: string) {
    document.execCommand(cmd, false);
    editorRef.current?.focus();
    onEditorInput();
  }

  const priorNote = priorNotes[section.id];
  function applyPriorYear() {
    if (!priorNote) return;
    replaceContent(priorNote.content, `Prior year${priorLabel ? ` (${priorLabel})` : ''}`);
    setPriorOpen(false);
  }

  function restoreVersion(html: string) {
    replaceContent(html, 'Restored version');
    setShowHistory(false);
  }

  function markReviewed() {
    commitDisclosures(ds => ds.map(s => s.id === section.id ? { ...s, status: 'complete' } : s));
  }

  async function aiAction(mode: 'rewrite' | 'explain') {
    setAiBusy(mode);
    if (mode === 'explain') setExplanation(null);
    try {
      const res = await fetch('/api/accounts-studio/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          section: { title: section.title, requirement: section.requirement, content: stripHtml(section.content) },
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
      if (mode === 'explain') {
        setExplanation(data.reply || 'No explanation returned.');
      } else {
        const html = data.html || textToHtml(data.reply || '');
        if (html) replaceContent(html, 'Rewritten with SMITH', 'needs-review');
      }
    } catch (err) {
      setExplanation(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setAiBusy(null);
    }
  }

  const aiContext = () => ({
    companyName: engagement.companyName,
    entityType: ENTITY_LABELS[engagement.entityType],
    framework: engagement.framework,
    periodEnd: engagement.periodEnd,
    turnover: engagement.statements?.profitLoss.turnoverTotal ?? null,
    netProfit: engagement.statements?.profitLoss.netProfit ?? null,
    totalAssets: engagement.statements?.balanceSheet.totalAssets ?? null,
    netAssets: engagement.statements?.balanceSheet.netAssets ?? null,
  });

  // Draft every included note that isn't complete yet, one at a time.
  const draftTargets = includedSections.filter(s => s.status !== 'complete');
  async function draftAll() {
    if (!draftTargets.length || draftingAll) return;
    // One undo step for the whole batch.
    flushTyping();
    undoPast.current.push(engagement.disclosures);
    undoFuture.current = [];
    bump();
    setDraftingAll({ done: 0, total: draftTargets.length });
    for (let i = 0; i < draftTargets.length; i++) {
      const t = draftTargets[i];
      try {
        const res = await fetch('/api/accounts-studio/assistant', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'rewrite', section: { title: t.title, requirement: t.requirement, content: stripHtml(t.content) }, context: aiContext() }),
        });
        if (res.ok) {
          const data = await res.json();
          const html = data.html || textToHtml(data.reply || '');
          if (html) updateSection(t.id, s => ({ ...s, content: html, status: 'needs-review', history: [{ id: `v${s.history.length + 1}`, label: 'Drafted with SMITH', at: nowStamp(), content: html }, ...s.history] }));
        }
      } catch { /* skip this note, keep going */ }
      setDraftingAll({ done: i + 1, total: draftTargets.length });
    }
    setDraftingAll(null);
    setMountKey(k => k + 1); // reflect the selected note's new content in the editor
  }

  // Ask SMITH for a second opinion on the disclosure set as a whole.
  async function runReview() {
    if (reviewBusy) return;
    setReviewBusy(true); setReviewReply(null); setChecksOpen(true);
    const included = includedSections.map(s => `${s.title}${s.status === 'complete' ? '' : ' (draft)'}`).join(', ') || 'none';
    const excluded = sections.filter(s => s.included === false).map(s => s.title).join(', ') || 'none';
    const flagged = warnings.map(w => `- ${w.message}`).join('\n') || 'none flagged by the automated check';
    const prompt = [
      `Please review the disclosure notes selected for these statutory accounts and tell me if anything required is missing, thin, or included unnecessarily. Be specific and concise — a short bulleted list.`,
      ``,
      `Notes currently included: ${included}.`,
      `Notes excluded: ${excluded}.`,
      ``,
      `The automated check flagged:\n${flagged}`,
    ].join('\n');
    try {
      const res = await fetch('/api/accounts-studio/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'chat', context: aiContext(), messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'The assistant is unavailable right now.');
      }
      const data = await res.json();
      setReviewReply(data.reply || 'No response.');
    } catch (err) {
      setReviewReply(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
    {/* ── Disclosure check banner ──────────────────────────────────────────── */}
    {(warnings.length > 0 || reviewReply) && (
      <StudioCard className={`overflow-hidden border ${warnCount > 0 ? 'border-amber-300/70 bg-amber-50/60' : 'border-sky-200/70 bg-sky-50/50'}`}>
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          {warnCount > 0
            ? <AlertTriangle size={16} className="shrink-0 text-amber-600" />
            : <Info size={16} className="shrink-0 text-sky-600" />}
          <button onClick={() => setChecksOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <span className="text-[13px] font-bold text-[var(--text-primary)]">
              {warnings.length === 0
                ? 'Disclosure check passed'
                : `${warnings.length} disclosure ${warnings.length === 1 ? 'suggestion' : 'suggestions'}${warnCount > 0 ? ` · ${warnCount} to review` : ''}`}
            </span>
            <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${checksOpen ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={runReview}
            disabled={reviewBusy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[12px] font-semibold text-[var(--accent)] ring-1 ring-[var(--accent)]/20 transition-colors hover:bg-white disabled:opacity-50"
          >
            {reviewBusy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Review with SMITH
          </button>
        </div>
        {checksOpen && (
          <div className="space-y-1.5 border-t border-black/5 px-4 py-3">
            {warnings.map(w => {
              const label = resolveLabel(w.noteId);
              return (
                <div key={w.id} className="flex items-start gap-2.5">
                  {w.severity === 'warn'
                    ? <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                    : <Info size={13} className="mt-0.5 shrink-0 text-sky-500" />}
                  <p className="flex-1 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{w.message}</p>
                  {label && (
                    <button
                      onClick={() => resolveWarning(w.noteId)}
                      className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[11.5px] font-semibold text-[var(--accent)] ring-1 ring-[var(--accent)]/20 transition-colors hover:bg-[var(--accent)]/5"
                    >
                      {label}
                    </button>
                  )}
                </div>
              );
            })}
            {warnings.length === 0 && (
              <p className="text-[12.5px] text-[var(--text-secondary)]">The automated check didn&apos;t find any missing notes for this entity and framework.</p>
            )}
            {reviewReply && (
              <div className="mt-2 flex items-start gap-2 rounded-xl border border-[var(--accent)]/20 bg-white/70 px-3 py-2.5">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <p className="flex-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-secondary)]">{reviewReply}</p>
                <button onClick={() => setReviewReply(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={13} /></button>
              </div>
            )}
          </div>
        )}
      </StudioCard>
    )}

    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── Section navigation ─────────────────────────────────────────────── */}
      <StudioCard className="flex max-h-[calc(100vh-240px)] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
          <p className="text-[13px] font-bold text-[var(--text-primary)]">Disclosures</p>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{completeCount}/{includedSections.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {sections.map(s => {
            const active = s.id === section.id;
            const included = isIncluded(s);
            return (
              <div
                key={s.id}
                className={`mb-0.5 flex items-center gap-1 rounded-xl pr-1 transition-colors ${active ? 'bg-[var(--accent)]/10' : 'hover:bg-black/[0.03]'}`}
              >
                <button onClick={() => selectSection(s.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left">
                  <SectionStatusDot status={s.status} />
                  <span className={`min-w-0 flex-1 truncate text-[12.5px] font-medium ${!included ? 'text-[var(--text-muted)] line-through' : active ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{s.title}</span>
                  {included && hasPlaceholders(s.content) && (
                    <Tooltip label="Has details to complete" side="top">
                      <AlertTriangle size={11} className="shrink-0 text-amber-500" aria-label="Has details to complete" />
                    </Tooltip>
                  )}
                  {levelOf(s) && (
                    <Tooltip label={LEVEL_BADGE[levelOf(s)!].hint} side="top">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_BADGE[levelOf(s)!].dot}`} aria-label={`${LEVEL_BADGE[levelOf(s)!].label} note`} />
                    </Tooltip>
                  )}
                </button>
                <button
                  onClick={() => toggleIncluded(s.id)}
                  aria-label={included ? 'Exclude from accounts' : 'Include in accounts'}
                  title={included ? 'Included — click to exclude' : 'Excluded — click to include'}
                  className={`shrink-0 rounded p-1 transition-colors ${included ? 'text-[var(--text-muted)] hover:text-[var(--text-primary)]' : 'text-[var(--text-muted)]/60 hover:text-[var(--text-primary)]'} hover:bg-black/[0.06]`}
                >
                  {included ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="relative border-t border-black/5 p-2">
          <button
            onClick={() => setShowAddNote(v => !v)}
            disabled={!addable.length}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-2 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--accent)] disabled:opacity-40"
          >
            <Plus size={13} /> Add note
          </button>
          {showAddNote && addable.length > 0 && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowAddNote(false)} />
              <div className="absolute bottom-full left-2 right-2 z-40 mb-1 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-white p-1 shadow-xl">
                {addable.map(t => (
                  <button key={t.id} onClick={() => addNote(t.id)} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--accent)]/5">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text-primary)]">{t.title}</span>
                      <Tooltip label={LEVEL_BADGE[t.level].hint} side="top">
                        <span aria-label={LEVEL_BADGE[t.level].label} className={`shrink-0 cursor-help rounded-full px-1.5 py-px text-[9px] font-bold ${LEVEL_BADGE[t.level].cls}`}>{LEVEL_BADGE[t.level].label}</span>
                      </Tooltip>
                    </span>
                    <span className="block text-[10.5px] text-[var(--text-muted)]">{t.requirement}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </StudioCard>

      {/* ── Editor ─────────────────────────────────────────────────────────── */}
      <StudioCard className="flex max-h-[calc(100vh-240px)] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-black/5 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[14px] font-bold text-[var(--text-primary)]">{section.title}</h3>
              <SectionStatusPill status={section.status} />
              {levelOf(section) && (
                <Tooltip label={LEVEL_BADGE[levelOf(section)!].hint} side="bottom">
                  <span aria-label={LEVEL_BADGE[levelOf(section)!].label} className={`shrink-0 cursor-help rounded-full px-2 py-0.5 text-[10px] font-bold ${LEVEL_BADGE[levelOf(section)!].cls}`}>{LEVEL_BADGE[levelOf(section)!].label}</span>
                </Tooltip>
              )}
              {currentPh > 0 && (
                <Tooltip label="Details you need to enter — highlighted in yellow in the preview" side="bottom">
                  <span aria-label={`${currentPh} to complete`} className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    <AlertTriangle size={10} /> {currentPh} to complete
                  </span>
                </Tooltip>
              )}
            </div>
            <p className="truncate text-[11px] text-[var(--text-muted)]">{section.requirement}</p>
          </div>
          <button
            onClick={draftAll}
            disabled={aiBusy !== null || draftingAll !== null || draftTargets.length === 0}
            title="Draft every note that isn't complete with SMITH"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)]/10 px-2.5 py-1.5 text-[12px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/15 disabled:opacity-50"
          >
            {draftingAll ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {draftingAll ? `Drafting ${draftingAll.done}/${draftingAll.total}…` : 'Draft all'}
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 border-b border-black/5 px-3 py-2">
          <ToolBtn onClick={undo} label="Undo" disabled={!canUndo}><Undo2 size={14} /></ToolBtn>
          <ToolBtn onClick={redo} label="Redo" disabled={!canRedo}><Redo2 size={14} /></ToolBtn>
          <div className="mx-1 h-5 w-px bg-black/10" />
          <ToolBtn onClick={() => format('bold')} label="Bold"><Bold size={14} /></ToolBtn>
          <ToolBtn onClick={() => format('italic')} label="Italic"><Italic size={14} /></ToolBtn>
          <ToolBtn onClick={() => format('insertUnorderedList')} label="List"><List size={14} /></ToolBtn>
          <ToolBtn onClick={() => format('createLink')} label="Link"><Link2 size={14} /></ToolBtn>
          <div className="mx-1 h-5 w-px bg-black/10" />
          <button onClick={() => aiAction('rewrite')} disabled={aiBusy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)]/10 px-2.5 py-1.5 text-[12px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/15 disabled:opacity-50">
            {aiBusy === 'rewrite' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Rewrite with SMITH
          </button>
          <button onClick={() => aiAction('explain')} disabled={aiBusy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-black/[0.04] disabled:opacity-50">
            {aiBusy === 'explain' ? <Loader2 size={13} className="animate-spin" /> : <HelpCircle size={13} />} Explain requirement
          </button>
          {priorNote && (
            <button onClick={() => { setPriorOpen(o => !o); setShowHistory(false); }} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${priorOpen ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-black/[0.04]'}`}>
              <RotateCcw size={13} /> Last year{priorLabel ? ` (${priorLabel})` : ''}
            </button>
          )}
          <button onClick={() => { setShowHistory(v => !v); setPriorOpen(false); }} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-black/[0.04]">
            <History size={13} /> History
          </button>
        </div>

        {/* Last year's wording — view and roll forward */}
        {priorOpen && priorNote && (
          <div className="mx-3 mt-3 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Last year&apos;s wording{priorLabel ? ` · ${priorLabel}` : ''}</p>
              <div className="flex items-center gap-2">
                <button onClick={applyPriorYear} className="rounded-md bg-[var(--accent)] px-2 py-0.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90">Use this wording</button>
                <button onClick={() => setPriorOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={13} /></button>
              </div>
            </div>
            <div className="studio-prose max-h-52 overflow-y-auto rounded-lg bg-white/70 p-2.5 text-[12px] leading-relaxed text-[var(--text-secondary)]" dangerouslySetInnerHTML={{ __html: priorNote.content }} />
          </div>
        )}

        {/* Explanation callout */}
        {explanation && (
          <div className="mx-3 mt-3 flex items-start gap-2 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 px-3 py-2.5">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <p className="flex-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-secondary)]">{explanation}</p>
            <button onClick={() => setExplanation(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={13} /></button>
          </div>
        )}

        {/* History dropdown */}
        {showHistory && (
          <div className="mx-3 mt-3 rounded-xl border border-black/5 bg-white/70 p-2">
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Version history</p>
            {section.history.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-[var(--text-muted)]">No saved versions yet.</p>
            ) : section.history.map(v => (
              <button key={v.id} onClick={() => restoreVersion(v.content)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.03]">
                <History size={12} className="text-[var(--text-muted)]" />
                <span className="flex-1 text-[12px] font-medium text-[var(--text-primary)]">{v.label}</span>
                <span className="text-[10.5px] text-[var(--text-muted)]">{v.at}</span>
              </button>
            ))}
          </div>
        )}

        {/* Content-editable body */}
        <div className="flex-1 overflow-y-auto p-4">
          {section.content || section.status !== 'missing' ? (
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={onEditorInput}
              className="studio-prose min-h-[200px] text-[13.5px] leading-relaxed text-[var(--text-primary)] outline-none"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]"><Sparkles size={22} /></div>
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">No draft yet</p>
              <p className="max-w-xs text-[12px] text-[var(--text-muted)]">This disclosure is required but hasn&apos;t been drafted. Let SMITH write a first draft.</p>
              <button onClick={() => aiAction('rewrite')} disabled={aiBusy !== null} className="btn-primary">
                {aiBusy === 'rewrite' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Draft with SMITH
              </button>
            </div>
          )}
        </div>

        {section.status !== 'complete' && section.content && (
          <div className="border-t border-black/5 px-4 py-3">
            <button onClick={markReviewed} className="btn-secondary w-full justify-center">
              <Check size={14} /> Mark as complete
            </button>
          </div>
        )}
      </StudioCard>

      {/* ── Live PDF preview ───────────────────────────────────────────────── */}
      <div className="flex max-h-[calc(100vh-240px)] flex-col">
        <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          <FileText size={12} /> Live preview
        </div>
        <div className="flex-1 overflow-y-auto rounded-[22px] border border-white/60 bg-slate-100/70 p-4 shadow-inner">
          <div className="mx-auto max-w-[520px] rounded-lg bg-white px-8 py-9 shadow-[0_4px_24px_rgba(31,38,88,0.12)]">
            <div className="mb-6 border-b border-slate-200 pb-4 text-center">
              <p className="text-[15px] font-bold text-slate-800">{engagement.companyName}</p>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Company no. {engagement.companyNumber}</p>
              <p className="mt-1 text-[11px] text-slate-500">Financial statements for the year ended {engagement.periodEnd}</p>
              <p className="text-[10px] text-slate-400">{engagement.framework}</p>
            </div>
            <div
              className="studio-prose studio-preview text-[12px] leading-relaxed text-slate-700"
              dangerouslySetInnerHTML={{ __html: section.content ? highlightPlaceholders(section.content) : '<p style="color:#94a3b8">This disclosure has not been drafted yet.</p>' }}
            />
          </div>
        </div>
        <div className="mt-3">
          {notesNeedingInput.length > 0 && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] font-medium text-amber-700">
              <AlertTriangle size={13} className="shrink-0" />
              {notesNeedingInput.length} note{notesNeedingInput.length === 1 ? '' : 's'} still {notesNeedingInput.length === 1 ? 'has' : 'have'} details to complete — highlighted in yellow.
            </div>
          )}
          <button onClick={advance} className="btn-primary w-full justify-center">
            Continue to Final Review <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}

function ToolBtn({ children, onClick, label, disabled }: { children: React.ReactNode; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors ${disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-black/[0.05] hover:text-[var(--text-primary)]'}`}>
      {children}
    </button>
  );
}

function nowStamp(): string {
  // dd-mm-yyyy HH:mm using the local clock, without Date.now() gymnastics.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function textToHtml(text: string): string {
  return text.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
}
