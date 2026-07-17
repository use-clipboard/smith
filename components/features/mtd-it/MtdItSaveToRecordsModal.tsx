'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X, Save, Loader2, Check, AlertTriangle, FolderOpen, Archive,
  FileText, Mail, Files, Lock, Settings as SettingsIcon, FolderTree,
} from 'lucide-react';
import { useModules } from '@/components/ui/ModulesProvider';
import DriveFolderPicker from '@/components/ui/DriveFolderPicker';
import { buildPnL, fmtMoneyGbp } from '@/lib/mtdIt/pnl';
import { renderApprovalPdf, blobToBase64 } from '@/lib/mtdIt/approvalPdf';
import { fetchBrandPdfBundle } from '@/lib/mtdIt/fetchBrandPdfBundle';
import type { EditorEntry } from '@/lib/mtdIt/types';
import type { MtdItStream, MtdItStreams, MtdItProperty, MtdItTrade } from '@/types';

interface Props {
  quarterId:     string;
  clientId:      string;
  clientName:    string;
  clientRef:     string | null;
  taxYear:       number;
  taxYearLabel:  string;
  quarter:       1 | 2 | 3 | 4;
  quarterLabel:  string;
  rangeFrom:     string;
  rangeTo:       string;
  entries:       EditorEntry[];
  streams:       MtdItStreams;
  trades:        MtdItTrade[];
  properties:    MtdItProperty[];
  fxRates:       Record<string, number>;
  consolidated:  boolean;
  /** Count of source documents currently attached to the quarter — used so
   *  the user knows what's about to be uploaded. The modal still queries
   *  the API for the canonical count at save time. */
  sourceDocCount: number;
  /** True if at least one approval cycle has been sent. Drives whether the
   *  "Approval pack" checkbox shows up at all (no point saving a doc that
   *  doesn't reflect what the client actually saw). */
  hasSentApproval: boolean;
  /** True when this modal was opened by clicking "Save & complete" (as
   *  opposed to the manual toolbar button). Two things change in that
   *  case: a prominent warning banner appears if the firm has
   *  auto-delete-on-complete on, and source-doc cleanup fires when the
   *  modal closes. */
  triggeredByComplete?: boolean;
  /** Optional — called when a save completes successfully. Used by the
   *  review phase to refresh entries so newly-written drive_link values
   *  show up as the Drive icon on each row. */
  onSaved?: (summary: { drive_uploaded: number; vault_indexed: number; attempted: number; storage_wiped?: number }) => void;
  onClose: () => void;
}

type Phase = 'idle' | 'preparing' | 'uploading' | 'done' | 'error';

