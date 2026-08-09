'use client';

import { useRef, useState } from 'react';
import { ScanText, UploadCloud, Loader2, X, Sparkles, FileText } from 'lucide-react';
import { StudioCard } from './primitives';
import { encodeFile, fetchExtraction, type Sa100Extraction } from './extract';
import ScanReview from './ScanReview';
import type { TaxReturn } from './types';

export default function DocumentExtract({ ret, patch }: { ret: TaxReturn; patch: (u: (r: TaxReturn) => TaxReturn) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [scanning, setScanning] = useState(false);
  const [extraction, setExtraction] = useState<Sa100Extraction | null>(null);
  // A unique id per scan, so importing it adds a new batch rather than
  // overwriting an earlier scan's rows (re-importing the same scan is idempotent).
  const [batchId, setBatchId] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles(prev => [...prev, ...Array.from(list)].slice(0, 12));
    setExtraction(null); setError('');
  }

  async function scan() {
    if (files.length === 0) return;
    setScanning(true); setError(''); setExtraction(null);
    try {
      const encoded = await Promise.all(files.map(encodeFile));
      const result = await fetchExtraction(ret.taxYear, encoded);
      setBatchId(`${Date.now()}-${Math.floor(Math.random() * 1e4)}`);
      setExtraction(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the documents.');
    } finally {
      setScanning(false);
    }
  }

  function reset() { setExtraction(null); setFiles([]); }

  return (
    <StudioCard className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><ScanText size={18} /></div>
        <div>
          <p className="text-[13.5px] font-bold text-[var(--text-primary)]">Extract from documents</p>
          <p className="text-[11.5px] text-[var(--text-muted)]">Upload P60s, P11Ds, dividend vouchers, interest certificates — SMITH reads them, then you review.</p>
        </div>
      </div>

      <div className="px-5 py-4">
        {/* Dropzone */}
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-[var(--accent)] bg-[var(--accent)]/[0.05]' : 'border-[var(--border)] hover:border-[var(--accent)]/40'}`}
        >
          <UploadCloud size={22} className="text-[var(--accent)]" />
          <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Drop documents here or click to browse</p>
          <p className="text-[11px] text-[var(--text-muted)]">PDF, image, or CSV · up to 12 files</p>
          <input ref={inputRef} type="file" multiple accept=".pdf,image/*,.csv,.txt" className="hidden" onChange={e => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }} />
        </label>

        {/* Staged files */}
        {files.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-1 text-[11.5px] text-[var(--text-secondary)]">
                <FileText size={12} className="text-[var(--text-muted)]" /> <span className="max-w-[160px] truncate">{f.name}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-[var(--text-muted)] hover:text-rose-500"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div className="mt-3 flex justify-end">
            <button onClick={scan} disabled={scanning} className="btn-primary disabled:opacity-50">
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {scanning ? 'Reading documents…' : `Scan ${files.length} document${files.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}
        {!files.length && !error && <p className="mt-3 text-[11px] text-[var(--text-muted)]">After scanning you’ll get a review screen — check what SMITH found, edit any figure or where it goes, then import.</p>}
      </div>

      {extraction && <ScanReview ret={ret} patch={patch} extraction={extraction} batchId={batchId} onClose={reset} />}
    </StudioCard>
  );
}
