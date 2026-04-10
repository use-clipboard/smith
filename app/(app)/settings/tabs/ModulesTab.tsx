'use client';

import { useState } from 'react';
import {
  FileSearch, ArrowLeftRight, Building2, ClipboardCheck, TrendingUp,
  Receipt, ShieldAlert, FileText, BookOpen, Archive, HardDrive, House,
  Check, Loader2, AlertTriangle, Puzzle, Info,
} from 'lucide-react';
import { MODULES, type ModuleConfig } from '@/config/modules.config';

// Map iconName strings to lucide components
const ICON_MAP: Record<string, React.ElementType> = {
  FileSearch, ArrowLeftRight, Building2, ClipboardCheck, TrendingUp,
  Receipt, ShieldAlert, FileText, BookOpen, Archive, HardDrive, House,
};

function ModuleIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICON_MAP[name];
  if (!Icon) return <Puzzle size={size} />;
  return <Icon size={size} />;
}

function formatPrice(pence: number): string {
  if (pence === 0) return 'Included';
  return `£${(pence / 100).toFixed(0)}/mo`;
}

interface ModuleCardProps {
  module: ModuleConfig;
  isActive: boolean;
  onToggle: (id: string, active: boolean) => void;
  saving: boolean;
}

function ModuleCard({ module, isActive, onToggle, saving }: ModuleCardProps) {
  const enhancedByNames = (module.enhancedBy ?? []).map(id => {
    const m = MODULES.find(m => m.id === id);
    return m?.name ?? id;
  });

  return (
    <div
      className={`glass-solid rounded-xl border flex flex-col transition-all duration-150
        ${isActive
          ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]'
          : 'border-[var(--border)]'
        }`}
    >
      {/* Card body */}
      <div className="p-4 flex flex-col gap-3 flex-1">

        {/* Header row: icon + name + status badge */}
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0
            ${isActive ? 'bg-[var(--accent-light)]' : 'bg-[var(--bg-nav-hover)]'}`}
          >
            <span className={isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
              <ModuleIcon name={module.iconName} size={17} />
            </span>
          </div>
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-tight flex-1 min-w-0">
            {module.name}
          </p>
          {isActive ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 shrink-0">
              <Check size={10} strokeWidth={2.5} /> Active
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-nav-hover)] text-[var(--text-muted)] shrink-0">
              Inactive
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {module.description}
        </p>

        {/* Works best with */}
        {enhancedByNames.length > 0 && (
          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
            <Info size={10} className="shrink-0 text-[var(--accent)]" />
            Works best with:{' '}
            <span className="font-medium text-[var(--text-secondary)]">
              {enhancedByNames.join(', ')}
            </span>
          </p>
        )}
      </div>

      {/* Footer: price + toggle */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
        <span className="text-xs font-semibold text-[var(--text-secondary)]">
          {formatPrice(module.monthlyPricePence)}
        </span>
        <button
          type="button"
          onClick={() => onToggle(module.id, !isActive)}
          disabled={saving}
          className={`relative inline-flex h-6 w-11 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0
            ${isActive ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
          aria-label={isActive ? `Deactivate ${module.name}` : `Activate ${module.name}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
            ${isActive ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
      </div>
    </div>
  );
}

interface Props {
  initialActiveModules: string[];
}

export default function ModulesTab({ initialActiveModules }: Props) {
  const [activeModules, setActiveModules] = useState<string[]>(initialActiveModules);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const optionalModules = MODULES.filter(m => !m.alwaysOn);
  const toolModules = optionalModules.filter(m => m.category === 'tool');
  const integrationModules = optionalModules.filter(m => m.category === 'integration');

  async function handleToggle(moduleId: string, shouldBeActive: boolean) {
    const next = shouldBeActive
      ? [...new Set([...activeModules, moduleId])]
      : activeModules.filter(id => id !== moduleId);

    setActiveModules(next);
    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch('/api/firms/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModules: next }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || 'Failed to save');
      }
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save module settings');
      setActiveModules(activeModules);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">

      {/* Header bar */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
            <Puzzle size={16} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Manage Tools</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Activate the tools your firm needs. Inactive tools are hidden from the sidebar and Quick Launch.
            </p>
          </div>
          <div className="shrink-0 pl-4">
            {saving && (
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Loader2 size={12} className="animate-spin" /> Saving…
              </span>
            )}
            {!saving && savedAt && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <Check size={12} /> Saved
              </span>
            )}
          </div>
        </div>

        {saveError && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-400">{saveError}</p>
          </div>
        )}
      </div>

      {/* Tools */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3 px-1">
          Tools
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {toolModules.map(module => (
            <ModuleCard
              key={module.id}
              module={module}
              isActive={activeModules.includes(module.id)}
              onToggle={handleToggle}
              saving={saving}
            />
          ))}
        </div>
      </div>

      {/* Integrations */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3 px-1">
          Integrations
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {integrationModules.map(module => (
            <ModuleCard
              key={module.id}
              module={module}
              isActive={activeModules.includes(module.id)}
              onToggle={handleToggle}
              saving={saving}
            />
          ))}
        </div>
      </div>

    </div>
  );
}
