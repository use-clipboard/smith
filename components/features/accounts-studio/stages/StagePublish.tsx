'use client';

import { useEffect, useState } from 'react';
import {
  FileText, FileCode2, Package, Calculator, ClipboardSignature, FileStack,
  Loader2, Send, Signature, Landmark, PartyPopper, Download, AlertCircle, Scissors, Info,
  CheckCircle2, RotateCcw, Building2, KeyRound, XCircle,
} from 'lucide-react';
import { StudioCard } from '../primitives';
import { generatePdfBlob, downloadBlob } from '@/utils/pdfFromHtml';
import { buildAccountsPackHtml } from '@/lib/accounts-studio/accountsPackHtml';
import { filletEligibility } from '@/lib/accounts-studio/statements';
import { buildIxbrlFromEngagement } from '@/lib/accounts-studio/ixbrlFromEngagement';
import { publishEngagement, markSubmitted, submitToCompaniesHouse, type ChSubmitResult } from '../persistence';
import { getFirmBranding, type FirmBranding } from '../branding';
import SendApprovalModal from '../SendApprovalModal';
import { useSendApproval } from '../useSendApproval';
import { useModules } from '@/components/ui/ModulesProvider';
import type { Engagement } from '../types';

function ukDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// Documents we genuinely produce now (all render the real statutory pack PDF).
const REAL_DOCS = [
  { id: 'statutory',  title: 'Statutory Accounts',   description: 'Full financial statements + notes', icon: FileText,            suffix: 'Statutory_Accounts' },
  { id: 'approval',   title: 'Client Approval Pack',  description: 'Accounts with a sign-off page',      icon: ClipboardSignature, suffix: 'Approval_Pack' },
  { id: 'management', title: 'Management Copy',        description: 'Internal working copy',              icon: FileStack,          suffix: 'Management_Copy' },
] as const;

// Regulated outputs — deliberately not simulated. Their own projects.
const COMING_SOON = [
  { id: 'ixbrl',      title: 'iXBRL Accounts',           description: 'FRC-tagged for online filing', icon: FileCode2,  format: 'iXBRL' },
  { id: 'ch-package', title: 'Companies House Package',  description: 'Ready-to-submit filing bundle', icon: Package,   format: 'ZIP' },
  { id: 'ct',         title: 'Corporation Tax Accounts', description: 'Accounts for the CT600',        icon: Calculator, format: 'iXBRL' },
] as const;

function fileName(e: Engagement, suffix: string): string {
  return `${suffix}_${e.companyName.replace(/\s+/g, '_')}_${e.periodEnd}.pdf`;
}

