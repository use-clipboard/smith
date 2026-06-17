'use client';
import { useMemo, useState, useEffect } from 'react';
import { X, BarChart3, BarChartHorizontal, PieChart, ClipboardPaste, Table as TableIcon, TrendingUp, Check } from 'lucide-react';
import {
  type ChartSpec, type ChartType, parseTabularText, gridToParsed, gridToChartSpec, chartToHtml, specToTsv,
} from './chart';

export interface ReportTable { id: string; label: string; grid: string[][]; }
export interface KpiDatum { label: string; company: number; benchmark: number; }

type Source = 'paste' | 'table' | 'kpi';

interface ChartBuilderProps {
  open: boolean;
  onClose: () => void;
  onInsert: (spec: ChartSpec) => void;
  tables: ReportTable[];
  kpiData?: KpiDatum[];
  /** When set, the builder opens pre-filled to edit an existing chart. */
  editSpec?: ChartSpec | null;
}

const UNITS = [
  { value: '',  label: 'None' },
  { value: '%', label: 'Percent (%)' },
  { value: '£', label: 'Pounds (£)' },
  { value: '$', label: 'Dollars ($)' },
  { value: '€', label: 'Euros (€)' },
];

export default function ChartBuilder({ open, onClose, onInsert, tables, kpiData, editSpec }: ChartBuilderProps) {
  const hasKpi = !!(kpiData && kpiData.length > 0);
  const [source, setSource] = useState<Source>('paste');
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [tableId, setTableId] = useState<string>('');
  const [selectedCols, setSelectedCols] = useState<boolean[]>([]);
  const [chartType, setChartType] = useState<ChartType>('bar');

  // Reset / pre-fill each time the modal opens.
  useEffect(() => {
    if (!open) return;
    if (editSpec) {
      // Editing an existing chart — load its data into the paste editor.
      setSource('paste');
      setPasteText(specToTsv(editSpec));
      setTitle(editSpec.title ?? '');
      setUnit(editSpec.unit ?? '');
      setChartType(editSpec.type ?? 'bar');
      return;
    }
    setTitle(''); setUnit(''); setPasteText(''); setChartType('bar');
    if (tables.length > 0) { setSource('table'); setTableId(tables[0].id); }
    else if (hasKpi) setSource('kpi');
    else setSource('paste');
  }, [open, tables, hasKpi, editSpec]);

  // Resolve the raw grid for the active source.
  const grid = useMemo<string[][]>(() => {
    if (source === 'paste') return parseTabularText(pasteText);
    if (source === 'table') return tables.find(t => t.id === tableId)?.grid ?? [];
    if (source === 'kpi' && kpiData) {
      return [
        ['KPI', 'Company', 'Benchmark'],
        ...kpiData.map(d => [d.label, String(d.company), String(d.benchmark)]),
      ];
    }
    return [];
  }, [source, pasteText, tableId, tables, kpiData]);

  const parsed = useMemo(() => gridToParsed(grid), [grid]);

  // Which numeric columns to plot. Reset to "all" whenever the column set changes.
  const headersKey = parsed.headers.join('|');
  useEffect(() => { setSelectedCols(parsed.headers.map(() => true)); }, [headersKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleCol = (i: number) =>
    setSelectedCols(prev => { const next = [...prev]; next[i] = !(next[i] ?? true); return next; });

  const filtered = useMemo(() => ({
    headers: parsed.headers.filter((_, i) => selectedCols[i] ?? true),
    rows: parsed.rows.map(r => ({ label: r.label, values: r.values.filter((_, i) => selectedCols[i] ?? true) })),
  }), [parsed, selectedCols]);

  const spec = useMemo<ChartSpec>(() => gridToChartSpec(filtered, { title, unit, type: chartType }), [filtered, title, unit, chartType]);
  const canInsert = filtered.rows.length > 0 && filtered.headers.length > 0;
  const previewHtml = useMemo(() => (canInsert ? chartToHtml(spec) : ''), [canInsert, spec]);

  if (!open) return null;

  const SourceTab = ({ id, icon, label, disabled }: { id: Source; icon: React.ReactNode; label: string; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => setSource(id)}
      className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed
        ${source === id ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'}`}>
      {icon}{label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl bg-white border border-[var(--border)] shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
            <BarChart3 size={16} className="text-[var(--accent)]" /> {editSpec ? 'Edit chart' : 'Insert chart'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ── Left: configure ── */}
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Data source</label>
              <div className="flex flex-wrap gap-2">
                <SourceTab id="paste" icon={<ClipboardPaste size={13} />} label="Paste data" />
                <SourceTab id="table" icon={<TableIcon size={13} />} label="Report table" disabled={tables.length === 0} />
                {hasKpi && <SourceTab id="kpi" icon={<TrendingUp size={13} />} label="KPI benchmark" />}
              </div>
            </div>

            {source === 'paste' && (
              <div>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={7}
                  placeholder={'Paste from Excel, Sheets or CSV…\n\nKPI\tCompany\tBenchmark\nGross Margin %\t44\t60\nNet Margin %\t-11\t14'}
                  className="w-full rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-3 py-2 text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-y" />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">First row = column headers, first column = row labels. Numeric columns become bars.</p>
              </div>
            )}

            {source === 'table' && (
              <div>
                <select value={tableId} onChange={e => setTableId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                  {tables.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Uses the table&apos;s first row as headers and first column as labels.</p>
              </div>
            )}

            {source === 'kpi' && (
              <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-nav-hover)] rounded-lg px-3 py-2.5">
                Building a chart from the <strong>KPIs vs industry benchmark</strong> data ({kpiData?.length ?? 0} KPIs).
              </p>
            )}

            {parsed.headers.length > 0 && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Columns to plot</label>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.headers.map((h, i) => {
                    const on = selectedCols[i] ?? true;
                    return (
                      <button key={i} type="button" onClick={() => toggleCol(i)}
                        className={`flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11px] font-medium border transition-colors
                          ${on ? 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)] border-[var(--border)]'}`}>
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-input)]'}`}>
                          {on && <Check size={9} className="text-white" />}
                        </span>
                        {h}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Plot columns that share a scale (all £ or all %) so the bars are comparable.</p>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Chart type</label>
              <div className="flex gap-2">
                {([
                  { id: 'bar' as ChartType, icon: <BarChartHorizontal size={13} />, label: 'Bars' },
                  { id: 'column' as ChartType, icon: <BarChart3 size={13} />, label: 'Columns' },
                  { id: 'pie' as ChartType, icon: <PieChart size={13} />, label: 'Pie' },
                ]).map(t => (
                  <button key={t.id} type="button" onClick={() => setChartType(t.id)}
                    className={`flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold border transition-colors
                      ${chartType === t.id ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'}`}>
                    {t.icon}{t.label}
                  </button>
                ))}
              </div>
              {chartType === 'pie' && filtered.headers.length > 1 && (
                <p className="text-[11px] text-amber-600 mt-1">A pie uses one column — only the first selected column ({filtered.headers[0]}) is shown.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Title</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Optional"
                  className="w-full h-9 rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Unit</label>
                <select value={unit} onChange={e => setUnit(e.target.value)}
                  className="w-full h-9 rounded-lg border border-[var(--border-input)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
                  {UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* ── Right: preview ── */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Preview</label>
            <div className="rounded-lg border border-dashed border-[var(--border)] bg-white p-3 min-h-[180px] flex items-center justify-center overflow-auto">
              {canInsert
                ? <div className="w-full" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                : <span className="text-xs text-[var(--text-muted)]">Add data to see a preview</span>}
            </div>
            {canInsert && (
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                {parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'} · {parsed.headers.length} {parsed.headers.length === 1 ? 'series' : 'series'}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--border)]">
          <button type="button" onClick={onClose} className="btn-secondary text-xs h-9 px-4">Cancel</button>
          <button type="button" disabled={!canInsert} onClick={() => onInsert(spec)}
            className="btn-primary text-xs h-9 px-4 disabled:opacity-40 disabled:cursor-not-allowed">
            {editSpec ? 'Update chart' : 'Insert chart'}
          </button>
        </div>
      </div>
    </div>
  );
}
