'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ListTodo, LayoutGrid, Building2, Layers, CalendarDays, BookTemplate,
  FileStack, History, RefreshCw,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import type { GroupBy } from './views/GroupedTasksView';

// The hybrid slim icon rail — replaces the fat Tasks sub-sidebar. It drives the
// unified list's Scope / Group-by / Layout plus the standalone modes
// (Departments / Templates / Drafts / History). Light-themed to sit beside the
// app's dark global sidebar.

type Dept = { category: string; count: number };
type Layout = 'list' | 'board' | 'calendar' | 'timeline';

interface Props {
  view: string;
  setView: (v: string) => void;
  scope: 'me' | 'firm';
  setScope: (s: 'me' | 'firm') => void;
  groupBy: GroupBy;
  setGroupBy: (g: GroupBy) => void;
  layout: Layout;
  setLayout: (l: Layout) => void;
  activeDepartment: string | null;
  onSelectDepartment: (category: string) => void;
  departments: Dept[];
  myCount: number;
  draftCount: number;
  templatesCount: number;
  isAdmin: boolean;
  onRefresh: () => void;
}

const IC = 'h-[18px] w-[18px]';

export default function TasksSlimRail({
  view, setView, scope, setScope, groupBy, setGroupBy, layout, setLayout,
  activeDepartment, onSelectDepartment, departments,
  myCount, draftCount, templatesCount, isAdmin, onRefresh,
}: Props) {
  const [pop, setPop] = useState<null | 'dept' | 'views'>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setPop(null);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const onList = view === 'list';
  const isMyWork = onList && scope === 'me' && layout === 'list';
  const isAllWork = onList && scope === 'firm' && layout === 'list';
  const isGroupActive = onList && layout === 'list' && (groupBy === 'client' || groupBy === 'team' || groupBy === 'type');
  const isCalActive = onList && layout === 'calendar';

  function goList(next: { scope?: 'me' | 'firm'; group?: GroupBy; layout?: Layout }) {
    setView('list');
    if (next.scope) setScope(next.scope);
    if (next.group !== undefined) setGroupBy(next.group);
    setLayout(next.layout ?? 'list');
    setPop(null);
  }

  return (
    <div ref={railRef} className="relative w-14 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col items-center py-3 gap-1">
      <RailBtn icon={<ListTodo className={IC} />} label="My Work" active={isMyWork} badge={myCount} onClick={() => goList({ scope: 'me' })} />
      <RailBtn icon={<LayoutGrid className={IC} />} label="All Tasks" active={isAllWork} onClick={() => goList({ scope: 'firm' })} />

      {/* Departments popover — opens the dedicated Departments view */}
      <RailBtn
        icon={<Building2 className={IC} />} label="Departments"
        active={view === 'department'} open={pop === 'dept'}
        onClick={() => setPop(p => (p === 'dept' ? null : 'dept'))}
      />
      {pop === 'dept' && (
        <Popover title="Departments">
          {departments.length === 0
            ? <p className="px-3 py-2 text-xs text-gray-400">No department tasks.</p>
            : departments.map(d => {
              const label = TEMPLATE_CATEGORY_LABELS[d.category] ?? d.category;
              const on = view === 'department' && activeDepartment === d.category;
              return (
                <button key={d.category} onClick={() => { onSelectDepartment(d.category); setPop(null); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm rounded-lg ${on ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${on ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                  <span className="truncate flex-1 text-left">{label}</span>
                  <span className="text-[11px] text-gray-400 tabular-nums">{d.count}</span>
                </button>
              );
            })}
        </Popover>
      )}

      {/* Group-by shortcuts */}
      <RailBtn
        icon={<Layers className={IC} />} label="Group by"
        active={isGroupActive} open={pop === 'views'}
        onClick={() => setPop(p => (p === 'views' ? null : 'views'))}
      />
      {pop === 'views' && (
        <Popover title="Group by">
          <PopItem label="By Client" active={onList && groupBy === 'client'} onClick={() => goList({ group: 'client' })} />
          <PopItem label="By Team" active={onList && groupBy === 'team'} onClick={() => goList({ group: 'team' })} />
          <PopItem label="By Type" active={onList && groupBy === 'type'} onClick={() => goList({ group: 'type' })} />
          <PopItem label="No grouping" active={onList && groupBy === 'none'} onClick={() => goList({ group: 'none' })} />
        </Popover>
      )}

      {/* Calendar layout (Week / Month toggle lives inside it) */}
      <RailBtn icon={<CalendarDays className={IC} />} label="Calendar" active={isCalActive} onClick={() => goList({ layout: 'calendar' })} />

      <div className="w-7 h-px bg-gray-200 my-1.5" />

      <RailBtn icon={<BookTemplate className={IC} />} label="Templates" active={view === 'templates'} badge={templatesCount} badgeTone="gray" onClick={() => { setView('templates'); setPop(null); }} />
      {isAdmin && <RailBtn icon={<FileStack className={IC} />} label="Drafts" active={view === 'drafts'} badge={draftCount} badgeTone="amber" onClick={() => { setView('drafts'); setPop(null); }} />}
      <RailBtn icon={<History className={IC} />} label="History" active={view === 'history'} onClick={() => { setView('history'); setPop(null); }} />

      <div className="flex-1" />
      <Tooltip label="Refresh">
        <button onClick={onRefresh} aria-label="Refresh" className="w-10 h-10 rounded-xl grid place-items-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
          <RefreshCw className="h-4 w-4" />
        </button>
      </Tooltip>
    </div>
  );
}

function RailBtn({ icon, label, active, badge, badgeTone = 'indigo', open, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; badge?: number;
  badgeTone?: 'indigo' | 'amber' | 'gray'; open?: boolean; onClick: () => void;
}) {
  const toneCls = badgeTone === 'amber' ? 'bg-amber-500 text-white'
    : badgeTone === 'gray' ? 'bg-gray-200 text-gray-600' : 'bg-indigo-500 text-white';
  return (
    <Tooltip label={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className={`relative w-10 h-10 rounded-xl grid place-items-center transition-colors ${
          active || open ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        }`}
      >
        {icon}
        {badge != null && badge > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold grid place-items-center tabular-nums ${active || open ? 'bg-white text-indigo-600' : toneCls}`}>
            {badge > 999 ? '999+' : badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function Popover({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="absolute left-[52px] top-2 z-50 w-56 max-h-[70vh] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-2xl p-1.5">
      <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      {children}
    </div>
  );
}

function PopItem({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm rounded-lg ${active ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
      {label}
    </button>
  );
}
