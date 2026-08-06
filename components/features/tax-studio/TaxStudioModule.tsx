'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Calculator, ArrowLeft, PanelRightClose, PanelRightOpen,
  Loader2, Check, CloudOff, Sparkles, ShieldCheck, MessagesSquare,
  ClipboardList, Beaker,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import CommandCentre from './CommandCentre';
import NewReturnWizard from './wizard/NewReturnWizard';
import Stepper from './Stepper';
import AssistantPanel from './AssistantPanel';
import { ReturnHeader, HealthScoreCard, NextBestActionCard } from './widgets';
import SandboxView from './sandbox/SandboxView';
import StageSetup from './stages/StageSetup';
import StageAnalyse from './stages/StageAnalyse';
import StageReview from './stages/StageReview';
import StageApproval from './stages/StageApproval';
import StageSubmit from './stages/StageSubmit';
import { STAGES, ALL_STAGES, deriveStatus } from './data';
import { listReturns, createReturn, saveReturn, type ReturnListItem } from './persistence';
import type { TaxReturn, StageId } from './types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const ACCENT = '#6366F1';

export default function TaxStudioModule({ userEmail, userName }: { userEmail: string | null; userName: string }) {
  const allowed = canAccessTaxStudio(userEmail);
  const [view, setView] = useState<'home' | 'new'>('home');
  const [items, setItems] = useState<ReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ret, setRet] = useState<TaxReturn | null>(null);
  const [stage, setStage] = useState<StageId>('setup');
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [workspace, setWorkspace] = useState<'return' | 'sandbox'>('return');

  const lastSaved = useRef<string>('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  if (!allowed) return <ComingSoon />;

  function patch(updater: (r: TaxReturn) => TaxReturn) {
    setRet(prev => (prev ? updater(prev) : prev));
  }

  function openReturn(r: TaxReturn) {
    lastSaved.current = JSON.stringify({ ...r, status: deriveStatus(r) });
    setSaveState('idle');
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
        <CommandCentre items={items} loading={loading} userName={userName} onNew={() => setView('new')} onOpen={openReturn} />
      </ToolLayout>
    );
  }

  // ── Return workspace ────────────────────────────────────────────────────────
  const stageMeta = STAGES.find(s => s.id === stage)!;
  const live = { ...ret, status: deriveStatus(ret) };

  return (
    <ToolLayout
      title="Tax Studio"
      description="Return workspace"
      icon={Calculator}
      iconColor={ACCENT}
      wide
      headerRight={
        <div className="flex items-center gap-2">
          <SaveIndicator state={saveState} />
          <button onClick={() => setAssistantOpen(v => !v)} className="btn-secondary">
            {assistantOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />} Assistant
          </button>
        </div>
      }
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
          <SandboxView ret={ret} patch={patch} onBack={() => setWorkspace('return')} />
        </div>
      ) : (
        <>
          {/* Always-on: health score + next best action */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <HealthScoreCard ret={live} />
            <NextBestActionCard ret={live} onGo={setStage} />
          </div>

          {/* Stepper */}
          <div className="mb-4 mt-4 rounded-[18px] border border-white/60 bg-white/60 px-3 py-2 backdrop-blur-md">
            <Stepper ret={live} current={stage} onSelect={setStage} />
          </div>

          {/* Stage title */}
          <div className="mb-4 flex items-baseline gap-2">
            <h3 className="text-[17px] font-bold text-[var(--text-primary)]">{stageMeta.label}</h3>
            <p className="text-[13px] text-[var(--text-muted)]">{stageMeta.blurb}</p>
          </div>

          {/* Stage + assistant */}
          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              {stage === 'setup' && <StageSetup ret={ret} patch={patch} advance={() => advanceFrom('setup')} />}
              {stage === 'analyse' && <StageAnalyse ret={ret} patch={patch} advance={() => advanceFrom('analyse')} />}
              {stage === 'review' && <StageReview ret={ret} patch={patch} advance={() => advanceFrom('review')} />}
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

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map: Record<Exclude<SaveState, 'idle'>, { icon: React.ReactNode; text: string; cls: string }> = {
    saving: { icon: <Loader2 size={12} className="animate-spin" />, text: 'Saving…', cls: 'text-[var(--text-muted)]' },
    saved:  { icon: <Check size={12} />, text: 'Saved', cls: 'text-emerald-600' },
    error:  { icon: <CloudOff size={12} />, text: 'Not saved', cls: 'text-red-600' },
  };
  const m = map[state];
  return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.cls}`}>{m.icon}{m.text}</span>;
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
