'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Download, Upload, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

type ClientStatus = 'active' | 'hold' | 'inactive';

interface ParsedRow {
  name: string;
  client_ref: string;
  business_type: string;
  contact_email: string;
  status: ClientStatus;
  linked_to_ref: string;
  link_type: string;
  address: string;
  utr_number: string;
  registration_number: string;
  national_insurance_number: string;
  companies_house_id: string;
  vat_number: string;
  companies_house_auth_code: string;
  date_of_birth: string;
  contact_number: string;
  paye_reference: string;
  paye_accounts_office_reference: string;
  vat_submit_type: string;
  vat_scheme: string;
  year_end: string;
  mtd_it: boolean;
  _error?: string;
}

interface SkippedRow { name: string; reason: string; }
interface ClientImportModalProps { onClose: () => void; onImported: () => void; }

const TEMPLATE_HEADERS = [
  'name', 'client_ref', 'business_type', 'contact_email', 'status',
  'linked_to_ref', 'link_type', 'address', 'utr_number', 'registration_number',
  'national_insurance_number', 'companies_house_id', 'vat_number',
  'companies_house_auth_code', 'date_of_birth',
  'contact_number', 'paye_reference', 'paye_accounts_office_reference',
  'vat_submit_type', 'vat_scheme', 'year_end', 'mtd_it',
];

const TEMPLATE_EXAMPLE_ROWS = [
  ['Acme Plumbing Ltd', 'AC001', 'limited_company', 'accounts@acmeplumbing.co.uk', 'active', '', '', '10 High St, London, EC1A 1BB', '12345678901', '12345678', '', '', 'GB123456789', 'ABCDE1', '', '01234 567890', '123/AB45678', '123PA00012345', 'Accrual', 'Quarterly', '31 MAR', ''],
  ['John Smith', 'JS002', 'individual', 'john@johnsmith.co.uk', 'active', 'AC001', 'director', '22 Oak Road, Manchester, M1 1AA', '98765432101', '', 'AB123456C', '', '', '', '01/01/1980', '07700 900123', '', '', '', '', '', 'yes'],
  ['The Smith Partnership', 'SP003', 'partnership', '', 'active', '', '', '', '56789012301', '', '', '', 'GB987654321', '', '', '01234 111222', '456/CD78901', '456PA00056789', 'Cash', 'Monthly', '05 APR', ''],
  ['Jane Doe Consulting', 'JD004', 'sole_trader', 'jane@janedoe.com', 'hold', '', '', '', '11111111101', '', 'CD234567D', 'OC123456', 'GB111222333', '', '15/06/1975', '', '789/EF23456', '789PA00078901', 'Accrual', 'Yearly', '31 JAN', ''],
  ['City Food Bank', 'CF006', 'charity', 'finance@cityfoodbank.org', 'inactive', '', '', '', '', '', '', '', '', '', '', '01234 999888', '', '', '', '', '31 DEC', ''],
];

const VALID_TYPES = new Set(['sole_trader','partnership','limited_company','individual','trust','charity','rental_landlord','']);
const VALID_LINK_TYPES = new Set(['director','shareholder','spouse_partner','trustee','beneficiary','associated_company','parent_company','subsidiary','guarantor','other','']);

