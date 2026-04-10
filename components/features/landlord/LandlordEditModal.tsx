'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Flag, CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import type { LandlordIncomeTransaction, LandlordExpenseTransaction } from '@/types';

// ─── Internal row types (re-exported for page use) ────────────────────────────

export type IncomeRow = LandlordIncomeTransaction & {
  _id: string;
  _flagged: boolean;
  _flagReason?: string;
  _inRange: boolean;
};

export type ExpenseRow = LandlordExpenseTransaction & {
  _id: string;
  _flagged: boolean;
  _flagReason?: string;
  _inRange: boolean;
};

// ─── Expense category options ─────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  'Rent, rates, insurance',
  'Property repairs and maintenance',
  'Finance charges and bank charges',
  'Legal, management and other professional fees',
  'Advertising for tenants',
  'Wages and salaries',
  'Accountancy fees',
  'Travel costs',
  'Utilities',
  'Cleaning and gardening',
  'Other allowable expenses',
  'Capital expenditure',
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  rowType: 'income' | 'expense';
  item: IncomeRow | ExpenseRow;
  documentFiles: File[];
  onSave: (updated: IncomeRow | ExpenseRow) => void;
  onFlag: (reason: string) => void;
  onUnflag: () => void;
  onClose: () => void;
}

export default function LandlordEditModal({ rowType, item, documentFiles, onSave, onFlag, onUnflag, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const [k, val] of Object.entries(item)) {
      if (k.startsWith('_')) continue;
      v[k] = val !== null && val !== undefined ? String(val) : '';
    }
    return v;
  });

  const [showFlagInput, setShowFlagInput] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docMime, setDocMime] = useState<string>('');
  const flagInputRef = useRef<HTMLTextAreaElement>(null);

  // Build an objectURL for the source document
  useEffect(() => {
    const file = documentFiles.find(f => f.name === item.fileName);
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

  const set = (key: string, value: string) => setValues(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    if (rowType === 'income') {
      const inc = item as IncomeRow;
      onSave({
        ...inc,
        Date: values.Date ?? '',
        PropertyAddress: values.PropertyAddress ?? '',
        Description: values.Description ?? '',
        Category: values.Category ?? '',
        Amount: parseFloat(values.Amount) || 0,
      });
    } else {
      const exp = item as ExpenseRow;
      onSave({
        ...exp,
        DueDate: values.DueDate ?? '',
        Description: values.Description ?? '',
        Category: values.Category ?? '',
        Amount: parseFloat(values.Amount) || 0,
        Supplier: values.Supplier ?? '',
        TenantPayable: values.TenantPayable === 'true',
        CapitalExpense: values.CapitalExpense === 'true',
        PropertyAddress: values.PropertyAddress ?? '',
      });
    }
    onClose();
  };

  const handleConfirmFlag = () => {
    if (!flagReason.trim()) return;
    onFlag(flagReason.trim());
    onClose();
  };

  const isFlagged = item._flagged;
  const hasDoc = !!docUrl;

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
              ? <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-lg"><AlertTriangle size={12} />Flagged</span>
              : <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-lg"><CheckCircle size={12} />{rowType === 'income' ? 'Income' : 'Expense'}</span>
            }
            <span className="text-sm text-[var(--text-muted)] truncate">{item.fileName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isFlagged
              ? <button onClick={() => { onUnflag(); onClose(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
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

        {/* Flag reason input */}
        {showFlagInput && (
          <div className="px-5 py-3 border-b border-[var(--border)] bg-amber-50 dark:bg-amber-900/10 shrink-0">
            <p className="text-xs font-semibold text-amber-700 mb-2">Reason for flagging:</p>
            <div className="flex gap-2">
              <textarea
                ref={flagInputRef}
                value={flagReason}
                onChange={e => setFlagReason(e.target.value)}
                rows={2}
                placeholder="e.g. Out of period, personal expense, duplicate…"
                className="input-base text-xs flex-1 resize-none"
              />
              <div className="flex flex-col gap-1.5">
                <button onClick={handleConfirmFlag} disabled={!flagReason.trim()} className="btn-primary text-xs px-3 py-1.5">Confirm</button>
                <button onClick={() => { setShowFlagInput(false); setFlagReason(''); }} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Flag reason display */}
        {isFlagged && item._flagReason && (
          <div className="px-5 py-2.5 border-b border-[var(--border)] bg-amber-50 dark:bg-amber-900/10 shrink-0">
            <p className="text-xs text-amber-700 dark:text-amber-400"><span className="font-semibold">Flag reason: </span>{item._flagReason}</p>
          </div>
        )}

        {/* Body: doc preview + form */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Document preview — left panel */}
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
            {hasDoc ? (
              docMime === 'application/pdf' ? (
                <iframe src={docUrl!} className="flex-1 w-full min-h-0" title="Source document" />
              ) : (
                <div className="flex-1 flex items-center justify-center overflow-auto p-4">
                  <img src={docUrl!} alt="Source document" className="max-w-full max-h-full object-contain" />
                </div>
              )
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[var(--text-muted)] text-center px-6">
                  Source document not available.<br />
                  <span className="text-xs">{item.fileName}</span>
                </p>
              </div>
            )}
          </div>

          {/* Form — right panel */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-5">
              <div className="space-y-4">
                {rowType === 'income' ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Date</label>
                        <input type="date" value={values.Date ?? ''} onChange={e => set('Date', e.target.value)} className="input-base text-sm w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Amount (£)</label>
                        <input type="number" step="0.01" value={values.Amount ?? ''} onChange={e => set('Amount', e.target.value)} className="input-base text-sm w-full" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Property Address</label>
                      <input type="text" value={values.PropertyAddress ?? ''} onChange={e => set('PropertyAddress', e.target.value)} className="input-base text-sm w-full" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Description</label>
                      <input type="text" value={values.Description ?? ''} onChange={e => set('Description', e.target.value)} className="input-base text-sm w-full" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Category</label>
                      <input type="text" value={values.Category ?? ''} onChange={e => set('Category', e.target.value)} className="input-base text-sm w-full" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Due Date</label>
                        <input type="date" value={values.DueDate ?? ''} onChange={e => set('DueDate', e.target.value)} className="input-base text-sm w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Amount (£)</label>
                        <input type="number" step="0.01" value={values.Amount ?? ''} onChange={e => set('Amount', e.target.value)} className="input-base text-sm w-full" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Supplier</label>
                      <input type="text" value={values.Supplier ?? ''} onChange={e => set('Supplier', e.target.value)} className="input-base text-sm w-full" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Description</label>
                      <input type="text" value={values.Description ?? ''} onChange={e => set('Description', e.target.value)} className="input-base text-sm w-full" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Category</label>
                      <select value={values.Category ?? ''} onChange={e => set('Category', e.target.value)} className="input-base text-sm w-full">
                        <option value="">Select category…</option>
                        {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Property Address</label>
                      <input type="text" value={values.PropertyAddress ?? ''} onChange={e => set('PropertyAddress', e.target.value)} className="input-base text-sm w-full" />
                    </div>
                    <div className="flex items-center gap-6 pt-1">
                      <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                        <input type="checkbox" checked={values.TenantPayable === 'true'} onChange={e => set('TenantPayable', String(e.target.checked))} className="rounded" />
                        Tenant Payable
                      </label>
                      <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                        <input type="checkbox" checked={values.CapitalExpense === 'true'} onChange={e => set('CapitalExpense', String(e.target.checked))} className="rounded" />
                        Capital Expense
                      </label>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-[var(--border)] flex justify-end gap-2 shrink-0">
              <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleSave} className="btn-primary text-sm">Save Changes</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
