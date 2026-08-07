'use client';

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Plus, GitCompare, Sparkles, Pencil, Trash2, Copy, ArrowUpRight,
  Info, TrendingUp, Check, X,
  LayoutGrid, Wallet, PiggyBank, LineChart, Home, Briefcase, SlidersHorizontal, FileText,
} from 'lucide-react';
import { StudioCard } from '../primitives';
import AssistantPanel from '../AssistantPanel';
import { WorkspaceControls, type SaveState } from '../WorkspaceControls';
import ComparisonTable from './ComparisonTable';
import ScenarioEditor, { type EditCategory } from './ScenarioEditor';
import { returnType, fmtMoney } from '../data';
import {
  currentPlanScenario, scenarioResult, newScenarioId, buildQuickScenario,
  keyAssumptions, planningInsights, QUICK_ACTIONS, type QuickKind,
} from './data';
import type { TaxReturn, Sa100Income, Scenario } from '../types';

type Tab = 'overview' | EditCategory | 'summary';
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'income', label: 'Income & Deductions', icon: Wallet },
  { id: 'capital', label: 'Capital Gains', icon: TrendingUp },
  { id: 'pensions', label: 'Pensions', icon: PiggyBank },
  { id: 'investments', label: 'Investments', icon: LineChart },
  { id: 'property', label: 'Property', icon: Home },
  { id: 'business', label: 'Business', icon: Briefcase },
  { id: 'other', label: 'Other Adjustments', icon: SlidersHorizontal },
  { id: 'summary', label: 'Summary', icon: FileText },
];

