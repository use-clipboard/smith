'use client';

import type React from 'react';
import { Check, X, Loader2, AlertTriangle, FileText, BarChart3 } from 'lucide-react';

export interface AgentProposal {
  id: string;
  kind: 'task_bulk_update' | 'task_bulk_delete' | 'client_bulk_update';
  summary: string;
  affectedCount: number;
  sample: Array<Record<string, unknown>>;
  // Plain-English description from the assistant text (filled in by parent)
  plainDescription?: string;
}

export interface AgentReport {
  title: string;
  summary: string;
  table?: { columns: string[]; rows: Array<Array<string | number | null>> };
  chart?: { kind: 'bar' | 'line'; xLabel?: string; yLabel?: string; data: { label: string; value: number }[] };
}

interface Props {
  proposal: AgentProposal | null;
  report:   AgentReport   | null;
  applying: boolean;
  appliedSummary: string | null;
  onConfirm: () => void;
  onCancel:  () => void;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  let mult: number;
  if (norm <= 1) mult = 1;
  else if (norm <= 2) mult = 2;
  else if (norm <= 5) mult = 5;
  else mult = 10;
  return mult * pow;
}

function MiniBarChart({ data, yLabel }: { data: { label: string; value: number }[]; yLabel?: string }) {
  if (data.length === 0) return null;
  const rawMax = Math.max(...data.map(d => d.value), 1);
  const max = niceCeil(rawMax);

  // Layout (viewBox units; the SVG scales to container width)
  const W = 560;
  const hasYLabel = !!yLabel;
  const padL = hasYLabel ? 78 : 50;   // generous room for Y-axis text + rotated yLabel
  const padR = 16;
  const padT = 16;
  const padB = 64;                    // enough for two-line angled labels
  const H = 260;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slot = plotW / data.length;
  const barW = Math.min(64, Math.max(10, slot * 0.6));

  function fmt(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return Math.round(n * 10) / 10 + '';
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-white rounded-lg border border-gray-200" role="img" aria-label="Bar chart">
      {/* Y-axis vertical line */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#e5e7eb" />
      {/* X-axis baseline */}
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#e5e7eb" />

      {/* Y-axis ticks */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => {
        const y = padT + plotH - plotH * f;
        const v = Math.round(max * f * 10) / 10;
        return (
          <g key={f}>
            <line x1={padL - 3} y1={y} x2={padL} y2={y} stroke="#e5e7eb" />
            {f > 0 && <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#f3f4f6" />}
            <text x={padL - 6} y={y} fontSize="10" fill="#6b7280" textAnchor="end" dominantBaseline="middle">{fmt(v)}</text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const cx = padL + i * slot + slot / 2;
        const x = cx - barW / 2;
        const h = (d.value / max) * plotH;
        const y = padT + plotH - h;
        const labelMax = Math.floor(slot / 6); // crude truncation based on slot width
        const label = d.label.length > labelMax ? d.label.slice(0, Math.max(6, labelMax - 1)) + '…' : d.label;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(1, h)} fill="#6366f1" rx="3" />
            {/* Value on top of bar */}
            <text x={cx} y={y - 4} fontSize="10" fill="#374151" textAnchor="middle" fontWeight="600">
              {fmt(d.value)}
            </text>
            {/* Angled X-axis label */}
            <text
              x={cx}
              y={padT + plotH + 14}
              fontSize="10"
              fill="#6b7280"
              textAnchor="end"
              transform={`rotate(-30, ${cx}, ${padT + plotH + 14})`}
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* Y-axis label (rotated, well to the left of tick numbers) */}
      {hasYLabel && (
        <text
          x={20}
          y={padT + plotH / 2}
          fontSize="11"
          fill="#6b7280"
          textAnchor="middle"
          transform={`rotate(-90, 20, ${padT + plotH / 2})`}
        >
          {yLabel}
        </text>
      )}
    </svg>
  );
}

// Tiny markdown renderer for the chat bubble. Handles **bold**, *italic*,
// `code`, and line breaks. Avoids bringing in a real markdown lib.
function renderInlineMarkdown(text: string): React.ReactNode {
  const segments: React.ReactNode[] = [];
  const regex = /(\*\*([^*]+?)\*\*|\*([^*\n]+?)\*|`([^`\n]+?)`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push(text.slice(lastIndex, m.index));
    if (m[2] !== undefined) segments.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined) segments.push(<em key={key++}>{m[3]}</em>);
    else if (m[4] !== undefined) segments.push(<code key={key++} className="px-1 py-0.5 rounded bg-gray-100 text-[11px] text-gray-700 font-mono">{m[4]}</code>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) segments.push(text.slice(lastIndex));
  return segments;
}

export function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {renderInlineMarkdown(line)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

export default function AgentPreview({ proposal, report, applying, appliedSummary, onConfirm, onCancel }: Props) {
  // Empty state
  if (!proposal && !report && !appliedSummary) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6 text-gray-400">
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <BarChart3 size={26} className="text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-600">Preview pane</p>
        <p className="text-xs mt-1 max-w-[280px]">
          Reports and proposed changes from Agent Smith will appear here. Nothing is saved until you click <strong>Confirm</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      {/* Applied state — success */}
      {appliedSummary && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
              <Check size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-emerald-900">Change applied</p>
              <p className="text-xs text-emerald-700 mt-0.5">{appliedSummary}</p>
              <p className="text-[11px] text-emerald-600 mt-2">
                Use the green <strong>Undo</strong> toast at the bottom-right (or Settings → Agent Smith) to revert within 24 hours.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Proposed change */}
      {proposal && !appliedSummary && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">Proposed change — not yet applied</p>
              <p className="text-xs text-amber-800 mt-0.5">{proposal.summary}</p>
            </div>
          </div>

          <div className="text-xs text-gray-600 mb-2 flex items-center justify-between">
            <span><strong className="text-gray-900">{proposal.affectedCount}</strong> row{proposal.affectedCount !== 1 ? 's' : ''} will be affected</span>
            <span className="text-gray-400">Sample (up to 10 of {proposal.affectedCount}):</span>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden text-xs">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {Object.keys(proposal.sample[0] ?? { name: '' }).slice(0, 5).map(k => (
                      <th key={k} className="px-3 py-1.5 text-left font-semibold text-gray-600 uppercase tracking-wide text-[10px]">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {proposal.sample.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 last:border-0">
                      {Object.keys(proposal.sample[0] ?? {}).slice(0, 5).map(k => (
                        <td key={k} className="px-3 py-1.5 text-gray-700 truncate max-w-[160px]">
                          {(() => { const v = row[k]; if (v == null) return '—'; if (typeof v === 'object') return JSON.stringify(v).slice(0, 30); return String(v); })()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={onConfirm}
              disabled={applying}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {applying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {applying ? 'Applying…' : `Confirm changes (${proposal.affectedCount})`}
            </button>
            <button
              onClick={onCancel}
              disabled={applying}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <X size={13} /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-start gap-2 mb-3">
            <FileText size={15} className="text-indigo-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{report.title}</p>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{report.summary}</p>
            </div>
          </div>

          {report.chart && report.chart.data.length > 0 && (
            <div className="mt-4">
              <MiniBarChart data={report.chart.data} yLabel={report.chart.yLabel} />
            </div>
          )}

          {report.table && report.table.rows.length > 0 && (
            <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {report.table.columns.map((c, i) => (
                        <th key={i} className="px-3 py-1.5 text-left font-semibold text-gray-600 uppercase tracking-wide text-[10px]">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.table.rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-gray-100 last:border-0">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 text-gray-700">
                            {cell == null ? '—' : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
