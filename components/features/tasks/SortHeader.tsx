'use client';

import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

interface Props<F extends string> {
  field: F;
  label: string;
  activeField: F | null;
  activeDir: SortDir;
  onToggle: (field: F) => void;
  /** Tailwind classes applied to the <th>. */
  thClassName?: string;
  /** Inline style applied to the <th> — used by TaskTable to set width. */
  style?: CSSProperties;
  /** Slot rendered after the label, inside the <th>. Used for resize handles. */
  rightSlot?: ReactNode;
}

export default function SortHeader<F extends string>({
  field, label, activeField, activeDir, onToggle, thClassName = '', style, rightSlot,
}: Props<F>) {
  const isActive = activeField === field;
  return (
    <th
      className={`px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 ${thClassName}`}
      style={style}
    >
      <button
        onClick={() => onToggle(field)}
        className={`inline-flex items-center gap-1 hover:text-gray-700 transition-colors ${isActive ? 'text-gray-700' : ''}`}
      >
        {label}
        {isActive
          ? (activeDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
          : <ArrowUpDown size={11} className="opacity-30" />}
      </button>
      {rightSlot}
    </th>
  );
}
