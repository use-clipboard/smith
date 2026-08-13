'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X, Check } from 'lucide-react';
import { fmtMoney } from './data';
import FieldHelp from './FieldHelp';

export interface BreakdownColumn<T> {
  key: Extract<keyof T, string>;
  label: string;
  kind: 'text' | 'number' | 'check';
  /** Include this column in the footer total row. */
  total?: boolean;
}

/** A labelled income value that opens an itemised breakdown modal — shows the
 *  entry count and total, and falls back to `fallbackTotal` when there are no
 *  itemised entries (so existing scalar figures still display). */
export function BreakdownField<T extends { id: string }>({
  box, label, title, items, columns, blank, onChange, rowTotal, fallbackTotal = 0, help,
}: {
  box?: number | string;
  label: string;
  title: string;
  items: T[];
  columns: BreakdownColumn<T>[];
  blank: () => T;
  onChange: (items: T[]) => void;
  rowTotal: (t: T) => number;
  fallbackTotal?: number;
  help?: string;
}) {
  const [open, setOpen] = useState(false);
  const total = items.length ? items.reduce((a, t) => a + rowTotal(t), 0) : fallbackTotal;
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null && <span data-editbox={String(box)} className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span>}
        {label}{items.length > 0 && <span className="font-bold text-[var(--text-secondary)]"> ({items.length})</span>}{help && <FieldHelp help={help} label={label} />}
        <button onClick={() => setOpen(true)} className="ml-auto flex h-4 w-4 items-center justify-center rounded bg-[var(--accent)]/10 text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20" aria-label={`Itemise ${label}`}><Plus size={11} /></button>
      </label>
      <button onClick={() => setOpen(true)} className="input-base flex w-full items-center justify-between py-1 text-[12.5px]">
        <span className="text-[var(--text-muted)]">{items.length ? `${items.length} entr${items.length === 1 ? 'y' : 'ies'}` : 'Add entries'}</span>
        <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(total)}</span>
      </button>
      {open && <BreakdownModal title={title} items={items} columns={columns} blank={blank} onChange={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function BreakdownModal<T extends { id: string }>({
  title, items, columns, blank, onChange, onClose,
}: {
  title: string;
  items: T[];
  columns: BreakdownColumn<T>[];
  blank: () => T;
  onChange: (items: T[]) => void;
  onClose: () => void;
}) {
  const add = () => onChange([...items, blank()]);
  const upd = (idx: number, u: Partial<T>) => onChange(items.map((x, j) => j === idx ? { ...x, ...u } : x));
  const del = (idx: number) => onChange(items.filter((_, j) => j !== idx));
  const colTotal = (key: Extract<keyof T, string>) => items.reduce((a, it) => a + (Number(it[key]) || 0), 0);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <p className="text-[15px] font-bold text-[var(--text-primary)]">{title}</p>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-black/5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {columns.map(c => <th key={c.key} className={`pb-2 pr-2 ${c.kind === 'number' ? 'text-right' : c.kind === 'check' ? 'text-center' : ''}`}>{c.label}</th>)}
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="py-6 text-center text-[12px] text-[var(--text-muted)]">No entries yet — add one.</td></tr>
              ) : items.map((it, idx) => (
                <tr key={it.id} className="border-b border-black/5">
                  {columns.map(c => (
                    <td key={c.key} className={`py-1.5 pr-2 ${c.kind === 'check' ? 'text-center' : ''}`}>
                      {c.kind === 'check' ? (
                        <input type="checkbox" checked={!!it[c.key]} onChange={e => upd(idx, { [c.key]: e.target.checked } as unknown as Partial<T>)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                      ) : (
                        <input
                          type={c.kind === 'number' ? 'number' : 'text'}
                          value={c.kind === 'number' ? ((it[c.key] as number) || '') : ((it[c.key] as string) ?? '')}
                          onChange={e => upd(idx, { [c.key]: c.kind === 'number' ? (Number(e.target.value) || 0) : e.target.value } as unknown as Partial<T>)}
                          placeholder={c.label}
                          className={`input-base py-1 text-[12px] ${c.kind === 'number' ? 'text-right' : ''}`}
                        />
                      )}
                    </td>
                  ))}
                  <td className="py-1.5"><button onClick={() => del(idx)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={`pt-3 pr-2 ${c.kind === 'number' ? 'text-right' : ''}`}>
                    {i === 0 && <span className="text-[12px] font-semibold text-[var(--text-muted)]">Total</span>}
                    {c.total && <span className="text-[13px] font-bold text-[var(--text-primary)]">{fmtMoney(colTotal(c.key))}</span>}
                  </td>
                ))}
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
          <button onClick={add} className="btn-secondary"><Plus size={14} /> Add entry</button>
          <button onClick={onClose} className="btn-primary"><Check size={14} /> Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
