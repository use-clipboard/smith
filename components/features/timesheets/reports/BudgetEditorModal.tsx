'use client';

import { useMemo, useState } from 'react';
import { X, Search, Target } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import { defaultWeeklyBudgetMinutes } from '@/lib/timesheets/compute';

function BudgetRow({ name, clientRef, weeklyMinutes, isDefault, onCommit }: {
  name: string; clientRef: string; weeklyMinutes: number; isDefault: boolean;
  onCommit: (weeklyMinutes: number) => void;
}) {
  const [hours, setHours] = useState(String((weeklyMinutes / 60).toFixed(weeklyMinutes % 60 ? 1 : 0)));

  const commit = () => {
    const h = Math.max(0, Math.min(168, Number(hours) || 0));
    const mins = Math.round(h * 60);
    setHours(String((mins / 60).toFixed(mins % 60 ? 1 : 0)));
    if (mins !== weeklyMinutes) onCommit(mins);
  };

  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-black/[0.03]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{name}</p>
        {clientRef && <p className="truncate text-[10.5px] text-[var(--text-muted)]">{clientRef}{isDefault ? ' · default' : ''}</p>}
      </div>
      <div className="flex shrink-0 items-center rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2 py-1">
        <input
          type="number" min={0} max={168} step={0.5} value={hours}
          onChange={e => setHours(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-14 bg-transparent text-right text-[13px] font-semibold text-[var(--text-primary)] outline-none"
        />
        <span className="text-[12px] text-[var(--text-muted)]">h / wk</span>
      </div>
    </div>
  );
}

export default function BudgetEditorModal({ onClose }: { onClose: () => void }) {
  const { clients, clientBudgets, setClientBudget } = useTimesheets();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? clients.filter(c => c.name.toLowerCase().includes(q) || c.ref.toLowerCase().includes(q)) : clients;
    return list.slice(0, 200);
  }, [clients, query]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0F0F1A]/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-[22px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Target size={18} /></div>
            <div>
              <h3 className="text-base font-bold text-[var(--text-primary)]">Client budgets</h3>
              <p className="text-[11px] text-[var(--text-muted)]">Weekly time budget per client — used across the selected period.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={18} /></button>
        </div>

        <div className="border-b border-black/5 px-6 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-3 py-2">
            <Search size={15} className="text-[var(--text-muted)]" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search clients…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--text-muted)]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-2">
          {rows.map(c => {
            const override = clientBudgets[c.id];
            const weekly = override ?? defaultWeeklyBudgetMinutes(c.id);
            return (
              <BudgetRow
                key={c.id}
                name={c.name} clientRef={c.ref}
                weeklyMinutes={weekly}
                isDefault={override === undefined}
                onCommit={mins => setClientBudget(c.id, mins)}
              />
            );
          })}
          {rows.length === 0 && <p className="py-8 text-center text-sm text-[var(--text-muted)]">No clients match “{query}”.</p>}
        </div>

        <div className="flex items-center justify-end border-t border-black/5 px-6 py-3">
          <button onClick={onClose} className="btn-primary">Done</button>
        </div>
      </div>
    </div>
  );
}
