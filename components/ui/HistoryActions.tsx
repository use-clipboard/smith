'use client';

import { useState } from 'react';
import { FileDown, ScrollText } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import AuditHistoryModal from '@/components/audit/AuditHistoryModal';

/**
 * Shared top-right actions pill for a tool's history dashboard: an Export-to-CSV
 * button, and (admin-only) an Audit-history button. One integration point per
 * tool.
 *
 * Pass `audit` to enable the audit trail: the export is logged as an "exported"
 * event, and admins get an Audit-history button that opens the shared viewer.
 */
export default function HistoryActions({
  onExport,
  exportDisabled = false,
  audit,
  exportLabel = 'Export this list to CSV / Sheets',
}: {
  onExport: () => void;
  exportDisabled?: boolean;
  audit?: { tool: string; isAdmin: boolean; title?: string };
  exportLabel?: string;
}) {
  const [auditOpen, setAuditOpen] = useState(false);
  const showAudit = !!audit?.isAdmin;

  const handleExport = () => {
    onExport();
    // Best-effort audit log of the export (any firm member; admins can view it).
    if (audit?.tool) {
      fetch('/api/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: audit.tool, action: 'exported', summary: 'Exported the list to CSV' }),
      }).catch(() => { /* non-critical */ });
    }
  };

  return (
    <>
      <div className="inline-flex h-9 items-center rounded-full border border-[var(--border)] bg-white px-1">
        <Tooltip label={exportLabel}>
          <button
            onClick={handleExport}
            disabled={exportDisabled}
            aria-label="Export list to CSV"
            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <FileDown size={15} />
          </button>
        </Tooltip>
        {showAudit && (
          <>
            <div className="mx-0.5 h-5 w-px bg-[var(--border)]" />
            <Tooltip label="Audit history (admin)">
              <button
                onClick={() => setAuditOpen(true)}
                aria-label="Audit history"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]"
              >
                <ScrollText size={15} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
      {showAudit && auditOpen && audit && (
        <AuditHistoryModal tool={audit.tool} title={audit.title} onClose={() => setAuditOpen(false)} />
      )}
    </>
  );
}
