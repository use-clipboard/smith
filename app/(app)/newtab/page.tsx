'use client';

import {
  FileSearch, ArrowLeftRight, Building2, ClipboardCheck, TrendingUp,
  Receipt, ShieldAlert, FileText, BookOpen, Archive, HardDrive, House,
  CalendarDays, MicVocal, UserPlus, Puzzle, Plus,
} from 'lucide-react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useTabContext, type Tab } from '@/components/ui/TabContext';
import { useTabActivityContext } from '@/components/ui/TabActivityContext';
import { MODULES, type ModuleConfig } from '@/config/modules.config';

const ICON_MAP: Record<string, React.ElementType> = {
  FileSearch, ArrowLeftRight, Building2, ClipboardCheck, TrendingUp,
  Receipt, ShieldAlert, FileText, BookOpen, Archive, HardDrive, House,
  CalendarDays, MicVocal, UserPlus,
};

function ModuleIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICON_MAP[name] ?? Puzzle;
  return <Icon size={size} />;
}

export default function NewTabPage() {
  const { isModuleActive } = useModules();
  const { tabs, openTab } = useTabContext();
  const { resetIfDone } = useTabActivityContext();

  // Include tools + integrations that have their own page (e.g. Calendar)
  const tools = MODULES.filter(m =>
    !m.alwaysOn &&
    m.route !== null &&
    (m.category === 'tool' || m.category === 'integration') &&
    isModuleActive(m.id)
  );

  function handleSelect(module: ModuleConfig) {
    if (!module.route) return;
    const Icon = (ICON_MAP[module.iconName] ?? Puzzle) as Tab['icon'];
    openTab({ id: module.id, title: module.name, route: module.route, icon: Icon });
    resetIfDone(module.route);
    // Don't router.push — the tool component is already mounted in TabPanels.
    // Just update the URL so the address bar reflects the active tool.
    window.history.replaceState(null, '', module.route);
  }

  function ToolCard({ module }: { module: ModuleConfig }) {
    const isOpenInTab = tabs.some(t => t.route === module.route);
    return (
      <button
        onClick={() => handleSelect(module)}
        className={`text-left glass-solid rounded-xl border flex flex-col gap-3 p-4 transition-all duration-150 group
          hover:border-[var(--accent)] hover:shadow-sm
          ${isOpenInTab
            ? 'border-[var(--accent)] bg-[var(--accent-light)]/10'
            : 'border-[var(--border)]'
          }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors
            ${isOpenInTab
              ? 'bg-[var(--accent-light)]'
              : 'bg-[var(--bg-nav-hover)] group-hover:bg-[var(--accent-light)]'
            }`}
          >
            <span className={`transition-colors
              ${isOpenInTab
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-muted)] group-hover:text-[var(--accent)]'
              }`}
            >
              <ModuleIcon name={module.iconName} size={17} />
            </span>
          </div>
          {isOpenInTab && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--accent)] text-white shrink-0">
              Switch to tab
            </span>
          )}
        </div>

        {/* Body */}
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-tight">
            {module.name}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed line-clamp-2">
            {module.description}
          </p>
        </div>
      </button>
    );
  }

  const hasTools = tools.length > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
          <Plus size={16} className="text-[var(--accent)]" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-[var(--text-primary)] leading-tight">New Tab</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Select a tool to open in this tab. Tools already open will switch to their existing tab.
          </p>
        </div>
      </div>

      {/* Tools section */}
      {hasTools && (
        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3 px-1">
            Tools
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tools.map(m => <ToolCard key={m.id} module={m} />)}
          </div>
        </div>
      )}

      {!hasTools && (
        <div className="text-center py-16 text-[var(--text-muted)]">
          <Puzzle size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No modules are active.</p>
          <p className="text-xs mt-1">
            An admin can enable tools in{' '}
            <a href="/settings?tab=modules" className="text-[var(--accent)] hover:underline">
              Settings → Modules
            </a>.
          </p>
        </div>
      )}
    </div>
  );
}
