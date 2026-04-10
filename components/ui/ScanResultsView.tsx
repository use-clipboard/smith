'use client';

import { CheckCircle2, XCircle, RotateCcw, ArrowRight, ExternalLink, FileWarning } from 'lucide-react';
import type { DocumentScanResult } from '@/types';

interface ScanResultsViewProps {
  results: DocumentScanResult[];
  fileRefs: Map<string, File>;
  isRescanning: boolean;
  onRescan: () => void;
  onDismissAndContinue: () => void;
}

function friendlyError(result: DocumentScanResult): string {
  if (!result.errorMessage) return 'Unknown error during scanning.';
  const msg = result.errorMessage.toLowerCase();
  const code = result.errorCode ?? '';

  if (code === 'FILES_TOO_LARGE' || msg.includes('too large') || msg.includes('context'))
    return 'File is too large to process. Try compressing it or splitting into smaller pages.';
  if (code === 'FILE_UNREADABLE' || msg.includes('could not be read') || msg.includes('password') || msg.includes('corrupt'))
    return 'File could not be parsed — it may be corrupted, password-protected, or in an unsupported format.';
  if (code === 'RATE_LIMIT' || msg.includes('rate_limit') || msg.includes('429'))
    return 'AI service was busy during this scan. Re-scanning may resolve this.';
  if (code === 'AI_OVERLOADED' || msg.includes('overloaded'))
    return 'AI service was temporarily overloaded. Re-scanning may resolve this.';
  if (code === 'PARSE_ERROR' || msg.includes('json') || msg.includes('parse'))
    return 'AI returned an unreadable response — the document may be unusually complex.';
  if (msg.includes('timeout') || msg.includes('abort'))
    return 'Timeout during processing — the document took too long to scan.';
  if (msg.includes('unsupported') || msg.includes('format'))
    return 'Unsupported file format.';

  return result.errorMessage;
}

function openFilePreview(file: File) {
  const url = URL.createObjectURL(file);
  window.open(url, '_blank', 'noopener,noreferrer');
  // Revoke after a short delay to allow the tab to open
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ScanResultsView({
  results,
  fileRefs,
  isRescanning,
  onRescan,
  onDismissAndContinue,
}: ScanResultsViewProps) {
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'failed');
  const total = results.length;
  const allFailed = failed.length === total;
  const allSucceeded = failed.length === 0;

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      {/* Summary header */}
      <div className={`rounded-2xl p-6 mb-6 border ${
        allFailed
          ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900'
          : allSucceeded
          ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900'
          : 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900'
      }`}>
        <div className="flex items-center gap-3">
          {allFailed ? (
            <XCircle size={28} className="text-red-500 shrink-0" />
          ) : allSucceeded ? (
            <CheckCircle2 size={28} className="text-emerald-500 shrink-0" />
          ) : (
            <FileWarning size={28} className="text-amber-500 shrink-0" />
          )}
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {allSucceeded
                ? `All ${total} documents scanned successfully`
                : allFailed
                ? `All ${total} documents failed to scan`
                : `${successful.length} of ${total} documents scanned successfully`}
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {allSucceeded
                ? 'Everything looks good — proceed to review your results.'
                : allFailed
                ? 'No documents could be scanned. Check the errors below, then try re-scanning.'
                : `${failed.length} document${failed.length > 1 ? 's' : ''} failed. You can re-scan them or proceed without them.`}
            </p>
          </div>
        </div>
      </div>

      {/* Successful scans */}
      {successful.length > 0 && (
        <section className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2 px-1">
            Successful ({successful.length})
          </h3>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
            {successful.map(r => (
              <div key={r.fileName} className="flex items-center gap-3 px-4 py-3 bg-[var(--surface)]">
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                <span className="text-sm text-[var(--text-primary)] truncate flex-1" title={r.fileName}>
                  {r.fileName}
                </span>
                <span className="text-xs text-[var(--text-muted)] shrink-0">
                  {(r.validTransactions?.length ?? 0)} transaction{(r.validTransactions?.length ?? 0) !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Failed scans */}
      {failed.length > 0 && (
        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2 px-1">
            Failed ({failed.length})
          </h3>
          <div className="rounded-xl border border-red-200 dark:border-red-900 overflow-hidden divide-y divide-red-100 dark:divide-red-900/50">
            {failed.map(r => {
              const fileRef = fileRefs.get(r.fileName);
              return (
                <div key={r.fileName} className="px-4 py-3 bg-red-50 dark:bg-red-950/10">
                  <div className="flex items-start gap-3">
                    <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate" title={r.fileName}>
                        {r.fileName}
                      </p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                        {friendlyError(r)}
                      </p>
                    </div>
                    {fileRef && (
                      <button
                        onClick={() => openFilePreview(fileRef)}
                        className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline shrink-0 mt-0.5"
                        title="Open this file in a new tab"
                      >
                        <ExternalLink size={12} />
                        View
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        {failed.length > 0 && (
          <button
            onClick={onRescan}
            disabled={isRescanning}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            <RotateCcw size={15} className={isRescanning ? 'animate-spin' : ''} />
            {isRescanning ? 'Re-scanning…' : `Re-scan ${failed.length} failed document${failed.length > 1 ? 's' : ''}`}
          </button>
        )}

        <button
          onClick={onDismissAndContinue}
          disabled={allFailed || isRescanning}
          className="btn-primary flex items-center justify-center gap-2 sm:ml-auto"
          title={allFailed ? 'No documents succeeded — nothing to continue with' : undefined}
        >
          {allSucceeded ? 'Continue to results' : 'Dismiss failed and continue'}
          <ArrowRight size={15} />
        </button>
      </div>

      {allFailed && (
        <p className="text-xs text-[var(--text-muted)] text-center mt-3">
          All documents failed — please re-scan or go back and check your files.
        </p>
      )}
    </div>
  );
}
