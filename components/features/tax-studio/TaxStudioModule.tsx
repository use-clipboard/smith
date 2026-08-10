'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Calculator, ArrowLeft, Sparkles, ShieldCheck, MessagesSquare,
  ClipboardList, Beaker,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import { WorkspaceControls, type SaveState } from './WorkspaceControls';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import CommandCentre from './CommandCentre';
import NewReturnWizard from './wizard/NewReturnWizard';
import Stepper from './Stepper';
import AssistantPanel from './AssistantPanel';
import { ReturnHeader } from './widgets';
import SandboxView from './sandbox/SandboxView';
import StageSetup from './stages/StageSetup';
import StageAnalyse from './stages/StageAnalyse';
import StageReview, { ReviewSearch, type PageId, type Reveal } from './stages/StageReview';
import StageApproval from './stages/StageApproval';
import StageSubmit from './stages/StageSubmit';
import { STAGES, ALL_STAGES, deriveStatus } from './data';
import { listReturns, createReturn, saveReturn, deleteReturn, type ReturnListItem } from './persistence';
import type { TaxReturn, StageId } from './types';

const ACCENT = '#6366F1';

export default function TaxStudioModule({ activeModules, userName }: { activeModules: string[] | null; userName: string }) {
  const allowed = canAccessTaxStudio(activeModules);
  const [view, setView] = useState<'home' | 'new'>('home');
  const [items, setItems] = useState<ReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ret, setRet] = useState<TaxReturn | null>(null);
  const [stage, setStage] = useState<StageId>('setup');
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [workspace, setWorkspace] = useState<'return' | 'sandbox'>('return');
  // Review & Adjust "jump to" navigation — lifted here so the search can sit in
  // the working-controls row (next to undo/redo) while it drives the review panel.
  const [reviewPage, setReviewPage] = useState<PageId>('core');
  const [reviewReveal, setReviewReveal] = useState<Reveal | null>(null);
  const goToReview = (e: { page: string; section?: string }) => {
    setReviewPage(e.page as PageId);
    setReviewReveal(r => ({ page: e.page as PageId, section: e.section, nonce: (r?.nonce ?? 0) + 1 }));
  };

  const lastSaved = useRef<string>('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo/redo history (whole-return snapshots) + a re-render tick for the buttons.
  const history = useRef<TaxReturn[]>([]);
  const histIndex = useRef(0);
  const isTimeTravel = useRef(false);
  const [histTick, setHistTick] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(await listReturns()); } catch { /* surfaced elsewhere */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (allowed) void refresh(); }, [allowed, refresh]);

  // Debounced autosave — persists the return with a freshly-derived status.
  useEffect(() => {
    if (!ret) return;
    const withStatus = { ...ret, status: deriveStatus(ret) };
    const snapshot = JSON.stringify(withStatus);
    if (snapshot === lastSaved.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      saveReturn(withStatus)
        .then(() => { lastSaved.current = snapshot; setSaveState('saved'); })
        .catch(() => setSaveState('error'));
    }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [ret]);

  // Debounced history commit — coalesces a burst of edits into one undo step.
  useEffect(() => {
    if (!ret) return;
    if (isTimeTravel.current) { isTimeTravel.current = false; return; }
    const t = setTimeout(() => {
      const top = history.current[histIndex.current];
      if (top && JSON.stringify(top) === JSON.stringify(ret)) return;
      history.current = history.current.slice(0, histIndex.current + 1);
      history.current.push(ret);
      if (history.current.length > 60) history.current.shift();
      histIndex.current = history.current.length - 1;
      setHistTick(v => v + 1);
    }, 500);
    return () => clearTimeout(t);
  }, [ret]);

  const undo = useCallback(() => {
    if (histIndex.current <= 0) return;
    histIndex.current -= 1;
    isTimeTravel.current = true;
    setRet(history.current[histIndex.current]);
    setHistTick(v => v + 1);
  }, []);
  const redo = useCallback(() => {
    if (histIndex.current >= history.current.length - 1) return;
    histIndex.current += 1;
    isTimeTravel.current = true;
    setRet(history.current[histIndex.current]);
    setHistTick(v => v + 1);
  }, []);

  // Keyboard shortcuts — but let native undo work inside text fields.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === 'z') { e.preventDefault(); undo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (!allowed) return <ComingSoon />;

  function patch(updater: (r: TaxReturn) => TaxReturn) {
    setRet(prev => (prev ? updater(prev) : prev));
  }

  function openReturn(r: TaxReturn) {
    lastSaved.current = JSON.stringify({ ...r, status: deriveStatus(r) });
    setSaveState('idle');
    history.current = [r];
    histIndex.current = 0;
    isTimeTravel.current = true; // don't re-push the opened state
    setHistTick(v => v + 1);
    setWorkspace('return');
    setRet(r);
    const active = ALL_STAGES.find(s => r.stageStatus[s] === 'active')
      ?? ALL_STAGES.find(s => r.stageStatus[s] !== 'complete') ?? 'submit';
    setStage(active);
  }

  async function startNew(built: TaxReturn) {
    const created = await createReturn(built);
    setView('home');
    openReturn(created);
  }

  async function closeReturn() {
    if (ret && JSON.stringify({ ...ret, status: deriveStatus(ret) }) !== lastSaved.current) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try { await saveReturn({ ...ret, status: deriveStatus(ret) }); } catch { /* draft kept */ }
    }
    setRet(null);
    setView('home');
    void refresh();
  }

  function advanceFrom(id: StageId) {
    const idx = ALL_STAGES.indexOf(id);
    const next = ALL_STAGES[idx + 1];
    patch(r => {
      const status = { ...r.stageStatus, [id]: 'complete' as const };
      if (next) status[next] = 'active';
      return { ...r, stageStatus: status };
    });
    if (next) setStage(next);
  }

  // ── Home / New (no open return) ─────────────────────────────────────────────
  if (!ret) {
    if (view === 'new') {
      return (
        <ToolLayout title="Tax Studio" description="Create a new return." icon={Calculator} iconColor={ACCENT} wide>
          <NewReturnWizard onStart={startNew} onBack={() => setView('home')} />
        </ToolLayout>
      );
    }
    return (
      <ToolLayout title="Tax Studio" description="Your practice-wide tax command centre." icon={Calculator} iconColor={ACCENT} wide>
        <CommandCentre items={items} loading={loading} userName={userName} onNew={() => setView('new')} onOpen={openReturn}
          onDelete={async id => { await deleteReturn(id); await refresh(); }} />
      </ToolLayout>
    );
  }

  // ── Return workspace ────────────────────────────────────────────────────────
  const stageMeta = STAGES.find(s => s.id === stage)!;
  const live = { ...ret, status: deriveStatus(ret) };
  void histTick; // re-read history refs on each history change
  const canUndo = histIndex.current > 0;
  const canRedo = histIndex.current < history.current.length - 1;
  const controls = { canUndo, canRedo, onUndo: undo, onRedo: redo, saveState, onToggleAssistant: () => setAssistantOpen(v => !v) };

  return (
    <ToolLayout
      title="Tax Studio"
      description="Return workspace"
      icon={Calculator}
      iconColor={ACCENT}
      wide
    >
      <button onClick={closeReturn} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
        <ArrowLeft size={13} /> Back to command centre
      </button>

      <ReturnHeader ret={live} />

      {/* Return / Planning toggle */}
      <div className="mt-4 inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-white/60 p-0.5">
        <WorkspaceTab active={workspace === 'return'} onClick={() => setWorkspace('return')} icon={ClipboardList} label="Return workflow" />
        <WorkspaceTab active={workspace === 'sandbox'} onClick={() => setWorkspace('sandbox')} icon={Beaker} label="Planning sandbox" />
      </div>

      {workspace === 'sandbox' ? (
        <div className="mt-4">
          <SandboxView ret={ret} patch={patch} assistantOpen={assistantOpen} controls={controls} />
        </div>
      ) : (
        <>
          {/* Stepper */}
          <div className="mb-4 mt-4 rounded-[18px] border border-white/60 bg-white/60 px-3 py-2 backdrop-blur-md">
            <Stepper ret={live} current={stage} onSelect={setStage} />
          </div>

          {/* Stage title + working controls (undo/redo · save · assistant) */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[17px] font-bold text-[var(--text-primary)]">{stageMeta.label}</h3>
              <p className="text-[13px] text-[var(--text-muted)]">{stageMeta.blurb}</p>
            </div>
            <div className="flex items-center gap-2">
              {stage === 'review' && <ReviewSearch onGo={goToReview} />}
              <WorkspaceControls
                canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo}
                saveState={saveState} assistantOpen={assistantOpen} onToggleAssistant={() => setAssistantOpen(v => !v)}
              />
            </div>
          </div>

          {/* Stage + assistant */}
          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              {stage === 'setup' && <StageSetup ret={ret} patch={patch} advance={() => advanceFrom('setup')} />}
              {stage === 'analyse' && <StageAnalyse ret={ret} patch={patch} advance={() => advanceFrom('analyse')} />}
              {stage === 'review' && <StageReview ret={ret} patch={patch} advance={() => advanceFrom('review')} page={reviewPage} setPage={setReviewPage} reveal={reviewReveal} />}
              {stage === 'approval' && <StageApproval ret={ret} patch={patch} advance={() => advanceFrom('approval')} />}
              {stage === 'submit' && <StageSubmit ret={ret} patch={patch} />}
            </div>
            {assistantOpen && (
              <div className="hidden w-[340px] shrink-0 xl:block" style={{ height: 'calc(100vh - 240px)' }}>
                <AssistantPanel ret={ret} stage={stage} />
              </div>
            )}
          </div>
        </>
      )}
    </ToolLayout>
  );
}

function WorkspaceTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof ClipboardList; label: string }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}

function ComingSoon() {
  return (
    <ToolLayout title="Tax Studio" description="An AI-first tax operating system for accountancy firms." icon={Calculator} iconColor={ACCENT}>
      <div className="mx-auto mt-6 max-w-lg">
        <div className="overflow-hidden rounded-[24px] border border-white/60 bg-white/70 text-center shadow-[0_8px_32px_rgba(31,38,88,0.10)] backdrop-blur-md">
          <div className="relative flex flex-col items-center gap-3 px-8 py-10" style={{ background: 'linear-gradient(140deg,#4F46E5 0%,#7C3AED 55%,#9333EA 100%)' }}>
            <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur"><Calculator size={28} className="text-white" /></div>
            <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">Coming soon</span>
            <h2 className="text-xl font-bold text-white">Tax Studio is almost here</h2>
            <p className="max-w-sm text-[13px] text-white/80">Prepare, review, plan and file every HMRC return — AI-first, connected to every SMITH module, with a what-if planning sandbox.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 px-8 py-7 sm:grid-cols-3">
            {[
              { icon: Sparkles, label: 'AI-prepared', sub: 'Figures pulled for you' },
              { icon: ShieldCheck, label: 'Review & risks', sub: 'Explained, not just flagged' },
              { icon: MessagesSquare, label: 'Planning sandbox', sub: 'What-if scenarios' },
            ].map(f => (
              <div key={f.label} className="flex flex-col items-center gap-1.5 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><f.icon size={18} /></div>
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{f.label}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{f.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