// Saves the quarter's deliverables (P&L PDF, approval pack PDF, source
// documents) to Google Drive and/or the Document Vault. The PDFs are
// generated client-side using the same renderer the email + download
// buttons use, then handed to the server as base64. Source documents
// are pulled by the server from supabase storage directly.
export default function MtdItSaveToRecordsModal(props: Props) {
  const {
    quarterId, clientId, clientName, clientRef, taxYear, taxYearLabel,
    quarter, quarterLabel, rangeFrom, rangeTo, entries, streams, trades,
    properties, fxRates, consolidated, sourceDocCount, hasSentApproval,
    triggeredByComplete, onSaved, onClose,
  } = props;

  const { isModuleActive } = useModules();
  const driveActive = isModuleActive('google-drive');
  const vaultActive = isModuleActive('document-vault');
  const neitherActive = !driveActive && !vaultActive;

  // What to save — defaults: P&L on, source docs on, approval if sent.
  const [savePnl,        setSavePnl]        = useState(true);
  const [saveApproval,   setSaveApproval]   = useState(hasSentApproval);
  const [saveSourceDocs, setSaveSourceDocs] = useState(sourceDocCount > 0);

  // Where to save — defaults: whichever module is on.
  const [toDrive, setToDrive] = useState(driveActive);
  const [toVault, setToVault] = useState(vaultActive);

  // Custom Drive folder. Null = use the default {root}/{client}/MTD IT/{today}
  // hierarchy. Setting a value here overrides the hierarchy entirely.
  const [customFolder, setCustomFolder] = useState<{ id: string; name: string; path: string } | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const [phase,   setPhase]   = useState<Phase>('idle');
  const [error,   setError]   = useState<string | null>(null);
  const [summary, setSummary] = useState<{ drive_uploaded: number; vault_indexed: number; attempted: number } | null>(null);

  // Whether the firm has the auto-delete-on-complete setting on. Fetched
  // once on mount. When the modal was opened by Save & complete AND this
  // is true, we show the warning banner and fire cleanup on close.
  const [autoDeleteOnComplete, setAutoDeleteOnComplete] = useState(false);
  useEffect(() => {
    void fetch('/api/mtd-it/firm-settings')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const s = j?.settings;
        if (s && typeof s.auto_delete_source_on_complete === 'boolean') {
          setAutoDeleteOnComplete(s.auto_delete_source_on_complete);
        }
      })
      .catch(() => {});
  }, []);

  // True when we'll wipe source docs on close. Drives both the warning
  // banner and the cleanup-on-close behaviour.
  const willCleanupOnClose = !!triggeredByComplete && autoDeleteOnComplete && sourceDocCount > 0;

  // Wraps the caller's onClose so we run the source-doc wipe before
  // handing back control. Failures are non-fatal — the modal still
  // closes either way.
  const handleClose = async () => {
    if (willCleanupOnClose) {
      try {
        await fetch(`/api/mtd-it/quarters/${quarterId}/cleanup-source`, { method: 'POST' });
      } catch (e) {
        console.warn('cleanup-source failed (non-fatal):', e);
      }
    }
    onClose();
  };

  // Close on Escape (only when not mid-save)
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && phase !== 'uploading' && phase !== 'preparing') void handleClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // handleClose is stable enough — we exclude it from deps to avoid re-binding the listener on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const nothingSelected   = !savePnl && !saveApproval && !saveSourceDocs;
  const noDestination     = !((toDrive && driveActive) || (toVault && vaultActive));
  const canSave           = !neitherActive && !nothingSelected && !noDestination;

  // Build the per-stream P&L data once. We need it whether we're saving
  // the P&L PDF or the approval pack (both consume the same struct).
  const pnls = useMemo(() => {
    const active: MtdItStream[] = (['sole','uk_rental','foreign_rental'] as const).filter(s => streams[s]);
    return active.map(s => buildPnL({
      stream: s,
      entries: entries.filter(e => e.stream === s),
      trades,
      properties,
      fxRates,
    }));
  }, [streams, entries, trades, properties, fxRates]);

  async function handleSave() {
    setPhase('preparing'); setError(null);
    try {
      const bundle = await fetchBrandPdfBundle({ clientId, taxYear });

      let pnlPdfBase64: string | undefined;
      let approvalPdfBase64: string | undefined;

      if (savePnl) {
        // Re-use the in-app P&L exporter but capture the bytes rather
        // than triggering a download. exportPnLPdf calls doc.save() which
        // downloads — so we replicate the cover/per-stream pipeline by
        // calling renderApprovalPdf with a "report" framing instead.
        // Practically: the approval renderer and the P&L renderer produce
        // visually identical content; we use approvalPdf here to share
        // the file generator path without duplicating logic. This avoids
        // forking the P&L exporter just for in-memory output.
        const blob = await renderApprovalPdf({
          pnls, clientName, clientRef, quarterLabel, taxYearLabel,
          rangeFrom, rangeTo, consolidated, entries,
          brandPrimaryColor: bundle.brandPrimaryColor,
          logoDataUrl:       bundle.logoDataUrl,
          pdfInclude:        bundle.pdfInclude,
          comparison:        bundle.comparison,
        });
        pnlPdfBase64 = await blobToBase64(blob);
      }

      if (saveApproval && hasSentApproval) {
        // Same content — but the file naming on the server differentiates
        // them so they land in Drive / Vault as two distinct documents.
        const blob = await renderApprovalPdf({
          pnls, clientName, clientRef, quarterLabel, taxYearLabel,
          rangeFrom, rangeTo, consolidated, entries,
          brandPrimaryColor: bundle.brandPrimaryColor,
          logoDataUrl:       bundle.logoDataUrl,
          pdfInclude:        bundle.pdfInclude,
          comparison:        bundle.comparison,
        });
        approvalPdfBase64 = await blobToBase64(blob);
      }

      setPhase('uploading');
      const res = await fetch(`/api/mtd-it/quarters/${quarterId}/save-to-records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pnl_pdf_base64:      pnlPdfBase64,
          approval_pdf_base64: approvalPdfBase64,
          include_source_docs: saveSourceDocs,
          destination_drive:   toDrive && driveActive,
          destination_vault:   toVault && vaultActive,
          client_code:         clientRef,
          drive_folder_id:     toDrive && driveActive ? customFolder?.id ?? null : null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Save failed');
      setSummary(j.summary);
      setPhase('done');
      onSaved?.(j.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setPhase('error');
    }
  }

  return (
    <>
    {folderPickerOpen && (
      <DriveFolderPicker
        onSelect={(folder, path) => {
          setCustomFolder({ id: folder.id, name: folder.name, path });
          setFolderPickerOpen(false);
        }}
        onClose={() => setFolderPickerOpen(false)}
      />
    )}
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={phase === 'idle' || phase === 'done' || phase === 'error' ? () => void handleClose() : undefined}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center">
            <Save size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Save to records</h3>
            <p className="text-xs text-gray-500 truncate">
              {clientName}{clientRef ? `  ·  ${clientRef}` : ''}  ·  {quarterLabel} {taxYearLabel}
            </p>
          </div>
          {phase !== 'preparing' && phase !== 'uploading' && (
            <button onClick={() => void handleClose()} aria-label="Close" className="p-1.5 rounded hover:bg-gray-100">
              <X size={16} className="text-gray-500" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Auto-delete warning — only when opened by Save & complete
              AND the firm has the setting on AND there are docs to lose. */}
          {willCleanupOnClose && phase !== 'done' && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
              <div className="leading-relaxed">
                <strong>Source documents will be deleted from SMITH after this step.</strong>
                <br />
                Tick <strong>Source documents</strong> below and pick a destination to keep a copy in Drive / Vault. You can change this in <a href="/settings?tab=mtd-it" className="underline font-medium">Settings → MTD IT</a>.
              </div>
            </div>
          )}

          {neitherActive ? (
            <div className="flex items-start gap-2 px-3 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <Lock size={14} className="shrink-0 mt-0.5" />
              <div>
                Neither the <strong>Google Drive</strong> nor <strong>Document Vault</strong> module is active for your firm. Ask your admin to enable at least one in{' '}
                <a href="/settings?tab=tiers" className="underline font-medium">Settings → Plan &amp; Tiers</a>.
              </div>
            </div>
          ) : phase === 'done' ? (
            <div className="text-center py-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                <Check size={22} className="text-emerald-600" />
              </div>
              <p className="font-semibold text-gray-900 mb-1">Saved to records</p>
              <p className="text-xs text-gray-600">
                {summary?.drive_uploaded ? <>{summary.drive_uploaded} file{summary.drive_uploaded !== 1 ? 's' : ''} on Google Drive</> : null}
                {summary?.drive_uploaded && summary?.vault_indexed ? '  ·  ' : ''}
                {summary?.vault_indexed ? <>{summary.vault_indexed} indexed in the Vault</> : null}
              </p>
            </div>
          ) : (
            <>
              {/* What to save */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">What to save</div>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  <SaveLine
                    icon={<FileText size={14} className="text-gray-500" />}
                    label="P&L report (PDF)"
                    hint="The same document you get from P&L View → Download"
                    checked={savePnl}
                    onChange={setSavePnl}
                  />
                  {hasSentApproval && (
                    <SaveLine
                      icon={<Mail size={14} className="text-gray-500" />}
                      label="Client approval pack (PDF)"
                      hint="The branded pack that's attached to the approval email"
                      checked={saveApproval}
                      onChange={setSaveApproval}
                    />
                  )}
                  <SaveLine
                    icon={<Files size={14} className="text-gray-500" />}
                    label={`Source documents (${sourceDocCount})`}
                    hint="Receipts, bank statements etc. uploaded to this quarter"
                    checked={saveSourceDocs}
                    onChange={setSaveSourceDocs}
                    disabled={sourceDocCount === 0}
                  />
                </div>
              </div>

              {/* Where to save */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Destination</div>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  <div>
                    <DestLine
                      icon={<FolderOpen size={14} className="text-gray-500" />}
                      label="Google Drive"
                      hint={
                        driveActive
                          ? customFolder
                              ? `Custom: ${customFolder.path}`
                              : `Default: SMITH Files / ${clientRef || '<client>'} / MTD IT / <today>`
                          : 'Module inactive — enable it in Settings → Modules'
                      }
                      checked={toDrive && driveActive}
                      onChange={setToDrive}
                      disabled={!driveActive}
                    />
                    {/* Folder picker row — only shown when Drive is the selected destination */}
                    {driveActive && toDrive && (
                      <div className="flex items-center gap-2 px-3 pb-2 pl-12 -mt-1">
                        <button
                          type="button"
                          onClick={() => setFolderPickerOpen(true)}
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
                        >
                          <FolderTree size={11} />
                          {customFolder ? 'Change folder' : 'Choose a different folder'}
                        </button>
                        {customFolder && (
                          <button
                            type="button"
                            onClick={() => setCustomFolder(null)}
                            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-red-600"
                          >
                            <X size={10} /> Reset to default
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <DestLine
                    icon={<Archive size={14} className="text-gray-500" />}
                    label="Document Vault"
                    hint={vaultActive ? 'Indexed against this client for search + audit' : 'Module inactive — enable it in Settings → Modules'}
                    checked={toVault && vaultActive}
                    onChange={setToVault}
                    disabled={!vaultActive}
                  />
                </div>
                {!driveActive && !vaultActive ? null : (
                  <a href="/settings?tab=tiers" className="inline-flex items-center gap-1.5 mt-2 text-[11px] text-gray-500 hover:text-[var(--accent)]">
                    <SettingsIcon size={11} /> Manage modules
                  </a>
                )}
              </div>

              {/* Validation hints */}
              {nothingSelected && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  Pick at least one thing to save above.
                </div>
              )}
              {!nothingSelected && noDestination && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  Pick at least one destination.
                </div>
              )}

              {/* P&L preview footer */}
              {pnls.length > 0 && (
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  Includes <strong>{pnls.length}</strong> stream{pnls.length !== 1 ? 's' : ''} ·{' '}
                  <span className="text-green-700">{fmtMoneyGbp(pnls.reduce((a, p) => a + p.income.total, 0))} income</span> ·{' '}
                  <span className="text-red-700">{fmtMoneyGbp(pnls.reduce((a, p) => a + p.expense.total, 0))} expense</span>
                </div>
              )}

              {phase === 'error' && error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2">
          {phase === 'done' ? (
            <button onClick={() => void handleClose()} className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90">
              Done
            </button>
          ) : (
            <>
              <button
                onClick={() => void handleClose()}
                disabled={phase === 'uploading' || phase === 'preparing'}
                className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >Cancel</button>
              <button
                onClick={handleSave}
                disabled={!canSave || phase === 'uploading' || phase === 'preparing'}
                className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {phase === 'preparing' ? <><Loader2 size={14} className="animate-spin" /> Generating…</> :
                 phase === 'uploading' ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> :
                                         <><Save size={14} /> Save</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function SaveLine({ icon, label, hint, checked, onChange, disabled }: { icon: React.ReactNode; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 px-3 py-2.5 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
      <input
        type="checkbox"
        checked={checked && !disabled}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 accent-[var(--accent)] w-3.5 h-3.5"
      />
      <div className="shrink-0 mt-px">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900">{label}</div>
        <div className="text-[11px] text-gray-500">{hint}</div>
      </div>
    </label>
  );
}

function DestLine({ icon, label, hint, checked, onChange, disabled }: { icon: React.ReactNode; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 px-3 py-2.5 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 accent-[var(--accent)] w-3.5 h-3.5"
      />
      <div className="shrink-0 mt-px">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 flex items-center gap-1.5">
          {label}
          {disabled && <Lock size={10} className="text-gray-400" />}
        </div>
        <div className="text-[11px] text-gray-500">{hint}</div>
      </div>
    </label>
  );
}

