'use client';

import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, ClipboardPaste } from 'lucide-react';
import type { SpreadsheetColumn, SpreadsheetColumnRole } from '@/types/campaigns';
import { slugifyKey, detectRole, isValidEmail, customTagsFor } from '@/lib/campaigns/spreadsheet';

const ROLE_LABELS: Record<SpreadsheetColumnRole, string> = {
  email: 'Email address', first_name: 'First name', full_name: 'Full name',
  business_name: 'Business name', reference: 'Client reference', custom: 'Custom field', ignore: 'Ignore',
};
const SINGULAR: SpreadsheetColumnRole[] = ['email', 'first_name', 'full_name', 'business_name', 'reference'];
const MAX_ROWS = 5000;

interface Props { onClose: () => void; onSaved: () => void }

export default function ImportAudienceModal({ onClose, onSaved }: Props) {
  const [columns, setColumns] = useState<SpreadsheetColumn[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [name, setName] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function ingestAoa(aoa: unknown[][], sourceName: string) {
    const headerRow = (aoa[0] ?? []).map(h => String(h ?? '').trim());
    if (headerRow.length === 0) { setError('Couldn’t find any columns.'); return; }
    const dataRows = aoa.slice(1).filter(r => r.some(c => String(c ?? '').trim() !== '')).slice(0, MAX_ROWS);

    const taken = new Set<string>();
    const usedRoles = new Set<SpreadsheetColumnRole>();
    const cols: SpreadsheetColumn[] = headerRow.map((h, i) => {
      const key = slugifyKey(h || `column_${i + 1}`, taken);
      const samples = dataRows.slice(0, 20).map(r => String(r[i] ?? ''));
      let role = detectRole(h, samples);
      // Keep only the first of each singular role; later duplicates become custom.
      if (SINGULAR.includes(role)) {
        if (usedRoles.has(role)) role = 'custom'; else usedRoles.add(role);
      }
      return { key, header: h || `Column ${i + 1}`, role };
    });
    const objs = dataRows.map(r => {
      const o: Record<string, string> = {};
      cols.forEach((c, i) => { o[c.key] = String(r[i] ?? '').trim(); });
      return o;
    });
    setColumns(cols);
    setRows(objs);
    setError(null);
    if (!name) setName(sourceName);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' });
      ingestAoa(aoa, file.name.replace(/\.[^.]+$/, ''));
    } catch {
      setError('Couldn’t read that file. Try a .csv or .xlsx export.');
    }
  }

  function onPaste() {
    if (!paste.trim()) return;
    try {
      const wb = XLSX.read(paste, { type: 'string' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' });
      ingestAoa(aoa, 'Pasted list');
    } catch {
      setError('Couldn’t parse the pasted data. Paste rows including a header line.');
    }
  }

  function setRole(key: string, role: SpreadsheetColumnRole) {
    setColumns(cols => {
      // Enforce single owner of each singular role.
      const next = cols.map(c => {
        if (c.key === key) return { ...c, role };
        if (SINGULAR.includes(role) && c.role === role) return { ...c, role: 'custom' as SpreadsheetColumnRole };
        return c;
      });
      return next;
    });
  }

  // Validation.
  const emailCol = columns.find(c => c.role === 'email');
  const seen = new Set<string>();
  let invalid = 0, blank = 0, dups = 0;
  for (const row of rows) {
    const e = emailCol ? (row[emailCol.key] ?? '').trim().toLowerCase() : '';
    if (!e) { blank++; continue; }
    if (!isValidEmail(e)) { invalid++; continue; }
    if (seen.has(e)) dups++; else seen.add(e);
  }
  const uniqueValid = seen.size;
  const customTags = customTagsFor(columns);
  const hasData = columns.length > 0 && rows.length > 0;

  async function save() {
    if (!name.trim()) { setError('Give the audience a name.'); return; }
    if (!emailCol) { setError('Map one column to “Email address”.'); return; }
    if (uniqueValid === 0) { setError('No valid email addresses found.'); return; }
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/campaigns/audiences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), source: 'spreadsheet', definition: { kind: 'spreadsheet', columns, rows } }),
      });
      if (!r.ok) { setError('Could not save the audience.'); return; }
      onSaved();
    } finally { setSaving(false); }
  }

  const inputCls = 'text-sm rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><FileSpreadsheet size={16} style={{ color: 'var(--accent)' }} /> Import a list</h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
          {!hasData ? (
            <>
              <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-[var(--border)] rounded-xl p-8 text-center hover:border-[var(--accent)] transition-colors">
                <Upload size={22} className="mx-auto mb-2 text-[var(--text-muted)]" />
                <div className="text-sm font-medium text-[var(--text-primary)]">Upload a CSV or Excel file</div>
                <div className="text-xs text-[var(--text-secondary)] mt-1">The first row should be your column headers.</div>
              </button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={onFile} className="hidden" />
              <div className="text-center text-xs text-[var(--text-muted)]">or</div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1 mb-1"><ClipboardPaste size={12} /> Paste rows (tab or comma separated, header first)</label>
                <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={4} className={`${inputCls} w-full font-mono text-[12px] resize-y`} placeholder={'Name\tEmail\tDeadline\nAcme Ltd\tsue@acme.co.uk\t31 Jul'} />
                <button onClick={onPaste} disabled={!paste.trim()} className="btn-secondary text-xs mt-2">Parse pasted data</button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)]">Audience name</label>
                <input value={name} onChange={e => setName(e.target.value)} className={`mt-1 ${inputCls} w-full`} />
              </div>

              {/* Validation summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Rows', String(rows.length), '#6B7280'],
                  ['Unique emails', String(uniqueValid), '#16A34A'],
                  ['Invalid', String(invalid), invalid ? '#DC2626' : '#6B7280'],
                  ['Duplicates', String(dups), dups ? '#B45309' : '#6B7280'],
                ].map(([label, val, tint]) => (
                  <div key={label} className="glass-solid rounded-xl border border-[var(--border)] p-2.5 text-center">
                    <div className="text-lg font-semibold" style={{ color: tint }}>{val}</div>
                    <div className="text-[11px] text-[var(--text-secondary)]">{label}</div>
                  </div>
                ))}
              </div>
              {blank > 0 && <div className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle size={12} /> {blank} row{blank === 1 ? '' : 's'} have no email and will be skipped.</div>}

              {/* Column mapping */}
              <div>
                <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Map your columns</div>
                <div className="rounded-xl border border-[var(--border)] divide-y divide-black/5">
                  {columns.map(c => (
                    <div key={c.key} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">{c.header}</div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">e.g. {rows[0]?.[c.key] || '—'}</div>
                      </div>
                      <select value={c.role} onChange={e => setRole(c.key, e.target.value as SpreadsheetColumnRole)} className={inputCls}>
                        {(Object.keys(ROLE_LABELS) as SpreadsheetColumnRole[]).map(role => (
                          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {customTags.length > 0 && (
                <div className="text-xs text-[var(--text-secondary)]">
                  Custom fields available as merge tags: {customTags.map(t => <code key={t} className="bg-black/5 px-1 rounded mr-1">{t}</code>)}
                </div>
              )}

              <button onClick={() => { setColumns([]); setRows([]); }} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline">Upload a different file</button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-black/5">
          <span className="text-xs text-red-600">{error}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            {hasData && (
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : <><CheckCircle2 size={15} /> Save audience</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
