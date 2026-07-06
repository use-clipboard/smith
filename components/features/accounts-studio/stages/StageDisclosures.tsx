'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Bold, Italic, List, Link2, Sparkles, HelpCircle, History, RotateCcw,
  ArrowRight, Check, Loader2, X, FileText, Wand2, Plus, Eye, EyeOff,
  AlertTriangle, Info, ChevronDown, ShieldCheck,
} from 'lucide-react';
import { StudioCard, SectionStatusPill, SectionStatusDot } from '../primitives';
import { ENTITY_LABELS } from '../data';
import { OPTIONAL_NOTES, makeOptionalNote } from '@/lib/accounts-studio/disclosures';
import { checkDisclosures } from '@/lib/accounts-studio/disclosureCheck';
import type { Engagement, DisclosureSection, SectionStatus } from '../types';

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
  const editorRef = useRef<HTMLDivElement>(null);

  const section = sections.find(s => s.id === selectedId) ?? sections[0];

  const isIncluded = (s: DisclosureSection) => s.included !== false;
  const includedSections = sections.filter(isIncluded);
  const completeCount = includedSections.filter(s => s.status === 'complete').length;
  const addable = OPTIONAL_NOTES.filter(t => !sections.some(s => s.id === t.id));

  // Deterministic "is a needed note missing?" check (see disclosureCheck.ts).
  const warnings = checkDisclosures(engagement);
  const warnCount = warnings.filter(w => w.severity === 'warn').length;

  // One-click resolution for a warning: re-include an excluded note, add one
  // from the optional library, or (fallback) just jump to it.
  function resolveWarning(noteId: string) {
    const existing = sections.find(s => s.id === noteId);
    if (existing) {
      if (existing.included === false) toggleIncluded(noteId);
      selectSection(noteId);
      return;
    }
    if (OPTIONAL_NOTES.some(t => t.id === noteId)) addNote(noteId);
  }
  const resolveLabel = (noteId: string) => {
    const existing = sections.find(s => s.id === noteId);
    if (existing) return existing.included === false ? 'Include' : 'Open';
    return OPTIONAL_NOTES.some(t => t.id === noteId) ? 'Add note' : null;
  };

  const updateSection = useCallback((id: string, updater: (s: DisclosureSection) => DisclosureSection) => {
    patch(e => ({ ...e, disclosures: e.disclosures.map(s => s.id === id ? updater(s) : s) }));
  }, [patch]);

  function toggleIncluded(id: string) {
    updateSection(id, s => ({ ...s, included: s.included === false ? true : false }));
  }

  function addNote(templateId: string) {
    const t = OPTIONAL_NOTES.find(x => x.id === templateId);
    if (!t) return;
    const note = makeOptionalNote(t);
    patch(e => ({ ...e, disclosures: [...e.disclosures, note] }));
    setShowAddNote(false);
    selectSection(note.id);
  }

  function selectSection(id: string) {
    setSelectedId(id);
    setExplanation(null);
    setShowHistory(false);
    setMountKey(k => k + 1);
  }

  // Uncontrolled editor — commit innerHTML to state on input (cursor stays put
  // because we never re-set the editor's children after mount).
  function onEditorInput() {
    const html = editorRef.current?.innerHTML ?? '';
    updateSection(section.id, s => ({ ...s, content: html, status: s.status === 'missing' ? 'draft' : s.status }));
  }

  function replaceContent(html: string, versionLabel: string, newStatus?: SectionStatus) {
    if (editorRef.current) editorRef.current.innerHTML = html;
    updateSection(section.id, s => ({
      ...s,
      content: html,
      status: newStatus ?? s.status,
      history: [{ id: `v${s.history.length + 1}`, label: versionLabel, at: nowStamp(), content: html }, ...s.history],
    }));
    setMountKey(k => k + 1);
  }

  function format(cmd: string) {
    document.execCommand(cmd, false);
    editorRef.current?.focus();
    onEditorInput();
  }

  function usePriorYear() {
    if (!section.priorYearContent) return;
    replaceContent(section.priorYearContent, 'Prior year wording');
  }

  function restoreVersion(html: string) {
    replaceContent(html, 'Restored version');
    setShowHistory(false);
  }

  function markReviewed() {
    updateSection(section.id, s => ({ ...s, status: 'complete' }));
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
                  <span className={`flex-1 truncate text-[12.5px] font-medium ${!included ? 'text-[var(--text-muted)] line-through' : active ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{s.title}</span>
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
                    <span className="block text-[12.5px] font-medium text-[var(--text-primary)]">{t.title}</span>
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
          {section.priorYearContent && (
            <button onClick={usePriorYear} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-black/[0.04]">
              <RotateCcw size={13} /> Prior year wording
            </button>
          )}
          <button onClick={() => setShowHistory(v => !v)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-black/[0.04]">
            <History size={13} /> History
          </button>
        </div>

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
              key={`${section.id}-${mountKey}`}
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={onEditorInput}
              dangerouslySetInnerHTML={{ __html: section.content || '<p></p>' }}
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
              dangerouslySetInnerHTML={{ __html: section.content || '<p style="color:#94a3b8">This disclosure has not been drafted yet.</p>' }}
            />
          </div>
        </div>
        <div className="mt-3">
          <button onClick={advance} className="btn-primary w-full justify-center">
            Continue to Final Review <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}

function ToolBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-black/[0.05] hover:text-[var(--text-primary)]">
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
