'use client';

import { useState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { initials, avatarColour } from './StepComments';

export interface TeamMember { id: string; full_name: string | null; email: string }

export default function AssigneePicker({
  current, teamMembers, onSelect, disabled, size = 'sm',
}: {
  current: { id: string; full_name: string | null; email: string } | null;
  teamMembers: TeamMember[];
  onSelect: (memberId: string | null) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const sz = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]';

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={e => { e.stopPropagation(); if (!disabled) setOpen(v => !v); }}
        disabled={disabled}
        title={current ? `${current.full_name ?? current.email} — click to change` : 'Unassigned — click to assign'}
        className={`${sz} rounded-full flex items-center justify-center font-bold text-white ring-2 ring-white transition-all
          ${current ? avatarColour(current.id) : 'bg-gray-200'}
          ${disabled ? 'opacity-50 cursor-default' : 'hover:ring-indigo-300 hover:scale-110 cursor-pointer'}`}
      >
        {current ? initials(current.full_name, current.email) : <span className="text-gray-400 text-xs">?</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-52 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Assign step to</p>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              onClick={e => { e.stopPropagation(); onSelect(null); setOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 ring-1 ring-gray-200">
                <span className="text-xs text-gray-400">—</span>
              </div>
              <span className="text-gray-400 italic text-sm">Unassigned</span>
              {!current && <Check className="h-3.5 w-3.5 text-indigo-400 ml-auto" />}
            </button>
            {teamMembers.map(m => {
              const isCurrent = current?.id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={e => { e.stopPropagation(); onSelect(m.id); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 transition-colors text-left ${isCurrent ? 'bg-indigo-50/60' : ''}`}
                >
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white ${avatarColour(m.id)}`}>
                    {initials(m.full_name, m.email)}
                  </div>
                  <span className={`truncate flex-1 text-sm ${isCurrent ? 'font-semibold text-indigo-700' : 'text-gray-700'}`}>
                    {m.full_name ?? m.email}
                  </span>
                  {isCurrent && <Check className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