function downloadTemplate() {
  const rows = [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE_ROWS];
  const csv = rows.map(r => r.map(cell => `"${cell}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'agent_smith_client_import_template.csv'; a.click();
  URL.revokeObjectURL(url);
}

// Accepts 'active'|'hold'|'inactive', and legacy yes/no
function parseStatusValue(val: string): ClientStatus {
  const v = val.trim().toLowerCase();
  if (v === 'hold') return 'hold';
  if (v === 'inactive' || v === 'no' || v === 'false' || v === '0') return 'inactive';
  return 'active';
}

const STATUS_LABELS: Record<ClientStatus, string> = { active: 'Active', hold: 'On Hold', inactive: 'Inactive' };
const STATUS_STYLES: Record<ClientStatus, string> = {
  active:   'bg-green-100 text-green-700',
  hold:     'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-100 text-gray-500',
};

function parseCsv(text: string): ParsedRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const idx = (name: string) => rawHeaders.findIndex(h => h === name);
  const nameIdx = idx('name');
  const refIdx = idx('client_ref');
  const typeIdx = idx('business_type');
  const emailIdx = idx('contact_email');
  // Accept 'status' column (new) or legacy 'is_active' column
  const activeIdx = idx('status') >= 0 ? idx('status') : idx('is_active');
  const linkedRefIdx = idx('linked_to_ref');
  const linkTypeIdx = idx('link_type');
  const addressIdx = idx('address');
  const utrIdx = idx('utr_number');
  const regIdx = idx('registration_number');
  const niIdx = idx('national_insurance_number');
  const chIdIdx = idx('companies_house_id');
  const vatIdx = idx('vat_number');
  const chAuthIdx = idx('companies_house_auth_code');
  const dobIdx = idx('date_of_birth');
  const contactNumberIdx = idx('contact_number');
  const payeRefIdx = idx('paye_reference');
  const payeAORIdx = idx('paye_accounts_office_reference');
  const vatSubmitTypeIdx = idx('vat_submit_type');
  const vatSchemeIdx = idx('vat_scheme');
  const yearEndIdx = idx('year_end');
  const mtdItIdx = idx('mtd_it');

  if (nameIdx === -1) return [];

  const results: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cells: string[] = [];
    let inQuotes = false, current = '';
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    cells.push(current.trim());

    const get = (i: number) => i >= 0 ? (cells[i]?.replace(/^"|"$/g, '').trim() ?? '') : '';

    const name = get(nameIdx);
    const client_ref = get(refIdx);
    const business_type = get(typeIdx).toLowerCase();
    const contact_email = get(emailIdx);
    const status_raw = activeIdx >= 0 ? get(activeIdx) : 'active';
    const linked_to_ref = get(linkedRefIdx);
    const link_type = get(linkTypeIdx).toLowerCase();
    const address = get(addressIdx);
    const utr_number = get(utrIdx);
    const registration_number = get(regIdx);
    const national_insurance_number = get(niIdx);
    const companies_house_id = get(chIdIdx);
    const vat_number = get(vatIdx);
    const companies_house_auth_code = get(chAuthIdx);
    const date_of_birth = get(dobIdx);
    const contact_number = get(contactNumberIdx);
    const paye_reference = get(payeRefIdx);
    const paye_accounts_office_reference = get(payeAORIdx);
    const vat_submit_type = get(vatSubmitTypeIdx);
    const vat_scheme = get(vatSchemeIdx);
    const year_end = get(yearEndIdx).toUpperCase();
    const mtd_it = ['yes', 'true', '1'].includes(get(mtdItIdx).toLowerCase());

    const row: ParsedRow = {
      name, client_ref, business_type, contact_email,
      status: parseStatusValue(status_raw),
      linked_to_ref, link_type, address, utr_number, registration_number,
      national_insurance_number, companies_house_id, vat_number,
      companies_house_auth_code, date_of_birth,
      contact_number, paye_reference, paye_accounts_office_reference,
      vat_submit_type, vat_scheme, year_end, mtd_it,
    };

    if (!name) row._error = 'Name is required';
    else if (!client_ref) row._error = 'Client reference is required';
    else if (business_type && !VALID_TYPES.has(business_type)) row._error = `Invalid business_type "${business_type}"`;
    else if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) row._error = `Invalid email "${contact_email}"`;
    else if (link_type && !VALID_LINK_TYPES.has(link_type)) row._error = `Invalid link_type "${link_type}"`;
    else if (vat_submit_type && !['Cash', 'Accrual', ''].includes(vat_submit_type)) row._error = `Invalid vat_submit_type "${vat_submit_type}" — use Cash or Accrual`;
    else if (vat_scheme && !['Monthly', 'Quarterly', 'Yearly', ''].includes(vat_scheme)) row._error = `Invalid vat_scheme "${vat_scheme}" — use Monthly, Quarterly or Yearly`;

    results.push(row);
  }
  return results;
}

const CLIENT_TYPE_LABELS: Record<string, string> = {
  sole_trader: 'Sole Trader', partnership: 'Partnership', limited_company: 'Ltd Company',
  individual: 'Individual', trust: 'Trust', charity: 'Charity', rental_landlord: 'Rental Landlord', '': '—',
};

export default function ClientImportModal({ onClose, onImported }: ClientImportModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [linkWarnings, setLinkWarnings] = useState<string[]>([]);
  const [progressWidth, setProgressWidth] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animate an indeterminate-style progress bar while importing
  useEffect(() => {
    if (importing) {
      setProgressWidth(5);
      let current = 5;
      progressRef.current = setInterval(() => {
        // Ease toward 85% — never reaches 100% until done
        current = current + (85 - current) * 0.04;
        setProgressWidth(current);
      }, 200);
    } else {
      if (progressRef.current) clearInterval(progressRef.current);
      setProgressWidth(0);
    }
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [importing]);

  const validRows = rows.filter(r => !r._error);
  const errorRows = rows.filter(r => r._error);
  const hasLinks = validRows.some(r => r.linked_to_ref.trim());

  const handleFile = useCallback((file: File) => {
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.length === 0) { setParseError('Could not parse the file. Make sure it matches the template format.'); return; }
      setRows(parsed); setStep('preview');
    };
    reader.readAsText(file);
  }, []);

  function handleDrop(e: React.DragEvent) { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleFile(file); }
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) { const file = e.target.files?.[0]; if (file) handleFile(file); }

  async function handleImport() {
    setImporting(true);
    try {
      const payload = validRows.map(r => ({
        name: r.name, client_ref: r.client_ref || undefined,
        business_type: r.business_type || undefined, contact_email: r.contact_email || undefined,
        status: r.status, linked_to_ref: r.linked_to_ref || undefined, link_type: r.link_type || undefined,
        address: r.address || undefined, utr_number: r.utr_number || undefined,
        registration_number: r.registration_number || undefined,
        national_insurance_number: r.national_insurance_number || undefined,
        companies_house_id: r.companies_house_id || undefined,
        vat_number: r.vat_number || undefined,
        companies_house_auth_code: r.companies_house_auth_code || undefined,
        date_of_birth: r.date_of_birth || undefined,
        contact_number: r.contact_number || undefined,
        paye_reference: r.paye_reference || undefined,
        paye_accounts_office_reference: r.paye_accounts_office_reference || undefined,
        vat_submit_type: r.vat_submit_type || undefined,
        vat_scheme: r.vat_scheme || undefined,
        year_end: r.year_end || undefined,
        mtd_it: r.mtd_it || undefined,
      }));

      const res = await fetch('/api/clients/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: payload }),
      });
      const data = await res.json();
      if (!res.ok) { setParseError(data.error || 'Import failed'); return; }
      setImportedCount(data.imported); setSkipped(data.skipped ?? []); setLinkWarnings(data.link_warnings ?? []);
      setStep('result'); onImported();
    } catch { setParseError('An unexpected error occurred'); } finally { setImporting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="glass-solid rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-[var(--border)]">

        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-semibold text-[var(--text-primary)]">Import Clients from CSV</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {step === 'upload' && 'Download the template, fill it in, then upload it here'}
              {step === 'preview' && `${rows.length} rows found — ${validRows.length} valid, ${errorRows.length} with errors${hasLinks ? ` · ${validRows.filter(r => r.linked_to_ref).length} with links` : ''}`}
              {step === 'result' && 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded-lg hover:bg-[var(--bg-nav-hover)]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 scrollbar-thin">

          {/* Loading state — shown while import is in flight */}
          {importing && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <Loader2 size={40} className="text-[var(--accent)] animate-spin" />
              <div className="text-center space-y-1">
                <p className="font-semibold text-[var(--text-primary)] text-lg">
                  Importing {validRows.length} client{validRows.length !== 1 ? 's' : ''}…
                </p>
                <p className="text-sm text-[var(--text-muted)]">Please wait and don't close this window.</p>
              </div>
              <div className="w-full max-w-sm">
                <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] rounded-full transition-all duration-200 ease-out"
                    style={{ width: `${progressWidth}%` }}
                  />
                </div>
                <p className="text-xs text-[var(--text-muted)] text-center mt-2">
                  Large imports are processed in batches — this may take up to a minute.
                </p>
              </div>
            </div>
          )}

          {!importing && <>

          {step === 'upload' && (
            <div className="space-y-5">
              <div className="bg-[var(--accent-light)] border border-[var(--accent)]/20 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <p className="font-medium text-[var(--accent)] text-sm">Step 1 — Download the template</p>
                  <button onClick={downloadTemplate} className="btn-primary whitespace-nowrap"><Download size={14} />Download Template</button>
                </div>
                <p className="text-xs text-[var(--accent)]/70 mt-2 leading-relaxed">
                  Required: <strong>name</strong>, <strong>client_ref</strong>. Optional: <strong>business_type</strong>, <strong>contact_email</strong>,{' '}
                  <strong>contact_number</strong>, <strong>status</strong> (active/hold/inactive), <strong>linked_to_ref</strong>, <strong>link_type</strong>,{' '}
                  <strong>address</strong>, <strong>utr_number</strong>, <strong>registration_number</strong>,{' '}
                  <strong>national_insurance_number</strong>, <strong>companies_house_id</strong>, <strong>vat_number</strong>,{' '}
                  <strong>companies_house_auth_code</strong>, <strong>date_of_birth</strong>,{' '}
                  <strong>paye_reference</strong>, <strong>paye_accounts_office_reference</strong>,{' '}
                  <strong>vat_submit_type</strong> (Cash/Accrual), <strong>vat_scheme</strong> (Monthly/Quarterly/Yearly),{' '}
                  <strong>year_end</strong> (e.g. 31 MAR), <strong>mtd_it</strong> (yes/no — individuals only).
                </p>
                <p className="text-xs text-[var(--accent)]/60 mt-1.5">
                  Valid link types:{' '}
                  {['director','shareholder','spouse_partner','trustee','beneficiary','associated_company','parent_company','subsidiary','guarantor','other'].map(t => (
                    <code key={t} className="bg-[var(--accent)]/10 px-1 rounded mr-1 font-mono text-[var(--accent)]">{t}</code>
                  ))}
                </p>
              </div>

              <div>
                <p className="font-medium text-[var(--text-primary)] text-sm mb-2">Step 2 — Upload your completed CSV</p>
                <div
                  onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-[var(--border-input)] hover:border-[var(--accent)] rounded-xl p-10 text-center cursor-pointer transition-colors bg-[var(--bg-nav-hover)]/50"
                >
                  <Upload size={32} className="text-[var(--text-muted)] mx-auto mb-3" />
                  <p className="text-[var(--text-secondary)] text-sm">Drag & drop your CSV here, or <span className="text-[var(--accent)] font-medium">browse</span></p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">CSV files only · max 5,000 rows</p>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileInput} />
                </div>
              </div>

              {parseError && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 px-4 py-3 rounded-lg">{parseError}</p>}
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              {errorRows.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm font-medium text-amber-800 mb-2 flex items-center gap-2"><AlertTriangle size={14} />{errorRows.length} row{errorRows.length !== 1 ? 's' : ''} have errors and will be skipped</p>
                  <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                    {errorRows.map((r, i) => <li key={i}><strong>{r.name || `Row ${i + 1}`}:</strong> {r._error}</li>)}
                  </ul>
                </div>
              )}

              {validRows.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-[var(--text-muted)] text-sm">No valid rows to import.</p>
                  <button onClick={() => setStep('upload')} className="mt-3 text-[var(--accent)] text-sm hover:underline">Go back</button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">{validRows.length}</strong> client{validRows.length !== 1 ? 's' : ''} ready to import:</p>
                  <div className="glass-solid rounded-xl overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead className="border-b border-[var(--border)]">
                        <tr>
                          {['Name', 'Ref', 'Type', 'Email', 'Tel', 'Status', 'Links', 'UTR', 'Reg No', 'NI', 'VAT', 'PAYE Ref', 'VAT Type', 'VAT Scheme', 'Year End', 'MTD IT', 'DOB'].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {validRows.map((r, i) => (
                          <tr key={i} className="hover:bg-[var(--bg-nav-hover)] transition-colors">
                            <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{r.name}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] font-mono text-xs">{r.client_ref || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-secondary)]">{CLIENT_TYPE_LABELS[r.business_type] ?? '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)]">{r.contact_email || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{r.contact_number || '—'}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                                {STATUS_LABELS[r.status]}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{r.linked_to_ref ? <span className="font-mono">{r.linked_to_ref}{r.link_type ? ` (${r.link_type})` : ''}</span> : '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] font-mono text-xs">{r.utr_number || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] font-mono text-xs">{r.registration_number || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] font-mono text-xs">{r.national_insurance_number || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] font-mono text-xs">{r.vat_number || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] font-mono text-xs">{r.paye_reference || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{r.vat_submit_type || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{r.vat_scheme || '—'}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{r.year_end || '—'}</td>
                            <td className="px-3 py-2 text-xs">
                              {r.mtd_it
                                ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Yes</span>
                                : <span className="text-[var(--text-muted)]">—</span>}
                            </td>
                            <td className="px-3 py-2 text-[var(--text-muted)] text-xs">{r.date_of_birth || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {parseError && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 px-4 py-3 rounded-lg">{parseError}</p>}
            </div>
          )}

          {step === 'result' && (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-5 text-center">
                <CheckCircle2 size={32} className="text-green-600 mx-auto mb-2" />
                <div className="text-4xl font-bold text-green-700">{importedCount}</div>
                <p className="text-green-800 font-medium mt-1">client{importedCount !== 1 ? 's' : ''} imported successfully</p>
              </div>
              {skipped.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm font-medium text-amber-800 mb-2">{skipped.length} row{skipped.length !== 1 ? 's' : ''} were skipped:</p>
                  <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">{skipped.map((s, i) => <li key={i}><strong>{s.name}:</strong> {s.reason}</li>)}</ul>
                </div>
              )}
              {linkWarnings.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded-xl p-4">
                  <p className="text-sm font-medium text-blue-800 mb-2">{linkWarnings.length} link{linkWarnings.length !== 1 ? 's' : ''} could not be created:</p>
                  <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">{linkWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          </>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex justify-between items-center flex-shrink-0">
          <div>{!importing && step === 'preview' && <button onClick={() => { setStep('upload'); setRows([]); }} className="btn-ghost text-sm">Upload different file</button>}</div>
          <div className="flex gap-3">
            {!importing && <button onClick={onClose} className="btn-ghost">{step === 'result' ? 'Close' : 'Cancel'}</button>}
            {!importing && step === 'preview' && validRows.length > 0 && (
              <button onClick={() => void handleImport()} className="btn-primary">
                {`Import ${validRows.length} client${validRows.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
