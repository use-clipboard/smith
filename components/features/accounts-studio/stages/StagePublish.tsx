'use client';

import { useState } from 'react';
import {
  FileText, FileCode2, Package, Calculator, ClipboardSignature, FileStack,
  Loader2, Send, Signature, Landmark, Archive, PartyPopper, Download, AlertCircle,
} from 'lucide-react';
import { StudioCard } from '../primitives';
import { generatePdfBlob, downloadBlob } from '@/utils/pdfFromHtml';
import { buildAccountsPackHtml } from '@/lib/accounts-studio/accountsPackHtml';
import { publishEngagement } from '../persistence';
import type { Engagement } from '../types';

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

const ACTIONS = [
  { id: 'send',    label: 'Send to Client',           icon: Send,      sub: 'Email the approval pack' },
  { id: 'approve', label: 'Digital Approval',         icon: Signature, sub: 'E-signature via Client Portal' },
  { id: 'ch',      label: 'Submit to Companies House', icon: Landmark,  sub: 'File iXBRL accounts' },
  { id: 'ct',      label: 'Send to Corporation Tax',   icon: Calculator,sub: 'Feed the CT600 module' },
  { id: 'archive', label: 'Archive in Document Vault', icon: Archive,   sub: 'Store every generated file' },
];

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

  const ready = !!engagement.statements;

  async function download(suffix: string, docId: string) {
    setBusyDoc(docId); setError('');
    try {
      const blob = await generatePdfBlob(buildAccountsPackHtml(engagement));
      downloadBlob(blob, fileName(engagement, suffix));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the PDF.');
    } finally {
      setBusyDoc(null);
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
          {COMING_SOON.map(doc => {
            const Icon = doc.icon;
            return (
              <div key={doc.id} className="flex items-center gap-3 px-6 py-3 opacity-60">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Icon size={17} /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{doc.title}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{doc.description}</p>
                </div>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-500">{doc.format}</span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-700">Soon</span>
              </div>
            );
          })}
        </div>
        {error && <div className="border-t border-black/5 px-6 py-3 text-[12.5px] text-red-600">{error}</div>}
      </StudioCard>

      <div className="space-y-3 lg:col-span-2">
        <StudioCard className="p-4">
          <h4 className="mb-2 px-1 text-[13px] font-bold text-[var(--text-primary)]">Publish &amp; distribute</h4>
          <div className="space-y-1.5">
            {ACTIONS.map(a => (
              <div key={a.id} className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white/60 px-3 py-2.5 opacity-60">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><a.icon size={15} /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{a.label}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{a.sub}</p>
                </div>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Soon</span>
              </div>
            ))}
          </div>
        </StudioCard>

        <button onClick={publish} disabled={publishing} className="btn-primary w-full justify-center py-3 text-[14px] disabled:opacity-45">
          {publishing ? <><Loader2 size={16} className="animate-spin" /> Publishing…</> : <><PartyPopper size={16} /> Publish accounts</>}
        </button>
        <p className="text-center text-[11px] text-[var(--text-muted)]">Publishing marks the accounts complete and saves them to the client record.</p>
      </div>
    </div>
  );
}
