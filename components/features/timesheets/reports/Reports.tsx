'use client';

import { useMemo, useState } from 'react';
import {
  Users2, UserSquare2, Repeat2, Gauge, TrendingUp, Layers, Target, Activity, Download, Printer, Pencil,
} from 'lucide-react';
import type { TimeEntry } from '@/lib/timesheets/types';
import { useTimesheets } from '../TimesheetsProvider';
import {
  byClient, perStaff, valueOf, recoveryFactor, defaultWeeklyBudgetMinutes,
} from '@/lib/timesheets/compute';
import { weekDates, addDays, todayIso, fmtDuration, fmtHours, fmtPct, fmtGBPCompact, fmtDateUK } from '@/lib/timesheets/format';
import { colorAt } from '@/lib/timesheets/palette';
import { exportReportPdf } from '@/lib/timesheets/reportPdf';
import { GlassCard } from '../shared/ui';
import BudgetEditorModal from './BudgetEditorModal';

type Period = 'this' | 'last' | 'fortnight' | 'custom';

/** Inclusive list of ISO dates between two dates (guarded to ~13 months). */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard++ < 400) { out.push(d); d = addDays(d, 1); }
  return out;
}

interface ReportRow {
  id: string;
  label: string;
  primary: string;
  ratio: number;       // 0–1 bar fill
  color: string;
  secondary?: string;
  target?: number;     // 0–1 marker position
}

interface ReportResult {
  rows: ReportRow[];
  summary: { label: string; value: string }[];
  /** CSV header + rows for export. */
  csv: { headers: string[]; data: (string | number)[][] };
}

interface ReportDef {
  id: string;
  label: string;
  icon: typeof Users2;
  description: string;
  compute: (entries: TimeEntry[]) => ReportResult;
}

const COST_RATIO = 0.42; // salary cost as a share of charge-out rate

function makeReports(): ReportDef[] {
  return [
    {
      id: 'client', label: 'Time by client', icon: Users2, description: 'Hours and fees by client',
      compute: (entries) => {
        const slices = byClient(entries);
        const max = Math.max(1, ...slices.map(s => s.minutes));
        const totalVal = slices.reduce((s, x) => s + x.valuePence, 0);
        return {
          rows: slices.map((s, i) => ({
            id: s.id, label: s.label, primary: fmtDuration(s.minutes), ratio: s.minutes / max,
            color: colorAt(i), secondary: fmtGBPCompact(s.valuePence),
          })),
          summary: [
            { label: 'Clients', value: String(slices.filter(s => s.id !== 'internal').length) },
            { label: 'Total fees', value: fmtGBPCompact(totalVal) },
          ],
          csv: { headers: ['Client', 'Minutes', 'Hours', 'Chargeable (£)'], data: slices.map(s => [s.label, s.minutes, (s.minutes / 60).toFixed(2), (s.valuePence / 100).toFixed(2)]) },
        };
      },
    },
    {
      id: 'staff', label: 'Time by staff', icon: UserSquare2, description: 'Logged hours per team member',
      compute: () => ({ rows: [], summary: [], csv: { headers: [], data: [] } }), // replaced below (needs staff)
    },
    {
      id: 'recovery', label: 'Recovery rate', icon: Repeat2, description: 'Recovered vs standard fees by client',
      compute: (entries) => {
        const slices = byClient(entries).filter(s => s.id !== 'internal');
        return {
          rows: slices.map((s, i) => {
            const f = recoveryFactor(s.id);
            return {
              id: s.id, label: s.label, primary: fmtPct(f), ratio: Math.min(1, f),
              color: f >= 0.9 ? '#10B981' : f >= 0.78 ? '#F59E0B' : '#F43F5E',
              secondary: `${fmtGBPCompact(Math.round(s.valuePence * f))} of ${fmtGBPCompact(s.valuePence)}`,
              target: 0.9,
            };
          }),
          summary: [
            { label: 'Avg recovery', value: fmtPct(slices.length ? slices.reduce((a, s) => a + recoveryFactor(s.id), 0) / slices.length : 0) },
            { label: 'Target', value: '90%' },
          ],
          csv: { headers: ['Client', 'Standard (£)', 'Recovery %', 'Recovered (£)'], data: slices.map(s => [s.label, (s.valuePence / 100).toFixed(2), Math.round(recoveryFactor(s.id) * 100), ((s.valuePence * recoveryFactor(s.id)) / 100).toFixed(2)]) },
        };
      },
    },
    {
      id: 'profit', label: 'Profitability', icon: TrendingUp, description: 'Estimated margin by client',
      compute: (entries) => {
        const map = new Map<string, { label: string; value: number; cost: number }>();
        for (const e of entries) {
          if (!e.clientId) continue;
          const cur = map.get(e.clientId) ?? { label: e.clientName, value: 0, cost: 0 };
          cur.value += Math.round(valueOf(e) * recoveryFactor(e.clientId));
          cur.cost += Math.round((e.minutes / 60) * e.ratePence * COST_RATIO);
          map.set(e.clientId, cur);
        }
        const rows = [...map.entries()].map(([id, v]) => ({ id, ...v, profit: v.value - v.cost }))
          .sort((a, b) => b.profit - a.profit);
        const max = Math.max(1, ...rows.map(r => Math.abs(r.profit)));
        const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
        return {
          rows: rows.map((r, i) => ({
            id: r.id, label: r.label, primary: fmtGBPCompact(r.profit), ratio: Math.abs(r.profit) / max,
            color: r.profit >= 0 ? colorAt(i) : '#F43F5E',
            secondary: `${fmtGBPCompact(r.value)} fees − ${fmtGBPCompact(r.cost)} cost`,
          })),
          summary: [
            { label: 'Total margin', value: fmtGBPCompact(totalProfit) },
            { label: 'Clients', value: String(rows.length) },
          ],
          csv: { headers: ['Client', 'Recovered fees (£)', 'Cost (£)', 'Margin (£)'], data: rows.map(r => [r.label, (r.value / 100).toFixed(2), (r.cost / 100).toFixed(2), (r.profit / 100).toFixed(2)]) },
        };
      },
    },
    {
      id: 'wip', label: 'WIP', icon: Layers, description: 'Unbilled work in progress by client',
      compute: (entries) => {
        const slices = byClient(entries).filter(s => s.id !== 'internal');
        // WIP ≈ chargeable value still to be billed (standard − recovered).
        const rows = slices.map(s => ({ ...s, wip: Math.round(s.valuePence * (1 - recoveryFactor(s.id) * 0.6)) }))
          .sort((a, b) => b.wip - a.wip);
        const max = Math.max(1, ...rows.map(r => r.wip));
        const totalWip = rows.reduce((s, r) => s + r.wip, 0);
        return {
          rows: rows.map((r, i) => ({
            id: r.id, label: r.label, primary: fmtGBPCompact(r.wip), ratio: r.wip / max,
            color: colorAt(i), secondary: fmtDuration(r.minutes),
          })),
          summary: [
            { label: 'Total WIP', value: fmtGBPCompact(totalWip) },
            { label: 'Clients', value: String(rows.length) },
          ],
          csv: { headers: ['Client', 'Hours', 'WIP balance (£)'], data: rows.map(r => [r.label, (r.minutes / 60).toFixed(2), (r.wip / 100).toFixed(2)]) },
        };
      },
    },
    // 'budget' (Budget vs Actual) is computed in the component with live
    // per-client budgets — see the reportId === 'budget' branch below.
  ];
}

