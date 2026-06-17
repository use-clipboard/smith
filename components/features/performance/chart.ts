import type { DOMOutputSpec } from '@tiptap/pm/model';

// ─── Chart spec ─────────────────────────────────────────────────────────────────
// A chart embedded in a Performance report. Rendered as plain HTML bars (divs with
// inline styles) so it shows identically in the editor and in the exported PDF
// (html2canvas renders divs reliably; SVG is hit-or-miss).

export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
}

export type ChartType = 'bar' | 'column' | 'pie'; // horizontal bars | vertical columns | pie

export interface ChartSpec {
  title?: string;
  type: ChartType;
  unit?: string;        // '', '%', '£', '$', '€'
  labels: string[];     // one category per row/group
  series: ChartSeries[];
}

export const CHART_PALETTE = ['#1a3558', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

export function fmtChartVal(v: number, unit?: string): string {
  if (!Number.isFinite(v)) return '—';
  const n = Math.round(v * 100) / 100;
  const s = n.toLocaleString('en-GB');
  if (unit === '%') return `${s}%`;
  if (unit === '£' || unit === '$' || unit === '€') return `${unit}${s}`;
  return unit ? `${s} ${unit}` : s;
}

// Render a pie to a PNG data URL via canvas. We embed pies as <img> (not SVG)
// because html2canvas renders raster images reliably but struggles with SVG arcs.
function pieDataUrl(values: number[], size: number): string {
  if (typeof document === 'undefined') return '';
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(dpr, dpr);
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) {
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL('image/png');
  }
  let start = -Math.PI / 2;
  values.forEach((v, i) => {
    const slice = (Math.max(0, v) / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    start += slice;
  });
  return canvas.toDataURL('image/png');
}

// ─── DOM-spec rendering (single source of truth) ────────────────────────────────
// Used by the TipTap node's renderHTML (editor + getHTML serialization) and, via
// domSpecToHtml(), by the builder's live preview.

type DomChild = DOMOutputSpec | string;
const el = (tag: string, attrs: Record<string, string>, ...children: DomChild[]): DOMOutputSpec =>
  ([tag, attrs, ...children] as unknown) as DOMOutputSpec;

export function chartToDom(spec: ChartSpec, width?: number | null): DOMOutputSpec {
  const labels = spec.labels ?? [];
  const series = spec.series ?? [];
  const allVals = series.flatMap(s => s.values).filter(v => Number.isFinite(v));
  const maxVal = Math.max(0, ...allVals.map(v => Math.abs(v)));
  const pct = (v: number) =>
    maxVal <= 0 || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(100, (Math.abs(v) / maxVal) * 100));

  const children: DomChild[] = [];

  if (spec.title) {
    children.push(el('div', { style: 'font-size:13px;font-weight:700;color:#1a3558;margin-bottom:10px;' }, spec.title));
  }

  if (series.length > 1) {
    children.push(
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;margin:0 0 12px;' },
        ...series.map(s =>
          el('div', { style: 'display:flex;align-items:center;gap:6px;font-size:11px;color:#475569;' },
            el('span', { style: `width:11px;height:11px;border-radius:2px;display:inline-block;background:${s.color};` }),
            s.name || '',
          ),
        ),
      ),
    );
  }

  if (spec.type === 'pie') {
    // Pie uses a single series — slices by category (label). Rendered as a PNG
    // (canvas) with an HTML legend beside it; both are PDF-safe.
    const s = series[0];
    const vals = (s?.values ?? []).map(v => (Number.isFinite(v) ? Math.max(0, v) : 0));
    const total = vals.reduce((a, b) => a + b, 0);
    const size = 200;
    const dataUrl = pieDataUrl(vals, size);
    const legend = el('div', { style: 'display:flex;flex-direction:column;gap:7px;flex:1;min-width:170px;' },
      ...labels.map((label, i) => {
        const pctOfTotal = total > 0 ? Math.round((vals[i] / total) * 100) : 0;
        return el('div', { style: 'display:flex;align-items:center;gap:8px;font-size:11px;' },
          el('span', { style: `width:12px;height:12px;border-radius:2px;flex-shrink:0;background:${CHART_PALETTE[i % CHART_PALETTE.length]};` }),
          el('span', { style: 'flex:1;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, label ?? ''),
          el('span', { style: 'font-weight:700;color:#0f172a;flex-shrink:0;' }, `${fmtChartVal(vals[i], spec.unit)} · ${pctOfTotal}%`),
        );
      }),
    );
    children.push(
      el('div', { style: 'display:flex;align-items:center;gap:22px;flex-wrap:wrap;' },
        el('img', { src: dataUrl, width: String(size), height: String(size), alt: spec.title || 'Pie chart', style: `width:${size}px;height:${size}px;flex-shrink:0;` }),
        legend,
      ),
    );
  } else if (spec.type === 'column') {
    // Vertical grouped columns. Heights are % of a fixed plot height.
    const PLOT_H = 190;
    const colW = Math.max(8, Math.min(26, Math.floor(46 / Math.max(1, series.length))));
    const plot = el('div',
      { style: `display:flex;align-items:flex-end;gap:10px;height:${PLOT_H}px;border-bottom:1px solid #cbd5e1;padding-top:16px;` },
      ...labels.map((_, i) =>
        el('div', { style: 'flex:1;min-width:0;display:flex;align-items:flex-end;justify-content:center;gap:3px;height:100%;' },
          ...series.map(s => {
            const v = s.values[i];
            return el('div', { style: `position:relative;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;` },
              el('div', { style: 'font-size:9.5px;font-weight:700;color:#0f172a;margin-bottom:2px;white-space:nowrap;' }, fmtChartVal(v, spec.unit)),
              el('div', { style: `width:${colW}px;height:${pct(v)}%;background:${s.color};border-radius:3px 3px 0 0;` }),
            );
          }),
        ),
      ),
    );
    const xLabels = el('div', { style: 'display:flex;gap:10px;margin-top:5px;' },
      ...labels.map(label =>
        el('div', { style: 'flex:1;min-width:0;text-align:center;font-size:10.5px;font-weight:600;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, label ?? ''),
      ),
    );
    children.push(plot, xLabels);
  } else {
    const rows = labels.map((label, i) =>
      el('div', { style: 'margin:9px 0;' },
        el('div', { style: 'font-size:11.5px;font-weight:600;color:#1f2937;margin-bottom:4px;' }, label ?? ''),
        el('div', { style: 'display:flex;flex-direction:column;gap:4px;' },
          ...series.map(s => {
            const v = s.values[i];
            return el('div', { style: 'display:flex;align-items:center;gap:8px;' },
              el('div', { style: 'flex:1;height:15px;background:#ffffff;border:1px solid #e2e8f0;border-radius:3px;overflow:hidden;' },
                el('div', { style: `height:100%;border-radius:3px;width:${pct(v)}%;background:${s.color};` }),
              ),
              el('div', { style: 'width:66px;text-align:right;font-size:11px;font-weight:700;color:#0f172a;flex-shrink:0;' },
                fmtChartVal(v, spec.unit)),
            );
          }),
        ),
      ),
    );
    children.push(el('div', {}, ...rows));
  }

  const attrs: Record<string, string> = {
    'data-perf-chart': '',
    'data-chart-spec': JSON.stringify(spec),
    class: 'perf-chart',
    contenteditable: 'false',
    style: `box-sizing:border-box;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;margin:16px 0;background:#f8fafc;${width ? `width:${width}%;` : ''}`,
  };
  if (width) attrs['data-chart-width'] = String(width);
  return el('div', attrs, ...children);
}

// Serialize the same DOM spec to an HTML string (for the builder preview).
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
export function domSpecToHtml(node: DomChild): string {
  if (typeof node === 'string') return escapeHtml(node);
  const [tag, attrs, ...children] = node as unknown as [string, Record<string, string>, ...DomChild[]];
  const attrStr = Object.entries(attrs || {})
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('');
  const inner = children.map(domSpecToHtml).join('');
  return `<${tag}${attrStr}>${inner}</${tag}>`;
}

export function chartToHtml(spec: ChartSpec, width?: number | null): string {
  return domSpecToHtml(chartToDom(spec, width));
}

// Serialize a spec back to tab-separated text so the builder can re-edit it.
export function specToTsv(spec: ChartSpec): string {
  const header = ['', ...spec.series.map(s => s.name)].join('\t');
  const rows = spec.labels.map((label, i) =>
    [label, ...spec.series.map(s => String(s.values[i] ?? ''))].join('\t'));
  return [header, ...rows].join('\n');
}

// ─── Tabular data parsing (clipboard / report tables → ChartSpec) ────────────────

export interface ParsedGrid { headers: string[]; rows: { label: string; values: number[] }[]; }

const toNum = (s: string): number => {
  const v = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(v) ? v : NaN;
};

// Turn a raw 2D grid (first row = headers, first col = labels, rest = numeric
// series) into a ParsedGrid. Drops fully non-numeric columns.
export function gridToParsed(grid: string[][]): ParsedGrid {
  const clean = grid.filter(r => r.some(c => (c ?? '').trim() !== ''));
  if (clean.length === 0) return { headers: [], rows: [] };
  const headerRow = clean[0];
  const bodyRows = clean.slice(1);
  // Which columns (after col 0) hold at least one number?
  const numericCols: number[] = [];
  for (let c = 1; c < headerRow.length; c++) {
    if (bodyRows.some(r => Number.isFinite(toNum(r[c])))) numericCols.push(c);
  }
  const headers = numericCols.map(c => (headerRow[c] ?? `Series ${c}`).trim() || `Series ${c}`);
  const rows = bodyRows.map(r => ({
    label: (r[0] ?? '').trim(),
    values: numericCols.map(c => { const n = toNum(r[c]); return Number.isFinite(n) ? n : 0; }),
  })).filter(r => r.label !== '');
  return { headers, rows };
}

// Parse pasted text (TSV from Excel/Sheets, or CSV) into a grid.
export function parseTabularText(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  return lines.map(line => {
    const cells = line.includes('\t') ? line.split('\t') : splitCsvLine(line);
    return cells.map(c => c.trim());
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Build a ChartSpec from a ParsedGrid + chosen styling.
export function gridToChartSpec(parsed: ParsedGrid, opts: { title?: string; unit?: string; type?: ChartType }): ChartSpec {
  return {
    type: opts.type ?? 'bar',
    title: opts.title?.trim() || undefined,
    unit: opts.unit || undefined,
    labels: parsed.rows.map(r => r.label),
    series: parsed.headers.map((name, si) => ({
      name,
      color: CHART_PALETTE[si % CHART_PALETTE.length],
      values: parsed.rows.map(r => r.values[si] ?? 0),
    })),
  };
}
