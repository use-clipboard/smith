'use client';
import { Trash2, Plus } from 'lucide-react';
import type { WorkingPaper, WorkingPaperTableRow } from '@/types';

// Serialise table rows back to a plain-text content string for PDF export
function tableToContent(paper: WorkingPaper): string {
  if (!paper.table) return paper.content;
  const { columns, rows } = paper.table;
  const SEP = '─'.repeat(Math.max(60, columns.length * 18));
  const colW = Math.floor(64 / columns.length);
  const pad = (s: string) => String(s ?? '').padEnd(colW).slice(0, colW);
  const header = columns.map(pad).join(' ');
  const dataRows = rows.map(r => columns.map(c => pad(r[c] ?? '')).join(' ')).join('\n');
  const notesStr = paper.notes ? `\n\nUser Notes:\n${paper.notes}` : '';
  return `${header}\n${SEP}\n${dataRows || ''}${notesStr}`;
}

function emptyRow(columns: string[]): WorkingPaperTableRow {
  return Object.fromEntries(columns.map(c => [c, '']));
}

interface Props {
  paper: WorkingPaper;
  onChange: (updated: WorkingPaper) => void;
}

export default function WorkingPaperSection({ paper, onChange }: Props) {
  if (paper.table) {
    return <TableSection paper={paper} onChange={onChange} />;
  }
  return <TextSection paper={paper} onChange={onChange} />;
}

function TableSection({ paper, onChange }: Props) {
  const { columns, rows } = paper.table!;

  function update(newRows: WorkingPaperTableRow[], newNotes?: string) {
    const updated: WorkingPaper = {
      ...paper,
      table: { columns, rows: newRows },
      notes: newNotes ?? paper.notes ?? '',
    };
    updated.content = tableToContent(updated);
    onChange(updated);
  }

  function updateCell(rowIdx: number, col: string, value: string) {
    const newRows = rows.map((r, i) => i === rowIdx ? { ...r, [col]: value } : r);
    update(newRows);
  }

  function addRow() {
    update([...rows, emptyRow(columns)]);
  }

  function removeRow(rowIdx: number) {
    update(rows.filter((_, i) => i !== rowIdx));
  }

  function updateNotes(notes: string) {
    update(rows, notes);
  }

  return (
    <div className="glass-solid rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--border)]">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{paper.title}</h4>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
              {columns.map(col => (
                <th key={col} className="text-left px-3 py-2 font-semibold text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">
                  {col}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="text-center py-6 text-[var(--text-muted)] italic text-xs">
                  (No data added yet)
                </td>
              </tr>
            )}
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-[var(--border)] last:border-0 group">
                {columns.map(col => (
                  <td key={col} className="px-2 py-1">
                    <input
                      type="text"
                      value={row[col] ?? ''}
                      onChange={e => updateCell(rowIdx, col, e.target.value)}
                      className="w-full bg-transparent border border-transparent rounded px-1.5 py-1 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:bg-[var(--bg-nav-hover)] transition-colors min-w-[80px]"
                    />
                  </td>
                ))}
                <td className="px-2 py-1">
                  <button
                    onClick={() => removeRow(rowIdx)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                    title="Remove row"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-[var(--border)]">
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
        >
          <Plus size={13} /> Add Row
        </button>
      </div>

      <div className="px-4 pb-4 border-t border-[var(--border)]">
        <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mt-3 mb-1.5">
          User Notes
        </label>
        <textarea
          value={paper.notes ?? ''}
          onChange={e => updateNotes(e.target.value)}
          rows={3}
          placeholder="Enter any additional notes for this section here..."
          className="input-base text-xs resize-y w-full font-mono"
        />
      </div>
    </div>
  );
}

function TextSection({ paper, onChange }: Props) {
  return (
    <div className="glass-solid rounded-xl p-5">
      <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">{paper.title}</h4>
      <textarea
        value={paper.content}
        onChange={e => onChange({ ...paper, content: e.target.value })}
        rows={8}
        className="input-base font-mono text-xs resize-y w-full"
      />
    </div>
  );
}