export default function StagePublish({
  engagement, patch,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
}) {
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [prefillEmail, setPrefillEmail] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Companies House XML Gateway filing (test).
  const [chOpen, setChOpen] = useState(false);
  const [chAuthCode, setChAuthCode] = useState('');
  const [chBusy, setChBusy] = useState(false);
  const [chError, setChError] = useState('');
  const [chResult, setChResult] = useState<ChSubmitResult | null>(null);
  const status = engagement.approvalStatus;

  const { isModuleActive } = useModules();
  const { send: sendApproval, sending: sendingApproval, error: sendError } = useSendApproval(engagement, (e) => patch(() => e));

  // Prefer opening the in-app compose window directly (like MTD IT): fetch the
  // client's email; if Email Triage is on and we have it, hand straight to the
  // compose toast. Otherwise fall back to the modal to collect the address.
  async function startSend() {
    setError('');
    let email = '';
    if (engagement.clientId) {
      setSendBusy(true);
      try { const r = await fetch(`/api/clients/${engagement.clientId}`); if (r.ok) email = (await r.json())?.client?.contact_email ?? ''; } catch { /* ignore */ }
      setSendBusy(false);
    }
    if (isModuleActive('email-triage') && email) {
      await sendApproval(email);
    } else {
      setPrefillEmail(email);
      setShowSend(true);
    }
  }

  async function submitToCH() {
    setSubmitting(true); setError('');
    try {
      const updated = await markSubmitted(engagement.id);
      patch(() => updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark as submitted.');
    } finally {
      setSubmitting(false);
    }
  }

  const ready = !!engagement.statements;
  const fillet = filletEligibility(engagement.entityType, engagement.size);

  const directors = (engagement.directors ?? []).filter(Boolean);
  const signatory = (engagement.signatory && directors.includes(engagement.signatory)) ? engagement.signatory : directors[0];

  const [branding, setBranding] = useState<FirmBranding>({ firmName: null, logoUrl: null, accountantDetails: null, accountantsReport: null });
  useEffect(() => { getFirmBranding().then(setBranding); }, []);

  async function download(suffix: string, docId: string, filleted = false) {
    setBusyDoc(docId); setError('');
    try {
      const blob = await generatePdfBlob(
        buildAccountsPackHtml(engagement, {
          filleted, firmName: branding.firmName, firmLogoUrl: branding.logoUrl,
          accountantDetails: branding.accountantDetails, accountantsReport: branding.accountantsReport,
          comparatives: engagement.showComparatives ?? true, amended: engagement.amended ?? false,
        }),
        undefined,
        { hardPageBreaks: true, pageNumbers: true },
      );
      downloadBlob(blob, fileName(engagement, suffix));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the PDF.');
    } finally {
      setBusyDoc(null);
    }
  }

  // iXBRL spike — generate a draft FRC-tagged Inline XBRL file from the
  // structured statements. Not yet filing-valid: run through the CH iXBRL test
  // validation service before filing. See lib/accounts-studio/ixbrl.ts.
  function downloadIxbrl() {
    setBusyDoc('ixbrl'); setError('');
    try {
      const html = buildIxbrlFromEngagement(engagement, { hasAccountantsReport: !!branding.accountantsReport });
      if (!html) { setError('Prepare the accounts before generating iXBRL.'); return; }
      downloadBlob(new Blob([html], { type: 'application/xhtml+xml' }), `iXBRL_${engagement.companyName.replace(/\s+/g, '_')}_${engagement.periodEnd}.html`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate iXBRL.');
    } finally {
      setBusyDoc(null);
    }
  }

  // ── Companies House XML Gateway filing (test) ───────────────────────────────
  async function fileToCH() {
    // Filing details are accounts data, captured earlier in the flow: the
    // registration number on Import Data, the employee count on Notes &
    // Disclosures → Employees. Fail early here with a pointer.
    if (!engagement.companyNumber?.trim()) { setChError('No company registration number — set it on the Import Data step first.'); return; }
    if (engagement.averageEmployees == null) { setChError('Average number of employees is not set — enter it in Notes & Disclosures → Employees.'); return; }
    if (!chAuthCode.trim()) { setChError('Enter the company authentication code.'); return; }
    setChBusy(true); setChError(''); setChResult(null);
    try {
      const res = await submitToCompaniesHouse(engagement.id, { companyAuthCode: chAuthCode.trim() });
      setChResult(res);
      if (res.ok) setChAuthCode('');
    } catch (e) {
      setChError(e instanceof Error ? e.message : 'Filing failed.');
    } finally {
      setChBusy(false);
    }
  }

  async function publish() {
    setPublishing(true); setError('');
    try {
      const outputId = await publishEngagement(engagement);
      patch(e => ({
        ...e,
        published: true,
        publishedOutputId: outputId,
        stageStatus: { ...e.stageStatus, publish: 'complete' },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish.');
    } finally {
      setPublishing(false);
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-lg">
        <StudioCard className="p-6 text-center">
          <AlertCircle size={26} className="mx-auto mb-3 text-amber-500" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Nothing to publish yet</h3>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Import a trial balance and prepare the accounts before publishing.</p>
        </StudioCard>
      </div>
    );
  }

  // ── Published — real download ───────────────────────────────────────────────
  if (engagement.published) {
    return (
      <div className="mx-auto max-w-xl">
        <StudioCard className="overflow-hidden text-center">
          <div className="relative flex flex-col items-center gap-3 px-8 py-12 text-white"
            style={{ background: 'linear-gradient(140deg,#4F46E5 0%,#7C3AED 55%,#9333EA 100%)' }}>
            <div className="pointer-events-none absolute -left-10 -top-12 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/20 backdrop-blur"><PartyPopper size={32} className="text-white" /></div>
            <h2 className="text-2xl font-bold">Accounts Published</h2>
            <p className="max-w-sm text-[13px] text-white/85">{engagement.companyName} — statutory accounts for the year ended {engagement.periodEnd} are complete and saved to the client record.</p>
          </div>
          <div className="space-y-3 px-8 py-7">
            <button onClick={() => download('Statutory_Accounts', 'statutory')} disabled={busyDoc !== null} className="btn-primary w-full justify-center">
              {busyDoc ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download statutory accounts (PDF)
            </button>
            {error && <p className="text-[12px] text-red-600">{error}</p>}
            <p className="text-[11.5px] text-[var(--text-muted)]">
              Filing to Companies House, iXBRL tagging and the CT600 hand-off are coming soon.
            </p>
          </div>
        </StudioCard>
      </div>
    );
  }

  // ── Pre-publish ─────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-5">
      <StudioCard className="overflow-hidden lg:col-span-3">
        <div className="border-b border-black/5 px-6 py-4">
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Documents</h3>
          <p className="text-[12px] text-[var(--text-muted)]">Generate and download the real accounts pack. Regulated filings are coming soon.</p>
        </div>
        <div className="divide-y divide-black/5">
          {REAL_DOCS.map(doc => {
            const Icon = doc.icon;
            const busy = busyDoc === doc.id;
            return (
              <div key={doc.id} className="flex items-center gap-3 px-6 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Icon size={17} /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{doc.title}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{doc.description}</p>
                </div>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-500">PDF</span>
                <button onClick={() => download(doc.suffix, doc.id)} disabled={busyDoc !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] disabled:opacity-50">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {busy ? 'Building…' : 'Download'}
                </button>
              </div>
            );
          })}
          {/* Filleted accounts for Companies House — only when the company/LLP
              qualifies for the small companies regime. */}
          {fillet.eligible && (
            <div className="flex items-center gap-3 px-6 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Scissors size={17} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">Filleted Accounts</p>
                <p className="text-[11px] text-[var(--text-muted)]">For filing with Companies House — balance sheet + notes, no P&amp;L or directors&apos; report.</p>
              </div>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-indigo-600">Companies House</span>
              <button onClick={() => download('Filleted_Accounts', 'filleted', true)} disabled={busyDoc !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] disabled:opacity-50">
                {busyDoc === 'filleted' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {busyDoc === 'filleted' ? 'Building…' : 'Download'}
              </button>
            </div>
          )}
          {fillet.filingEntity && !fillet.eligible && (
            <div className="flex items-start gap-3 px-6 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Info size={17} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">Filleted accounts not available</p>
                <p className="text-[11px] text-[var(--text-muted)]">{fillet.reason}</p>
              </div>
            </div>
          )}
          {COMING_SOON.map(doc => {
            const Icon = doc.icon;
            const isIxbrl = doc.id === 'ixbrl';
            return (
              <div key={doc.id} className={`flex items-center gap-3 px-6 py-3 ${isIxbrl ? '' : 'opacity-60'}`}>
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${isIxbrl ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-slate-100 text-slate-400'}`}><Icon size={17} /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{doc.title}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{isIxbrl ? 'FRC-tagged draft — validate via the CH iXBRL test service before filing.' : doc.description}</p>
                </div>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-500">{doc.format}</span>
                {isIxbrl ? (
                  <button onClick={downloadIxbrl} disabled={busyDoc !== null || !engagement.statements}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] disabled:opacity-50">
                    {busyDoc === 'ixbrl' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download (beta)
                  </button>
                ) : (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-700">Soon</span>
                )}
              </div>
            );
          })}
        </div>
        {error && <div className="border-t border-black/5 px-6 py-3 text-[12.5px] text-red-600">{error}</div>}
      </StudioCard>

      <div className="space-y-3 lg:col-span-2">
        {directors.length > 1 && (
          <StudioCard className="p-4">
            <h4 className="mb-1 flex items-center gap-1.5 px-1 text-[13px] font-bold text-[var(--text-primary)]"><Signature size={14} /> Signatory</h4>
            <p className="mb-2 px-1 text-[11px] text-[var(--text-muted)]">The director who signs the report and balance sheet.</p>
            <select
              value={signatory ?? ''}
              onChange={ev => { const v = ev.target.value; patch(e => ({ ...e, signatory: v })); }}
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            >
              {directors.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </StudioCard>
        )}

        {/* Client approval & submission */}
        <StudioCard className="p-4">
          <h4 className="mb-2 flex items-center gap-1.5 px-1 text-[13px] font-bold text-[var(--text-primary)]"><ClipboardSignature size={14} /> Client approval &amp; submission</h4>

          {/* Status line */}
          {status === 'sent' && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-sky-200/70 bg-sky-50/60 px-3 py-2 text-[12px] text-sky-800">
              <Send size={13} className="shrink-0" /> Sent to the client on {ukDate(engagement.sentAt)} — awaiting approval.
            </div>
          )}
          {status === 'approved' && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-800">
              <CheckCircle2 size={13} className="shrink-0" /> Approved by {engagement.approvedByName || 'the client'} on {ukDate(engagement.approvedAt)}.
            </div>
          )}
          {status === 'rejected' && (
            <div className="mb-2 rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-800">
              <p className="flex items-center gap-2 font-semibold"><RotateCcw size={13} className="shrink-0" /> Client requested changes on {ukDate(engagement.rejectedAt)}.</p>
              {engagement.changesNote && <p className="mt-1 pl-5">{engagement.changesNote}</p>}
            </div>
          )}

          <div className="space-y-1.5">
            {/* Send / re-send */}
            <button onClick={startSend} disabled={!ready || sendBusy || sendingApproval}
              className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white/60 px-3 py-2.5 text-left transition-colors hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 disabled:opacity-50">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">{sendBusy || sendingApproval ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">{status ? 'Re-send for approval' : 'Send for approval'}</p>
                <p className="text-[11px] text-[var(--text-muted)]">Email the accounts to the client to sign</p>
              </div>
            </button>

            {/* Mark as submitted — enabled once approved */}
            <button onClick={submitToCH} disabled={status !== 'approved' || submitting}
              className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white/60 px-3 py-2.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/60 disabled:cursor-not-allowed disabled:opacity-45">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">{submitting ? <Loader2 size={15} className="animate-spin" /> : <Landmark size={15} />}</div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">Mark as submitted to Companies House</p>
                <p className="text-[11px] text-[var(--text-muted)]">{status === 'approved' ? 'Records the accounts as filed' : 'Available once the client has approved'}</p>
              </div>
            </button>

            {/* File to Companies House (XML Gateway — test environment) */}
            <button onClick={() => setChOpen(o => !o)} disabled={!ready}
              className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white/60 px-3 py-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600"><Building2 size={15} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">File iXBRL to Companies House <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Test</span></p>
                <p className="text-[11px] text-[var(--text-muted)]">Submit the tagged accounts over the XML Gateway</p>
              </div>
            </button>
          </div>

          {chOpen && (
            <div className="mt-2 rounded-xl border border-indigo-200/70 bg-indigo-50/40 p-3">
              <label className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-primary)]"><Scissors size={12} /> What are you filing?</label>
              <p className="mb-2 text-[10.5px] text-[var(--text-muted)]">Most small companies file <strong>filleted</strong> accounts — balance sheet and notes only, with the profit &amp; loss account withheld from the public record under s.444.</p>
              <div className="mb-3 inline-flex rounded-lg border border-[var(--border)] bg-white p-0.5 text-[12px] font-semibold">
                {([['full', 'Full accounts'], ['filleted', 'Filleted accounts']] as const).map(([val, lbl]) => {
                  const active = (val === 'filleted') === !!engagement.fileFilleted;
                  return (
                    <button key={val} onClick={() => patch(e => ({ ...e, fileFilleted: val === 'filleted' }))}
                      className={`rounded-md px-3 py-1.5 transition-colors ${active ? 'bg-indigo-600 text-white' : 'text-[var(--text-secondary)] hover:bg-black/[0.03]'}`}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
              <label className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-primary)]"><KeyRound size={12} /> Company authentication code</label>
              <p className="mb-2 text-[10.5px] text-[var(--text-muted)]">The 6-character code Companies House issues for this company. Required for every filing; not stored.</p>
              <div className="flex gap-2">
                <input
                  value={chAuthCode}
                  onChange={ev => setChAuthCode(ev.target.value)}
                  placeholder="e.g. A1B2C3"
                  autoComplete="off" spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[13px] tracking-wider text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                <button onClick={fileToCH} disabled={chBusy || !chAuthCode.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {chBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {chBusy ? 'Filing…' : 'File'}
                </button>
              </div>
              {chError && <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-red-600"><XCircle size={13} className="mt-px shrink-0" /> {chError}</p>}
              {chResult && (
                <div className={`mt-2 rounded-lg border px-3 py-2 text-[11.5px] ${chResult.ok ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800' : 'border-red-200 bg-red-50/70 text-red-700'}`}>
                  <p className="flex items-center gap-1.5 font-semibold">
                    {chResult.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                    {chResult.ok ? `Submitted — number ${chResult.submissionNumber}` : 'Rejected by Companies House'}
                  </p>
                  <p className="mt-0.5">{chResult.message}</p>
                  {chResult.ok && chResult.isTest && (
                    <p className="mt-1 text-[10.5px] text-emerald-700">Test submissions are reviewed manually — email the Companies House XML team to have submission {chResult.submissionNumber} checked.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <p className="mt-2 px-1 text-[10.5px] text-[var(--text-muted)]">Filing goes to the Companies House XML Gateway test environment. &ldquo;Mark as submitted&rdquo; records the accounts as filed on the client record.</p>
        </StudioCard>

        {showSend && (
          <SendApprovalModal
            engagement={engagement}
            initialEmail={prefillEmail}
            sending={sendingApproval}
            error={sendError}
            triageActive={isModuleActive('email-triage')}
            onSubmit={(email, note) => sendApproval(email, note)}
            onClose={() => setShowSend(false)}
          />
        )}

        <button onClick={publish} disabled={publishing} className="btn-primary w-full justify-center py-3 text-[14px] disabled:opacity-45">
          {publishing ? <><Loader2 size={16} className="animate-spin" /> Publishing…</> : <><PartyPopper size={16} /> Publish accounts</>}
        </button>
        <p className="text-center text-[11px] text-[var(--text-muted)]">Publishing marks the accounts complete and saves them to the client record.</p>
      </div>
    </div>
  );
}
