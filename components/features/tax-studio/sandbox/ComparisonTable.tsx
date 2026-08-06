'use client';

import { ArrowUp, ArrowDown, Plus } from 'lucide-react';
import { fmtMoney } from '../data';
import { scenarioResult, type ScenarioResult } from './data';
import type { Scenario } from '../types';

interface RowDef {
  label: string;
  get: (r: ScenarioResult) => number;
  /** For tax/NIC rows a decrease is favourable. */
  invert?: boolean;
  highlight?: boolean;
}

const ROWS: RowDef[] = [
  { label: 'Total income',            get: r => r.totalIncome },
  { label: 'Taxable income',          get: r => r.taxableIncome },
  { label: 'Total tax',               get: r => r.incomeTax, invert: true },
  { label: 'National Insurance',      get: r => r.nic, invert: true },
  { label: 'Total tax & NIC',         get: r => r.totalTaxAndNic, invert: true, highlight: true },
  { label: 'Net position (after tax)', get: r => r.netPosition },
];

export default function ComparisonTable({
  scenarios, taxYear, selectedId, onSelect, onAdd,
}: {
  scenarios: Scenario[];
  taxYear: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const results = scenarios.map(s => scenarioResult(s.income, taxYear));
  const base = results[0];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr>
            <th className="w-[180px] py-2 text-left"></th>
            {scenarios.map((s, i) => (
              <th key={s.id} className="px-3 py-2 text-center align-bottom">
                <button onClick={() => onSelect(s.id)}
                  className={`inline-flex flex-col items-center rounded-lg px-3 py-1.5 transition-colors ${selectedId === s.id ? 'bg-[var(--accent)]/10' : 'hover:bg-black/[0.03]'}`}>
                  <span className="text-[13px] font-bold text-[var(--text-primary)]">{i === 0 ? 'Current Plan' : `Scenario ${String.fromCharCode(64 + i)}`}</span>
                  <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.base ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--accent)]/10 text-[var(--accent)]'}`}>
                    {s.base ? 'Live return' : s.name}
                  </span>
                </button>
              </th>
            ))}
            <th className="px-3 py-2 text-center align-bottom">
              <button onClick={onAdd} className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-[var(--accent)]/40 px-4 py-2 text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/5">
                <Plus size={16} /><span className="text-[11px] font-semibold">Add scenario</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => (
            <tr key={row.label} className={`border-t border-black/5 ${row.highlight ? 'bg-[var(--accent)]/[0.04]' : ''}`}>
              <td className={`py-2.5 pl-2 text-[12.5px] ${row.highlight ? 'font-bold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>{row.label}</td>
              {results.map((r, i) => {
                const val = row.get(r);
                const delta = i === 0 ? 0 : val - row.get(base);
                const favourable = row.invert ? delta < 0 : delta > 0;
                return (
                  <td key={i} className="px-3 py-2.5 text-center">
                    <span className={`text-[13px] ${row.highlight ? 'font-bold text-[var(--text-primary)]' : 'font-semibold text-[var(--text-primary)]'}`}>{fmtMoney(val)}</span>
                    {i > 0 && delta !== 0 && (
                      <span className={`ml-1 inline-flex items-center text-[10.5px] font-semibold ${favourable ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {delta > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}{fmtMoney(Math.abs(delta))}
                      </span>
                    )}
                  </td>
                );
              })}
              <td />
            </tr>
          ))}
          {/* Difference vs Current */}
          <tr className="border-t-2 border-black/10">
            <td className="py-2.5 pl-2 text-[12.5px] font-semibold text-[var(--text-secondary)]">Difference vs Current</td>
            {results.map((r, i) => {
              const saving = base.totalTaxAndNic - r.totalTaxAndNic;
              return (
                <td key={i} className="px-3 py-2.5 text-center">
                  {i === 0 ? <span className="text-[13px] text-[var(--text-muted)]">—</span>
                    : saving > 0 ? <span className="text-[12.5px] font-bold text-emerald-600">You save {fmtMoney(saving)}</span>
                    : saving < 0 ? <span className="text-[12.5px] font-bold text-rose-500">{fmtMoney(Math.abs(saving))} more</span>
                    : <span className="text-[13px] text-[var(--text-muted)]">No change</span>}
                </td>
              );
            })}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
