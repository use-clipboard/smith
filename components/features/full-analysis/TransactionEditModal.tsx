'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Flag, CheckCircle, FileText, AlertTriangle, ExternalLink } from 'lucide-react';
import type {
  Transaction, FlaggedEntry, TargetSoftware,
  VTTransaction, CapiumTransaction, XeroTransaction,
  QuickBooksTransaction, FreeAgentTransaction, SageTransaction, GeneralTransaction,
} from '@/types';

// ─── Field configuration ──────────────────────────────────────────────────────

type FieldType = 'text' | 'number' | 'date' | 'select' | 'textarea';
interface FieldConfig { key: string; label: string; type: FieldType; options?: string[] }

const SOFTWARE_FIELDS: Record<TargetSoftware, FieldConfig[]> = {
  vt: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'type', label: 'Type', type: 'select', options: ['PIN', 'SIN', 'PAY', 'REC', 'PCR'] },
    { key: 'primaryAccount', label: 'Supplier / Customer', type: 'text' },
    { key: 'details', label: 'Details', type: 'text' },
    { key: 'total', label: 'Gross Total (£)', type: 'number' },
    { key: 'vat', label: 'VAT (£)', type: 'number' },
    { key: 'analysis', label: 'Net (£)', type: 'number' },
    { key: 'analysisAccount', label: 'Analysis Account', type: 'text' },
    { key: 'transactionNotes', label: 'Notes', type: 'textarea' },
  ],
  capium: [
    { key: 'invoicedate', label: 'Invoice Date', type: 'date' },
    { key: 'contactname', label: 'Contact Name', type: 'text' },
    { key: 'contacttype', label: 'Contact Type', type: 'select', options: ['Supplier', 'Customer'] },
    { key: 'reference', label: 'Reference', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'accountname', label: 'Account Name', type: 'text' },
    { key: 'accountcode', label: 'Account Code', type: 'text' },
    { key: 'amount', label: 'Gross Amount (£)', type: 'number' },
    { key: 'vatamount', label: 'VAT Amount (£)', type: 'number' },
    { key: 'netAmount', label: 'Net Amount (£)', type: 'number' },
  ],
  xero: [
    { key: 'invoiceDate', label: 'Invoice Date', type: 'date' },
    { key: 'dueDate', label: 'Due Date', type: 'date' },
    { key: 'contactName', label: 'Contact Name', type: 'text' },
    { key: 'invoiceNumber', label: 'Invoice Number', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'unitAmount', label: 'Net Amount (£)', type: 'number' },
    { key: 'grossAmount', label: 'Gross Amount (£)', type: 'number' },
    { key: 'accountCode', label: 'Account Code', type: 'text' },
    { key: 'accountName', label: 'Account Name', type: 'text' },
    { key: 'taxType', label: 'Tax Type', type: 'select', options: ['20% (VAT on Expenses)', '5% (VAT on Expenses)', 'Zero Rated Expenses', 'Exempt Expenses', 'No VAT'] },
  ],
  quickbooks: [
    { key: 'invoiceDate', label: 'Invoice Date', type: 'date' },
    { key: 'dueDate', label: 'Due Date', type: 'date' },
    { key: 'supplier', label: 'Supplier', type: 'text' },
    { key: 'invoiceNo', label: 'Invoice Number', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'unitAmount', label: 'Net Amount (£)', type: 'number' },
    { key: 'vatAmount', label: 'VAT (£)', type: 'number' },
    { key: 'grossAmount', label: 'Gross Amount (£)', type: 'number' },
    { key: 'taxCode', label: 'Tax Code', type: 'select', options: ['20% (VAT on Purchases)', '5% (VAT on Purchases)', 'Zero Rated (Purchases)', 'Exempt (Purchases)', 'No VAT'] },
    { key: 'accountCode', label: 'Account Code', type: 'text' },
    { key: 'accountName', label: 'Account Name', type: 'text' },
  ],
  freeagent: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'amount', label: 'Amount (£ — negative = money out)', type: 'number' },
    { key: 'description', label: 'Description', type: 'text' },
  ],
  sage: [
    { key: 'DATE', label: 'Date (DD/MM/YYYY)', type: 'text' },
    { key: 'TYPE', label: 'Type', type: 'select', options: ['PI', 'SI', 'PC', 'SC', 'BP', 'BR'] },
    { key: 'ACCOUNT_REF', label: 'Account Ref', type: 'text' },
    { key: 'NOMINAL_CODE', label: 'Nominal Code', type: 'text' },
    { key: 'REFERENCE', label: 'Reference', type: 'text' },
    { key: 'DETAILS', label: 'Details', type: 'text' },
    { key: 'NET_AMOUNT', label: 'Net Amount (£)', type: 'number' },
    { key: 'TAX_CODE', label: 'Tax Code', type: 'select', options: ['T0', 'T1', 'T5', 'T9'] },
    { key: 'TAX_AMOUNT', label: 'Tax Amount (£)', type: 'number' },
  ],
  general: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'supplier', label: 'Supplier / Customer', type: 'text' },
    { key: 'invoiceNumber', label: 'Invoice Number', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'netAmount', label: 'Net Amount (£)', type: 'number' },
    { key: 'vatAmount', label: 'VAT (£)', type: 'number' },
    { key: 'grossAmount', label: 'Gross Amount (£)', type: 'number' },
    { key: 'currency', label: 'Currency', type: 'text' },
    { key: 'documentType', label: 'Document Type', type: 'select', options: ['Purchase Invoice', 'Sales Invoice', 'Credit Note', 'Receipt', 'Bank Statement'] },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function txToFormValues(tx: Transaction, software: TargetSoftware): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of SOFTWARE_FIELDS[software]) {
    const v = (tx as unknown as Record<string, unknown>)[f.key];
    result[f.key] = v !== undefined && v !== null ? String(v) : '';
  }
  return result;
}

