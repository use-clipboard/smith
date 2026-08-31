'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ListTodo, LayoutGrid, Building2, Layers, CalendarDays, BookTemplate,
  FileStack, History, RefreshCw,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';

// The hybrid slim icon rail — replaces the old fat Tasks sub-sidebar. Every
// destination is one click (or one popover) away, so nothing that used to be a
// nav row is lost. Light-themed to sit beside the app's dark global sidebar.

type Dept = { category: string; count: number };

interface Props {
  view: string;
  setView: (v: string) => void;
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
  view, setView, activeDepartment, onSelectDepartment, departments,
  myCount, draftCount, templatesCount, isAdmin, onRefresh,
}: Props) {
  const [pop, setPop] = useState<null | 'dept' | 'views' | 'cal'>(null);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (railRef.current && !railRef.current.contains(e.target as Node)) setPop(null);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const isViewsActive = view === 'by-client' || view === 'by-team' || view === 'by-type';
  const isCalActive = view === 'my-week' || view === 'my-month';

  function go(v: string) { setView(v); setPop(null); }

  return (
    <div ref={railRef} className="relative w-14 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col items-center py-3 gap-1">
      <RailBtn icon={<ListTodo className={IC} />} label="My Tasks" active={view === 'my'} badge={myCount} onClick={() => go('my')} />
      <RailBtn icon={<LayoutGrid className={IC} />} label="All Tasks" active={view === 'all'} onClick={() => go('all')} />

      {/* Departments popover */}
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

      {/* Group-by / views popover */}
      <RailBtn
        icon={<Layers className={IC} />} label="Group by"
        active={isViewsActive} open={pop === 'views'}
        onClick={() => setPop(p => (p === 'views' ? null : 'views'))}
      />
      {pop === 'views' && (
        <Popover title="Group by">
          <PopItem label="By Client" active={view === 'by-client'} onClick={() => go('by-client')} />
          <PopItem label="By Team" active={view === 'by-team'} onClick={() => go('by-team')} />
          <PopItem label="By Type" active={view === 'by-type'} onClick={() => go('by-type')} />
        </Popover>
      )}

      {/* Calendar (My Week / My Month) popover */}
      <RailBtn
        icon={<CalendarDays className={IC} />} label="Calendar"
        active={isCalActive} open={pop === 'cal'}
        onClick={() => setPop(p => (p === 'cal' ? null : 'cal'))}
      />
      {pop === 'cal' && (
        <Popover title="Calendar">
          <PopItem label="My Week" active={view === 'my-week'} onClick={() => go('my-week')} />
          <PopItem label="My Month" active={view === 'my-month'} onClick={() => go('my-month')} />
        </Popover>
      )}

      <div className="w-7 h-px bg-gray-200 my-1.5" />

      <RailBtn icon={<BookTemplate className={IC} />} label="Templates" active={view === 'templates'} badge={templatesCount} badgeTone="gray" onClick={() => go('templates')} />
      {isAdmin && <RailBtn icon={<FileStack className={IC} />} label="Drafts" active={view === 'drafts'} badge={draftCount} badgeTone="amber" onClick={() => go('drafts')} />}
      <RailBtn icon={<History className={IC} />} label="History" active={view === 'history'} onClick={() => go('history')} />

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
    <div className="absolute left-[52px] top-2 z-50 w-56 max-h-[70vh] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-2xl p-1.5"
      style={{ animation: 'none' }}>
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
