'use client';

import {
  FileSearch, ArrowLeftRight, Building2, ClipboardCheck, Gauge,
  Receipt, ShieldAlert, FileText, BookOpen, Archive, HardDrive, House,
  Check, Lock, Puzzle, CalendarDays, UserPlus, CheckSquare, MicVocal, Mail,
  HeartHandshake, FileSignature, CalendarCheck, BookCopy, Landmark, Clock, Layers,
} from 'lucide-react';
import { MODULES, MODULE_GROUPS, modulesForPlan, PLAN_LABELS, type ModuleConfig } from '@/config/modules.config';

// Read-only view. Tools are dictated entirely by the firm's plan/tier — there
// are no per-tool toggles here any more. Each tool is shown as Included or
// Not in your plan based on modulesForPlan(tier). To change what's enabled, the
// admin switches plan in Settings → Plan & Tiers. Hidden from the settings nav
// (see SettingsClient); reachable via ?tab=modules for reference only.

const ICON_MAP: Record<string, React.ElementType> = {
  FileSearch, ArrowLeftRight, Building2, ClipboardCheck, Gauge,
  Receipt, ShieldAlert, FileText, BookOpen, Archive, HardDrive, House,
  CalendarDays, UserPlus, CheckSquare, MicVocal, Mail,
  HeartHandshake, FileSignature, CalendarCheck, BookCopy, Landmark, Clock,
};

function ModuleIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICON_MAP[name];
  if (!Icon) return <Puzzle size={size} />;
  return <Icon size={size} />;
}

function ModuleCard({ module, isIncluded }: { module: ModuleConfig; isIncluded: boolean }) {
  return (
    <div className={`glass-solid rounded-xl border flex flex-col transition-all duration-150
        ${isIncluded ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : 'border-[var(--border)] opacity-70'}`}>
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0
            ${isIncluded ? 'bg-[var(--accent-light)]' : 'bg-[var(--bg-nav-hover)]'}`}>
            <span className={isIncluded ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>
              <ModuleIcon name={module.iconName} size={17} />
            </span>
          </div>
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-tight flex-1 min-w-0">{module.name}</p>
          {isIncluded ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 shrink-0">
              <Check size={10} strokeWidth={2.5} /> Included
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-nav-hover)] text-[var(--text-muted)] shrink-0">
              <Lock size={10} /> Not in your plan
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">{module.description}</p>
      </div>
    </div>
  );
}

interface Props {
  /** Present for the SettingsClient call signature; not used — tools follow the tier. */
  initialActiveModules?: string[];
  subscriptionTier?: string;
}

export default function ModulesTab({ subscriptionTier = 'internal' }: Props) {
  // Which tools this firm's plan grants. Internal (and any legacy tier) = all.
  const includedIds = new Set(modulesForPlan(subscriptionTier));
  const planLabel = PLAN_LABELS[subscriptionTier] ?? subscriptionTier;

  const optionalModules = MODULES.filter(m => !m.alwaysOn);
  const groupedModules = MODULE_GROUPS
    .map(group => ({ group, modules: optionalModules.filter(m => m.group === group.id) }))
    .filter(g => g.modules.length > 0);
  const ungrouped = optionalModules.filter(m => !m.group);

  return (
    <div className="space-y-6">
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
            <Puzzle size={16} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tools in your plan</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              The tools your team can use are set by your plan
              {planLabel ? <> — you&apos;re on <strong className="text-[var(--text-primary)]">{planLabel}</strong></> : null}.
              To turn tools on or off, change your plan in{' '}
              <a href="/settings?tab=tiers" className="text-[var(--accent)] hover:underline font-medium">Plan &amp; Tiers</a>.
            </p>
          </div>
          <a
            href="/settings?tab=tiers"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            <Layers size={13} /> Manage plan
          </a>
        </div>
      </div>

      {groupedModules.map(({ group, modules }) => (
        <div key={group.id}>
          <div className="mb-3 px-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">{group.label}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{group.description}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.map(module => (
              <ModuleCard key={module.id} module={module} isIncluded={includedIds.has(module.id)} />
            ))}
          </div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3 px-1">Other</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ungrouped.map(module => (
              <ModuleCard key={module.id} module={module} isIncluded={includedIds.has(module.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
