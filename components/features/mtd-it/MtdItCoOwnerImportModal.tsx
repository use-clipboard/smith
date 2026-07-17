'use client';

import { useEffect, useState } from 'react';
import { X, Users, Loader2, AlertTriangle, Check, ArrowRight } from 'lucide-react';

export interface ImportableSource {
  source_quarter_id:        string;
  source_quarter_status:    string;
  source_client_id:         string;
  source_client_name:       string;
  source_property_id:       string;
  target_property_id:       string;
  property_address:         string;
  property_type:            'uk' | 'foreign';
  clean_entry_count:        number;
  existing_count_on_target: number;
}

/** A co-owner link the import couldn't resolve into a source — usually the same
 *  property spelled differently on each client. Surfaced on the setup step so
 *  someone can fix the spelling, rather than silently offering nothing. */
export interface CoOwnerImportIssue {
  property_address: string;
  co_owner_name:    string;
  reason:           string;
}

interface Props {
  quarterId:    string;
  sources:      ImportableSource[];
  quarterLabel: string;
  taxYearLabel: string;
  onClose: () => void;
  /** Called after a successful import — parent kicks off an entries refresh. */
  onImported?: (summary: { inserted: number; replaced: number }) => void;
}

type Mode = 'append' | 'replace' | 'skip';

// Per-property row in the lightbox: pick mode (skip / append / replace).
// Default mode: append when the target has no entries; append when the
// target already has entries (safest) — but the user can flip to replace.
export default function MtdItCoOwnerImportModal({ quarterId, sources, quarterLabel, taxYearLabel, onClose, onImported }: Props) {
  // Per-source mode; key = source_quarter_id + source_property_id (unique enough)
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done,  setDone]  = useState<{ inserted: number; replaced: number } | null>(null);

  useEffect(() => {
    // Default everything to "append" (safer than replace).
    const init: Record<string, Mode> = {};
    for (const s of sources) init[keyFor(s)] = 'append';
    setModes(init);
  }, [sources]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  function keyFor(s: ImportableSource) { return `${s.source_quarter_id}|${s.source_property_id}`; }

  const totalSelected   = sources.reduce((a, s) => a + (modes[keyFor(s)] !== 'skip' ? 1 : 0), 0);
  const totalIncoming   = sources.reduce((a, s) => a + (modes[keyFor(s)] !== 'skip' ? s.clean_entry_count : 0), 0);
  const totalReplacing  = sources.reduce((a, s) => a + (modes[keyFor(s)] === 'replace' ? s.existing_count_on_target : 0), 0);

  async function run() {
    setBusy(true); setError(null);
    try {
      const imports = sources
        .filter(s => modes[keyFor(s)] !== 'skip')
        .map(s => ({
          source_quarter_id:  s.source_quarter_id,
          source_property_id: s.source_property_id,
          target_property_id: s.target_property_id,
          mode:               modes[keyFor(s)] as Exclude<Mode, 'skip'>,
        }));
      if (imports.length === 0) { setError('Nothing selected to import.'); setBusy(false); return; }
      const res = await fetch(`/api/mtd-it/quarters/${quarterId}/co-owner-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imports }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Import failed');
      setDone({ inserted: j.inserted ?? 0, replaced: j.replaced ?? 0 });
      onImported?.({ inserted: j.inserted ?? 0, replaced: j.replaced ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={!busy ? onClose : undefined}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center shrink-0">
            <Users size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Import from co-owners</h3>
            <p className="text-xs text-gray-500">
              {sources.length} property linkup{sources.length !== 1 ? 's' : ''} found with clean entries for {quarterLabel} {taxYearLabel}.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-50">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          {done ? (
            <div className="text-center py-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                <Check size={22} className="text-emerald-600" />
              </div>
              <p className="font-semibold text-gray-900 mb-1">Import complete</p>
              <p className="text-xs text-gray-600">
                {done.inserted} entr{done.inserted !== 1 ? 'ies' : 'y'} added
                {done.replaced > 0 && <> · {done.replaced} replaced</>}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-600 leading-relaxed">
                Each row brings the source client&apos;s <strong>clean</strong> entries onto this quarter, attached to your matching property. Your ownership %% is applied — you don&apos;t need to scale anything manually. Drive links carry across so you can still jump to the source invoice.
              </p>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[10px] uppercase text-gray-500 font-semibold tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-left">Property</th>
                      <th className="px-3 py-2 text-left">From</th>
                      <th className="px-3 py-2 text-right">Source</th>
                      <th className="px-3 py-2 text-right">You have</th>
                      <th className="px-3 py-2 text-right">Mode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sources.map(s => {
                      const k = keyFor(s);
                      const mode = modes[k] ?? 'append';
                      return (
                        <tr key={k}>
                          <td className="px-3 py-2.5">
                            <div className="text-sm text-gray-900 truncate max-w-[220px]">{s.property_address}</div>
                            <div className="text-[10px] text-gray-500 uppercase tracking-wide">{s.property_type === 'uk' ? 'UK Rental' : 'Foreign Rental'}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-sm text-gray-900 truncate max-w-[140px]">{s.source_client_name}</div>
                            <div className="text-[10px] text-gray-500 uppercase tracking-wide">{s.source_quarter_status}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-sm text-gray-700">{s.clean_entry_count}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-sm text-gray-500">{s.existing_count_on_target}</td>
                          <td className="px-3 py-2.5 text-right">
                            <select
                              value={mode}
                              onChange={e => setModes(prev => ({ ...prev, [k]: e.target.value as Mode }))}
                              className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white"
                              disabled={busy}
                            >
                              <option value="append">Append</option>
                              {s.existing_count_on_target > 0 && <option value="replace">Replace mine</option>}
                              <option value="skip">Skip</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="text-[11px] text-gray-500 leading-relaxed">
                <strong>{totalIncoming}</strong> entr{totalIncoming !== 1 ? 'ies' : 'y'} will be imported across <strong>{totalSelected}</strong> propert{totalSelected !== 1 ? 'ies' : 'y'}
                {totalReplacing > 0 && <>, replacing <strong>{totalReplacing}</strong> existing entr{totalReplacing !== 1 ? 'ies' : 'y'}</>}.
              </div>

              {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          {done ? (
            <button onClick={onClose} className="px-3 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90">Done</button>
          ) : (
            <>
              <button onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">Skip all</button>
              <button onClick={() => void run()} disabled={busy || totalSelected === 0} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />} Import {totalIncoming > 0 ? `${totalIncoming} entr${totalIncoming !== 1 ? 'ies' : 'y'}` : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
