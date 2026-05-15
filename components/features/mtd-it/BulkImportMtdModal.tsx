'use client';

import { useState, useRef } from 'react';
import { X, Upload, Download, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

interface ImportResult {
  matched: string[];
  not_found: string[];
  added: number;
  already_on: number;
}

function parseRefs(csvText: string): string[] {
  // Accept any of: bare list of codes, one per line, or a CSV with a
  // 'client_ref' column header. We accept commas or newlines as separators.
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Detect header row: case-insensitive match for "client_ref"
  const firstCells = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const refColIdx = firstCells.findIndex(c => c.toLowerCase() === 'client_ref' || c.toLowerCase() === 'ref' || c.toLowerCase() === 'code');

  if (refColIdx >= 0) {
    // CSV with header — extract from that column
    return lines.slice(1).map(line => {
      const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      return cells[refColIdx] ?? '';
    }).filter(Boolean);
  }

  // No header — flatten every cell across the file
  const refs: string[] = [];
  for (const line of lines) {
    for (const cell of line.split(',')) {
      const v = cell.trim().replace(/^"|"$/g, '');
      if (v) refs.push(v);
    }
  }
  return refs;
}

function downloadTemplate() {
  const content = 'client_ref\nAC001\nJS002\nSP003\n';
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'mtd_it_client_codes_template.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function BulkImportMtdModal({ onClose, onImported }: Props) {
  const [refs, setRefs] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseRefs(String(reader.result ?? ''));
      setRefs(parsed);
      setResult(null);
      setError(null);
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (refs.length === 0) return;
    setImporting(true); setError(null);
    try {
      const res = await fetch('/api/mtd-it/clients/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_refs: refs }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Import failed');
      setResult(j as ImportResult);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Bulk-add MTD IT clients</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto">
          <p className="text-sm text-gray-600">
            Upload a CSV containing client codes. Each matching client in this firm will be marked as an MTD IT client.
          </p>

          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
          >
            <Download size={12} /> Download template
          </button>

          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full px-4 py-6 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-600 hover:border-[var(--accent)] hover:bg-[var(--accent-light)]/30 flex flex-col items-center gap-2"
            >
              <Upload size={20} className="text-gray-400" />
              {refs.length === 0 ? 'Click to select CSV file' : `${refs.length} code${refs.length === 1 ? '' : 's'} loaded — click to replace`}
            </button>
          </div>

          {refs.length > 0 && !result && (
            <div className="text-xs text-gray-500">
              First codes: {refs.slice(0, 5).join(', ')}{refs.length > 5 ? `, …` : ''}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} className="shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-green-800 bg-green-50 border border-green-100 px-3 py-2 rounded-lg">
                <CheckCircle2 size={14} className="shrink-0 mt-px" />
                <div>
                  <div className="font-semibold">Added {result.added} client{result.added === 1 ? '' : 's'} to MTD IT.</div>
                  {result.already_on > 0 && (
                    <div>{result.already_on} were already on the list.</div>
                  )}
                </div>
              </div>
              {result.not_found.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
                  <AlertTriangle size={14} className="shrink-0 mt-px" />
                  <div>
                    <div className="font-semibold">{result.not_found.length} code{result.not_found.length === 1 ? '' : 's'} not found:</div>
                    <div className="font-mono break-all">{result.not_found.join(', ')}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={runImport}
              disabled={refs.length === 0 || importing}
              className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {importing ? <Loader2 size={12} className="animate-spin" /> : null}
              Import {refs.length > 0 ? `(${refs.length})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