function formValuesToTx(
  values: Record<string, string>,
  base: Transaction,
  software: TargetSoftware,
): Transaction {
  const result = { ...base } as unknown as Record<string, unknown>;
  for (const f of SOFTWARE_FIELDS[software]) {
    const v = values[f.key] ?? '';
    result[f.key] = f.type === 'number' ? (parseFloat(v) || 0) : v;
  }
  return result as unknown as Transaction;
}

/** Create a best-effort minimal transaction from a flagged entry so it can be promoted to valid. */
function buildMinimalTx(entry: FlaggedEntry, values: Record<string, string>, software: TargetSoftware): Transaction {
  const base = {
    fileName: entry.fileName,
    pageNumber: entry.pageNumber ?? 1,
  };
  const amt = parseFloat(values.amount ?? String(entry.amount ?? 0)) || 0;
  const date = values.date || entry.date || '';
  const desc = values.description || entry.description || '';
  const supplier = values.supplier || entry.supplier || '';
  switch (software) {
    case 'vt': return { ...base, type: 'PIN', refNo: '[auto]', date, primaryAccount: supplier, details: desc, total: amt, vat: 0, analysis: amt, analysisAccount: '', entryDetails: '', transactionNotes: '' } as VTTransaction;
    case 'capium': return { ...base, contactname: supplier, contacttype: 'Supplier', reference: '', description: desc, accountname: '', accountcode: '', invoicedate: date, vatname: '', vatamount: 0, isvatincluded: 'Yes', amount: amt, netAmount: amt } as CapiumTransaction;
    case 'xero': return { ...base, contactName: supplier, invoiceNumber: '', invoiceDate: date, dueDate: '', description: desc, quantity: 1, unitAmount: amt, grossAmount: amt, accountCode: '', accountName: '', taxType: 'No VAT' } as XeroTransaction;
    case 'quickbooks': return { ...base, supplier, invoiceNo: '', invoiceDate: date, dueDate: '', description: desc, quantity: 1, unitAmount: amt, vatAmount: 0, grossAmount: amt, taxCode: 'No VAT', accountCode: '', accountName: '' } as QuickBooksTransaction;
    case 'freeagent': return { ...base, date, amount: -amt, description: desc } as FreeAgentTransaction;
    case 'sage': return { ...base, TYPE: 'PI', ACCOUNT_REF: '', NOMINAL_CODE: '', DATE: date, REFERENCE: '', DETAILS: desc, NET_AMOUNT: amt, TAX_CODE: 'T9', TAX_AMOUNT: 0, EXCHANGE_RATE: 1 } as SageTransaction;
    case 'general': return { ...base, date, supplier, invoiceNumber: '', description: desc, netAmount: amt, vatAmount: 0, grossAmount: amt, currency: 'GBP', documentType: 'Purchase Invoice', category: '', notes: '' } as GeneralTransaction;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface TransactionEditModalProps {
  item: Transaction | FlaggedEntry;
  isFlagged: boolean;
  targetSoftware: TargetSoftware;
  documentFiles: File[];
  onSaveTransaction: (updated: Transaction) => void;
  onSaveFlagged: (updated: FlaggedEntry) => void;
  onFlagTransaction: (tx: Transaction, reason: string) => void;
  onUnflag: (entry: FlaggedEntry, tx: Transaction) => void;
  onClose: () => void;
}

export default function TransactionEditModal({
  item, isFlagged, targetSoftware, documentFiles,
  onSaveTransaction, onSaveFlagged, onFlagTransaction, onUnflag, onClose,
}: TransactionEditModalProps) {
  const entry = isFlagged ? (item as FlaggedEntry) : null;
  const txBase = isFlagged
    ? (entry!.transactionData ?? null)
    : (item as Transaction);

  // Form values — initialised from transaction fields if available
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    if (txBase) return txToFormValues(txBase, targetSoftware);
    // Flagged entry with no transactionData — minimal pre-fill
    const e = item as FlaggedEntry;
    return {
      date: e.date ?? '',
      supplier: e.supplier ?? '',
      amount: String(e.amount ?? 0),
      description: e.description ?? '',
    };
  });

  const [flagReason, setFlagReason] = useState('');
  const [showFlagInput, setShowFlagInput] = useState(false);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docMime, setDocMime] = useState<string>('');
  const flagInputRef = useRef<HTMLTextAreaElement>(null);

  // Build an objectURL for the source document
  useEffect(() => {
    const fileName = item.fileName;
    const file = documentFiles.find(f => f.name === fileName);
    if (!file) return;
    const url = URL.createObjectURL(file);
    setDocUrl(url);
    setDocMime(file.type || 'application/pdf');
    return () => URL.revokeObjectURL(url);
  }, [item.fileName, documentFiles]);

  useEffect(() => {
    if (showFlagInput) flagInputRef.current?.focus();
  }, [showFlagInput]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const setField = (key: string, value: string) =>
    setFormValues(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    if (isFlagged) {
      const updated: FlaggedEntry = { ...(item as FlaggedEntry) };
      if (txBase) {
        updated.transactionData = formValuesToTx(formValues, txBase, targetSoftware);
      }
      onSaveFlagged(updated);
    } else {
      onSaveTransaction(formValuesToTx(formValues, item as Transaction, targetSoftware));
    }
    onClose();
  };

  const handleMarkAsValid = () => {
    const e = item as FlaggedEntry;
    const tx = txBase
      ? formValuesToTx(formValues, txBase, targetSoftware)
      : buildMinimalTx(e, formValues, targetSoftware);
    onUnflag(e, tx);
    onClose();
  };

  const handleConfirmFlag = () => {
    if (!flagReason.trim()) return;
    onFlagTransaction(item as Transaction, flagReason.trim());
    onClose();
  };

  const fields = SOFTWARE_FIELDS[targetSoftware];
  const hasDoc = !!docUrl;
  const hasTransactionData = isFlagged ? !!txBase : true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg-card-solid)] rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden border border-[var(--border)]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {isFlagged
              ? <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-lg"><AlertTriangle size={12} />Flagged Entry</span>
              : <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-lg"><CheckCircle size={12} />Valid Transaction</span>
            }
            <span className="text-sm text-[var(--text-muted)] truncate">{item.fileName}</span>
            {item.pageNumber && <span className="text-xs text-[var(--text-muted)] shrink-0">p.{item.pageNumber}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isFlagged
              ? <button onClick={handleMarkAsValid} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                  <CheckCircle size={13} /> Mark as Valid
                </button>
              : !showFlagInput && (
                <button onClick={() => setShowFlagInput(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors">
                  <Flag size={13} /> Flag this
                </button>
              )
            }
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Flag reason input (inline, below header) */}
        {showFlagInput && (
          <div className="px-5 py-3 border-b border-[var(--border)] bg-amber-50 dark:bg-amber-900/10 shrink-0">
            <p className="text-xs font-semibold text-amber-700 mb-2">Reason for flagging:</p>
            <div className="flex gap-2">
              <textarea
                ref={flagInputRef}
                value={flagReason}
                onChange={e => setFlagReason(e.target.value)}
                rows={2}
                placeholder="e.g. Duplicate invoice, wrong period, personal expense…"
                className="input-base text-xs flex-1 resize-none"
              />
              <div className="flex flex-col gap-1.5">
                <button onClick={handleConfirmFlag} disabled={!flagReason.trim()} className="btn-primary text-xs px-3 py-1.5">Confirm</button>
                <button onClick={() => { setShowFlagInput(false); setFlagReason(''); }} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Flagged reason display (when viewing a flagged entry) */}
        {isFlagged && entry && (
          <div className="px-5 py-2.5 border-b border-[var(--border)] bg-amber-50 dark:bg-amber-900/10 shrink-0">
            <p className="text-xs text-amber-700 dark:text-amber-400"><span className="font-semibold">Flag reason: </span>{entry.reason}</p>
            {entry.duplicateOf && <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">Duplicate of: {entry.duplicateOf}</p>}
          </div>
        )}

        {/* Body: doc preview + form */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Document preview */}
          <div className="w-2/5 border-r border-[var(--border)] flex flex-col bg-[var(--bg-page)] shrink-0">
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Source Document</span>
              {hasDoc && (
                <a href={docUrl!} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
                  <ExternalLink size={11} /> Open
                </a>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              {hasDoc && docMime.startsWith('image/') && (
                <img src={docUrl!} alt="Source document" className="w-full h-full object-contain p-2" />
              )}
              {hasDoc && !docMime.startsWith('image/') && (
                // embed works more reliably than iframe for PDFs in Chromium-based browsers
                <embed src={docUrl!} type="application/pdf" className="w-full h-full" />
              )}
              {!hasDoc && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
                  <FileText size={36} className="opacity-30" />
                  <p className="text-sm">Document preview unavailable</p>
                  <p className="text-xs opacity-60">{item.fileName}</p>
                </div>
              )}
            </div>
          </div>

          {/* Edit form */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] shrink-0">
              <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                {isFlagged && !hasTransactionData ? 'Entry Details' : `${targetSoftware.toUpperCase()} Fields`}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {hasTransactionData ? (
                <div className="grid grid-cols-2 gap-3">
                  {fields.map(field => (
                    <div key={field.key} className={field.type === 'textarea' ? 'col-span-2' : ''}>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{field.label}</label>
                      {field.type === 'select' ? (
                        <select
                          value={formValues[field.key] ?? ''}
                          onChange={e => setField(field.key, e.target.value)}
                          className="input-base text-sm w-full"
                        >
                          {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : field.type === 'textarea' ? (
                        <textarea
                          value={formValues[field.key] ?? ''}
                          onChange={e => setField(field.key, e.target.value)}
                          rows={3}
                          className="input-base text-sm w-full resize-none"
                        />
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          step={field.type === 'number' ? '0.01' : undefined}
                          value={formValues[field.key] ?? ''}
                          onChange={e => setField(field.key, e.target.value)}
                          className="input-base text-sm w-full"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* Flagged entry with no transactionData — minimal fields */
                <div className="space-y-3">
                  <p className="text-xs text-[var(--text-muted)] bg-[var(--bg-nav-hover)] rounded-lg p-3">
                    This entry was flagged by AI without full transaction data. You can fill in the details below to promote it to a valid transaction.
                  </p>
                  {[
                    { key: 'date', label: 'Date', type: 'date' as FieldType },
                    { key: 'supplier', label: 'Supplier', type: 'text' as FieldType },
                    { key: 'amount', label: 'Amount (£)', type: 'number' as FieldType },
                    { key: 'description', label: 'Description', type: 'text' as FieldType },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{field.label}</label>
                      <input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        step={field.type === 'number' ? '0.01' : undefined}
                        value={formValues[field.key] ?? ''}
                        onChange={e => setField(field.key, e.target.value)}
                        className="input-base text-sm w-full"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="px-4 py-3.5 border-t border-[var(--border)] flex justify-end gap-2 shrink-0">
              <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleSave} className="btn-primary text-sm">Save Changes</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
