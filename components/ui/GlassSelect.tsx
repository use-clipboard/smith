'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface GlassSelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: GlassSelectOption[];
  /** Extra classes for the trigger button (e.g. min-width). */
  className?: string;
  ariaLabel?: string;
}

/**
 * Custom dropdown styled to match the white-glass filter panels.
 *
 * Native <select> option lists are OS-rendered and can't take backdrop-blur or
 * custom colours, so this renders its own popover: a strong-blur frosted panel
 * with dark, readable text (the glass look without sacrificing legibility).
 */
export default function GlassSelect({ value, onChange, options, className = '', ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 py-1.5 pl-2.5 pr-2 text-sm font-semibold rounded-md bg-white border border-[var(--border)] shadow-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-nav-hover)] ${open ? 'bg-[var(--bg-nav-hover)] border-[var(--border)]' : ''} ${className}`}
      >
        <span className="flex-1 text-left truncate">{selected?.label ?? ''}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[var(--text-secondary)] flex-shrink-0" strokeWidth={2.5} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-1 z-50 min-w-full max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-white/95 backdrop-blur-2xl shadow-xl py-1"
        >
          {options.map(o => {
            const isSel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                  isSel
                    ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-semibold'
                    : 'text-gray-900 font-medium hover:bg-gray-100'
                }`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {isSel && <Check className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