export default function SandboxView({
  ret, patch, assistantOpen = true, controls,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  assistantOpen?: boolean;
  controls?: {
    canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
    saveState: SaveState; onToggleAssistant: () => void;
  };
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(ret.scenarios[0]?.id ?? null);
  const [promoteId, setPromoteId] = useState<string | null>(null);

  const rt = returnType(ret.returnType);
  const current = currentPlanScenario(ret);
  const all = [current, ...ret.scenarios];
  const selected = ret.scenarios.find(s => s.id === selectedId) ?? null;

  function addScenario(income: Sa100Income, name: string) {
    const sc: Scenario = { id: newScenarioId(), name, base: false, income };
    patch(r => ({ ...r, scenarios: [...r.scenarios, sc] }));
    setSelectedId(sc.id);
    setTab('income');
  }
  function newBlank() {
    const n = ret.scenarios.length + 1;
    addScenario(structuredClone(ret.income), `Scenario ${String.fromCharCode(64 + n)}`);
  }
  function quick(kind: QuickKind) {
    const { name, income } = buildQuickScenario(kind, ret.income);
    addScenario(income, name);
  }
  function updateScenario(id: string, income: Sa100Income) {
    patch(r => ({ ...r, scenarios: r.scenarios.map(s => s.id === id ? { ...s, income } : s) }));
  }
  function deleteScenario(id: string) {
    patch(r => ({ ...r, scenarios: r.scenarios.filter(s => s.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }
  function duplicateScenario(s: Scenario) {
    addScenario(structuredClone(s.income), `${s.name} copy`);
  }
  function promote(id: string) {
    const s = ret.scenarios.find(x => x.id === id);
    if (!s) return;
    patch(r => ({
      ...r,
      income: structuredClone(s.income),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'edited', label: `Promoted planning scenario “${s.name}” to the live return` }],
    }));
    setPromoteId(null);
    setTab('overview');
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[20px] font-extrabold tracking-tight text-[var(--text-primary)]">Sandbox – {ret.clientName}</h2>
            <span className="rounded-full bg-[var(--accent)]/10 px-2.5 py-0.5 text-[11px] font-bold text-[var(--accent)]">{rt.form} · {rt.label}</span>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)]">Model different scenarios and see the potential tax impact before making decisions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls && (
            <WorkspaceControls
              canUndo={controls.canUndo} canRedo={controls.canRedo} onUndo={controls.onUndo} onRedo={controls.onRedo}
              saveState={controls.saveState} assistantOpen={assistantOpen} onToggleAssistant={controls.onToggleAssistant}
            />
          )}
          <button onClick={() => setTab('overview')} className="btn-secondary bg-white"><GitCompare size={14} /> Compare</button>
          <button onClick={newBlank} className="btn-primary"><Plus size={15} /> Create scenario</button>
        </div>
      </div>

      {/* Panel: tabs + content, with the assistant docked alongside */}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <StudioCard className="overflow-hidden">
            {/* Section tabs */}
            <div className="flex flex-wrap gap-1.5 border-b border-black/5 px-4 py-3">
              {TABS.map(t => {
                const on = t.id === tab;
                const Icon = t.icon;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${on ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/30 hover:text-[var(--text-secondary)]'}`}>
                    <Icon size={13} className="shrink-0" /> {t.label}
                  </button>
                );
              })}
            </div>

            <div className="p-5">
              {tab === 'overview' ? (
                <Overview
                  ret={ret} scenarios={all} selectedId={selectedId} onSelect={setSelectedId}
                  onAdd={newBlank} onQuick={quick} onDelete={deleteScenario} onDuplicate={duplicateScenario}
                  onEdit={id => { setSelectedId(id); setTab('income'); }}
                  promoteId={promoteId} setPromoteId={setPromoteId} onPromote={promote}
                />
              ) : tab === 'summary' ? (
                <SummaryTab ret={ret} scenarios={all} />
              ) : (
                selected ? (
                  <ScenarioEditor scenario={selected} category={tab as EditCategory} baseIncome={ret.income} taxYear={ret.taxYear}
                    onChange={income => updateScenario(selected.id, income)} />
                ) : (
                  <div className="flex flex-col items-center gap-2 px-8 py-12 text-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Info size={20} /></div>
                    <p className="text-[14px] font-bold text-[var(--text-primary)]">Select a scenario to edit</p>
                    <p className="max-w-sm text-[12.5px] text-[var(--text-muted)]">The Current Plan mirrors the live return and can’t be edited here. Create a scenario, then adjust its figures.</p>
                    <button onClick={newBlank} className="btn-primary mt-1"><Plus size={15} /> Create scenario</button>
                  </div>
                )
              )}
            </div>
          </StudioCard>
        </div>

        {assistantOpen && (
          <div className="hidden w-[340px] shrink-0 xl:block" style={{ height: 'calc(100vh - 240px)' }}>
            <AssistantPanel ret={ret} stage="review" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Lighter sub-card used inside the panel (matches the return workflow's inner
 *  cards) so we don't nest heavy glass StudioCards. */
function SubCard({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-xl border border-[var(--border)] bg-white/60 ${className}`}>{children}</div>;
}

// ─── Overview tab ────────────────────────────────────────────────────────────
function Overview({
  ret, scenarios, selectedId, onSelect, onAdd, onQuick, onDelete, onDuplicate, onEdit,
  promoteId, setPromoteId, onPromote,
}: {
  ret: TaxReturn; scenarios: Scenario[]; selectedId: string | null;
  onSelect: (id: string) => void; onAdd: () => void; onQuick: (k: QuickKind) => void;
  onDelete: (id: string) => void; onDuplicate: (s: Scenario) => void; onEdit: (id: string) => void;
  promoteId: string | null; setPromoteId: (id: string | null) => void; onPromote: (id: string) => void;
}) {
  const base = scenarioResult(ret.income, ret.taxYear);
  const promoteScenario = ret.scenarios.find(s => s.id === promoteId) ?? null;
  const selectable = selectedId && selectedId !== 'current' ? selectedId : null;

  return (
    <div className="space-y-4">
        <div>
          <div className="mb-3 flex items-center justify-between border-b border-black/5 pb-3">
            <div>
              <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Scenario comparison</h3>
              <p className="text-[12px] text-[var(--text-muted)]">Compare your scenarios side by side.</p>
            </div>
            <span className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-[12px] font-semibold text-[var(--text-secondary)]">Tax year {ret.taxYear}</span>
          </div>
          <ComparisonTable scenarios={scenarios} taxYear={ret.taxYear} selectedId={selectedId} onSelect={onSelect} onAdd={onAdd} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* My scenarios */}
          <SubCard className="p-4">
            <p className="text-[13px] font-bold text-[var(--text-primary)]">My scenarios</p>
            <p className="mb-2 text-[11.5px] text-[var(--text-muted)]">Manage and run your planning scenarios.</p>
            <div className="space-y-1.5">
              {scenarios.map(s => {
                const r = scenarioResult(s.income, ret.taxYear);
                const saving = base.totalTaxAndNic - r.totalTaxAndNic;
                return (
                  <div key={s.id} className={`rounded-xl border px-3 py-2 ${selectedId === s.id ? 'border-[var(--accent)]/40 bg-[var(--accent)]/[0.05]' : 'border-[var(--border)] bg-white/60'}`}>
                    <button onClick={() => onSelect(s.id)} className="flex w-full items-center justify-between text-left">
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-bold text-[var(--text-primary)]">{s.base ? 'Current Plan' : s.name}</p>
                        <p className="text-[10.5px] text-[var(--text-muted)]">{s.base ? 'Live return' : (saving > 0 ? `Saving ${fmtMoney(saving)}` : saving < 0 ? `${fmtMoney(Math.abs(saving))} more` : 'No change')}</p>
                      </div>
                      <span className="text-[12px] font-bold text-[var(--text-primary)]">{fmtMoney(r.totalTaxAndNic)}</span>
                    </button>
                    {!s.base && (
                      <div className="mt-1.5 flex items-center gap-2 border-t border-black/5 pt-1.5">
                        <MiniBtn icon={Pencil} label="Edit" onClick={() => onEdit(s.id)} />
                        <MiniBtn icon={Copy} label="Duplicate" onClick={() => onDuplicate(s)} />
                        <MiniBtn icon={Trash2} label="Delete" onClick={() => onDelete(s.id)} danger />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={onAdd} className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--accent)]/40 py-1.5 text-[11.5px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/5"><Plus size={13} /> Create new scenario</button>
          </SubCard>

          {/* Quick actions */}
          <SubCard className="p-4">
            <p className="text-[13px] font-bold text-[var(--text-primary)]">Quick actions</p>
            <p className="mb-2 text-[11.5px] text-[var(--text-muted)]">What would you like to model?</p>
            <div className="grid grid-cols-1 gap-1.5">
              {QUICK_ACTIONS.map(a => (
                <button key={a.kind} onClick={() => onQuick(a.kind)} className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-white/60 px-3 py-2 text-left transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/[0.03]">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><a.icon size={14} /></div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)]">{a.title}</p>
                    <p className="text-[10.5px] leading-snug text-[var(--text-muted)]">{a.sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </SubCard>

          {/* Assumptions + insights */}
          <div className="space-y-4">
            <SubCard className="p-4">
              <p className="text-[13px] font-bold text-[var(--text-primary)]">Key assumptions</p>
              <p className="mb-2 text-[11.5px] text-[var(--text-muted)]">Current plan assumptions.</p>
              <div className="space-y-1">
                {keyAssumptions(ret.income).map(a => (
                  <div key={a.label} className="flex items-center gap-2 text-[11.5px]">
                    <Check size={12} className="shrink-0 text-emerald-500" />
                    <span className="flex-1 text-[var(--text-secondary)]">{a.label}</span>
                    <span className="font-semibold text-[var(--text-primary)]">{a.value}</span>
                  </div>
                ))}
              </div>
            </SubCard>
            <SubCard className="p-4">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><TrendingUp size={14} className="text-[var(--accent)]" /> Planning insights</p>
              <div className="mt-2 space-y-2">
                {planningInsights(ret).map((ins, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11.5px] text-[var(--text-secondary)]">
                    <Sparkles size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" /> {ins}
                  </div>
                ))}
              </div>
            </SubCard>
          </div>
        </div>

        {/* Promote banner */}
        <SubCard className="p-4">
          {promoteScenario ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12.5px] text-[var(--text-secondary)]">Promote <span className="font-bold text-[var(--text-primary)]">{promoteScenario.name}</span> to the live return? This overwrites the current figures.</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPromoteId(null)} className="btn-secondary bg-white"><X size={14} /> Cancel</button>
                <button onClick={() => onPromote(promoteScenario.id)} className="btn-primary"><Check size={14} /> Confirm promote</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[11.5px] text-[var(--text-muted)]"><Info size={14} className="shrink-0 text-[var(--accent)]" /> These scenarios are for planning only and don’t affect the live return. All figures are estimates.</p>
              <button onClick={() => selectable && setPromoteId(selectable)} disabled={!selectable} className="btn-primary disabled:opacity-40">
                <ArrowUpRight size={15} /> Promote to return
              </button>
            </div>
          )}
        </SubCard>
    </div>
  );
}

function SummaryTab({ ret, scenarios }: { ret: TaxReturn; scenarios: Scenario[] }) {
  const base = scenarioResult(ret.income, ret.taxYear);
  const best = ret.scenarios
    .map(s => ({ s, saving: base.totalTaxAndNic - scenarioResult(s.income, ret.taxYear).totalTaxAndNic }))
    .sort((a, b) => b.saving - a.saving)[0];
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-3 text-[15px] font-bold text-[var(--text-primary)]">Summary</h3>
        <ComparisonTable scenarios={scenarios} taxYear={ret.taxYear} selectedId={null} onSelect={() => {}} onAdd={() => {}} />
      </div>
      {best && best.saving > 0 && (
        <SubCard className="p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><Sparkles size={14} className="text-[var(--accent)]" /> Recommendation</p>
          <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
            Of the scenarios modelled, <span className="font-bold">{best.s.name}</span> is the most tax-efficient — an estimated saving of {fmtMoney(best.saving)} in total tax &amp; NIC. Promote it from the Overview tab to apply it to the live return.
          </p>
        </SubCard>
      )}
    </div>
  );
}

function MiniBtn({ icon: Icon, label, onClick, danger }: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors ${danger ? 'text-rose-500 hover:bg-rose-50' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}>
      <Icon size={11} /> {label}
    </button>
  );
}