export default function Reports() {
  const { entries, staff, clientBudgets, setClientBudget } = useTimesheets();
  const [period, setPeriod] = useState<Period>('this');
  const [reportId, setReportId] = useState('client');
  const [toast, setToast] = useState('');
  const [editingBudgets, setEditingBudgets] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => addDays(todayIso(), -29));
  const [customTo, setCustomTo] = useState(() => todayIso());

  // Guard against an inverted custom range.
  const rangeFrom = customFrom <= customTo ? customFrom : customTo;
  const rangeTo = customFrom <= customTo ? customTo : customFrom;

  const customDates = useMemo(() => datesBetween(rangeFrom, rangeTo), [rangeFrom, rangeTo]);
  const weeks = period === 'fortnight' ? 2 : period === 'custom' ? Math.max(1, customDates.length / 7) : 1;

  const dateSet = useMemo(() => {
    if (period === 'custom') return new Set(customDates);
    if (period === 'fortnight') return new Set([...weekDates(todayIso()), ...weekDates(addDays(todayIso(), -7))]);
    if (period === 'last') return new Set(weekDates(addDays(todayIso(), -7)));
    return new Set(weekDates(todayIso()));
  }, [period, customDates]);

  const scoped = useMemo(() => entries.filter(e => dateSet.has(e.date)), [entries, dateSet]);

  const reports = useMemo(() => makeReports(), []);

  // "Time by staff" + "Utilisation" + "Team workload" need the staff list, so compute here.
  const staffTime = useMemo(() => {
    const rows = perStaff(scoped, staff, todayIso())
      .map(r => ({ ...r, mins: entriesForStaff(scoped, r.staff.id) }))
      .sort((a, b) => b.mins - a.mins);
    const max = Math.max(1, ...rows.map(r => r.mins));
    return { rows, max };
  }, [scoped, staff]);

  function entriesForStaff(list: TimeEntry[], id: string) {
    return list.filter(e => e.userId === id).reduce((s, e) => s + e.minutes, 0);
  }

  const result: ReportResult = useMemo(() => {
    if (reportId === 'staff') {
      return {
        rows: staffTime.rows.map(r => ({
          id: r.staff.id, label: r.staff.name, primary: fmtDuration(r.mins), ratio: r.mins / staffTime.max,
          color: `hsl(${r.staff.hue} 70% 58%)`, secondary: `${fmtPct(r.billablePct)} billable`,
        })),
        summary: [
          { label: 'Team', value: String(staffTime.rows.length) },
          { label: 'Total', value: fmtHours(staffTime.rows.reduce((s, r) => s + r.mins, 0)) },
        ],
        csv: { headers: ['Staff', 'Hours', 'Billable %'], data: staffTime.rows.map(r => [r.staff.name, (r.mins / 60).toFixed(2), Math.round(r.billablePct * 100)]) },
      };
    }
    if (reportId === 'utilisation') {
      const rows = perStaff(scoped, staff, todayIso());
      return {
        rows: rows.map(r => ({
          id: r.staff.id, label: r.staff.name, primary: fmtPct(r.utilisation), ratio: Math.min(1, r.utilisation),
          color: r.utilisation >= 0.85 ? '#10B981' : r.utilisation >= 0.6 ? '#F59E0B' : '#F43F5E',
          secondary: `${fmtDuration(r.billable)} billable`, target: 0.85,
        })),
        summary: [
          { label: 'Avg utilisation', value: fmtPct(rows.length ? rows.reduce((a, r) => a + r.utilisation, 0) / rows.length : 0) },
          { label: 'Target', value: '85%' },
        ],
        csv: { headers: ['Staff', 'Utilisation %', 'Billable hours'], data: rows.map(r => [r.staff.name, Math.round(r.utilisation * 100), (r.billable / 60).toFixed(2)]) },
      };
    }
    if (reportId === 'workload') {
      const rows = perStaff(scoped, staff, todayIso());
      const maxCap = Math.max(1, ...rows.map(r => r.capacityMinutes));
      return {
        rows: rows.map(r => {
          const load = r.capacityMinutes ? r.minutes / r.capacityMinutes : 0;
          return {
            id: r.staff.id, label: r.staff.name, primary: fmtDuration(r.minutes), ratio: r.minutes / maxCap,
            color: load >= 0.95 ? '#F43F5E' : load >= 0.75 ? '#10B981' : '#F59E0B',
            secondary: `${fmtPct(load)} of capacity`, target: r.capacityMinutes / maxCap,
          };
        }),
        summary: [
          { label: 'Overloaded', value: String(rows.filter(r => r.minutes / (r.capacityMinutes || 1) >= 0.95).length) },
          { label: 'Has headroom', value: String(rows.filter(r => r.minutes / (r.capacityMinutes || 1) < 0.75).length) },
        ],
        csv: { headers: ['Staff', 'Logged (h)', 'Capacity (h)', 'Load %'], data: rows.map(r => [r.staff.name, (r.minutes / 60).toFixed(2), (r.capacityMinutes / 60).toFixed(1), Math.round((r.minutes / (r.capacityMinutes || 1)) * 100)]) },
      };
    }
    if (reportId === 'budget') {
      const slices = byClient(scoped).filter(s => s.id !== 'internal');
      const rows = slices.map(s => ({ ...s, budget: (clientBudgets[s.id] ?? defaultWeeklyBudgetMinutes(s.id)) * weeks }));
      const max = Math.max(1, ...rows.map(r => Math.max(r.minutes, r.budget)));
      return {
        rows: rows.map(r => {
          const over = r.minutes > r.budget;
          return {
            id: r.id, label: r.label, primary: `${fmtHours(r.minutes)} / ${fmtHours(r.budget)}`,
            ratio: r.minutes / max, color: over ? '#F43F5E' : '#10B981',
            secondary: over ? `${fmtDuration(r.minutes - r.budget)} over` : `${fmtDuration(r.budget - r.minutes)} left`,
            target: r.budget / max,
          };
        }),
        summary: [
          { label: 'Over budget', value: String(rows.filter(r => r.minutes > r.budget).length) },
          { label: 'On track', value: String(rows.filter(r => r.minutes <= r.budget).length) },
        ],
        csv: { headers: ['Client', 'Budget (h)', 'Actual (h)', 'Variance (h)'], data: rows.map(r => [r.label, (r.budget / 60).toFixed(1), (r.minutes / 60).toFixed(1), ((r.minutes - r.budget) / 60).toFixed(1)]) },
      };
    }
    return reports.find(r => r.id === reportId)!.compute(scoped);
  }, [reportId, scoped, staff, staffTime, reports, clientBudgets, weeks]);

  const NAV: { id: string; label: string; icon: typeof Users2 }[] = [
    { id: 'client', label: 'Time by client', icon: Users2 },
    { id: 'staff', label: 'Time by staff', icon: UserSquare2 },
    { id: 'recovery', label: 'Recovery rate', icon: Repeat2 },
    { id: 'utilisation', label: 'Utilisation', icon: Gauge },
    { id: 'profit', label: 'Profitability', icon: TrendingUp },
    { id: 'wip', label: 'WIP', icon: Layers },
    { id: 'budget', label: 'Budget vs Actual', icon: Target },
    { id: 'workload', label: 'Team workload', icon: Activity },
  ];
  const activeNav = NAV.find(n => n.id === reportId)!;

  function exportCsv() {
    const { headers, data } = result.csv;
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.map(esc).join(','), ...data.map(row => row.map(esc).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheets-${reportId}-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast('Exported to CSV');
    window.setTimeout(() => setToast(''), 2200);
  }

  function exportPdf() {
    exportReportPdf({
      title: activeNav.label,
      periodLabel,
      summary: result.summary,
      rows: result.rows.map(r => ({
        label: r.label, primary: r.primary, secondary: r.secondary, ratio: r.ratio, color: r.color, target: r.target,
      })),
    });
  }

  const periodLabel =
    period === 'this' ? 'This week'
    : period === 'last' ? 'Last week'
    : period === 'fortnight' ? 'Last 2 weeks'
    : `${fmtDateUK(rangeFrom)} – ${fmtDateUK(rangeTo)}`;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-1 rounded-xl bg-[var(--bg-nav-hover)] p-1">
            {(['this', 'last', 'fortnight', 'custom'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${period === p ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]'}`}>
                {p === 'this' ? 'This week' : p === 'last' ? 'Last week' : p === 'fortnight' ? 'Fortnight' : 'Custom'}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-1.5 rounded-xl bg-white/70 px-2.5 py-1.5 shadow-sm">
              <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)}
                className="bg-transparent text-[12.5px] text-[var(--text-primary)] outline-none" />
              <span className="text-[var(--text-muted)]">→</span>
              <input type="date" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value)}
                className="bg-transparent text-[12.5px] text-[var(--text-primary)] outline-none" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {reportId === 'budget' && (
            <button onClick={() => setEditingBudgets(true)} className="btn-secondary"><Pencil size={14} /> Edit budgets</button>
          )}
          <button onClick={exportPdf} className="btn-secondary"><Printer size={15} /> PDF</button>
          <button onClick={exportCsv} className="btn-primary"><Download size={15} /> Export Excel</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        {/* Report picker */}
        <GlassCard padded={false} className="h-fit lg:col-span-1">
          <div className="p-2">
            {NAV.map(n => {
              const Icon = n.icon;
              const active = n.id === reportId;
              return (
                <button key={n.id} onClick={() => setReportId(n.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${active ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-black/[0.03]'}`}>
                  <Icon size={16} className="shrink-0" />
                  {n.label}
                </button>
              );
            })}
          </div>
        </GlassCard>

        {/* Report body */}
        <GlassCard className="lg:col-span-3">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <activeNav.icon size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">{activeNav.label}</h3>
                <p className="text-xs text-[var(--text-muted)]">{periodLabel}</p>
              </div>
            </div>
            <div className="flex gap-4">
              {result.summary.map(s => (
                <div key={s.label} className="text-right">
                  <p className="text-[17px] font-bold text-[var(--text-primary)]">{s.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {result.rows.length === 0 && <p className="py-10 text-center text-sm text-[var(--text-muted)]">No data for this period.</p>}
            {result.rows.map(r => (
              <div key={r.id} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-[12.5px] font-medium text-[var(--text-primary)]" title={r.label}>{r.label}</div>
                <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-black/[0.04]">
                  <div className="h-full rounded-lg transition-[width] duration-700" style={{ width: `${Math.max(2, r.ratio * 100)}%`, background: r.color }} />
                  {r.target != null && (
                    <div className="absolute top-0 bottom-0 w-0.5 bg-[#0F0F1A]/40" style={{ left: `${Math.min(100, r.target * 100)}%` }} />
                  )}
                </div>
                <div className="w-40 shrink-0 text-right">
                  <p className="text-[12.5px] font-bold text-[var(--text-primary)]">{r.primary}</p>
                  {r.secondary && <p className="text-[10px] text-[var(--text-muted)]">{r.secondary}</p>}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-xl bg-[#1A1A2E] px-4 py-3 text-sm font-medium text-white shadow-lg">
          <Download size={15} /> {toast}
        </div>
      )}

      {editingBudgets && <BudgetEditorModal onClose={() => setEditingBudgets(false)} />}
    </div>
  );
}
