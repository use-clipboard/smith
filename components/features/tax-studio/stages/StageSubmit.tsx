'use client';

import { useState, useEffect } from 'react';
import {
  Send, CheckCircle2, Loader2, ShieldCheck, Archive, Lock, FileCheck2,
  Landmark, AlertTriangle, ChevronDown, PenLine, Code2, X,
} from 'lucide-react';
import { StudioCard, SectionTitle } from '../primitives';
import { fmtDateUK } from '../data';
import { requiredFieldIssues, type FieldIssue } from '../validation';
import type { TaxReturn } from '../types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

export default function StageSubmit({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  const submitted = ret.approvalStatus === 'submitted';
  const approved = ret.approvalStatus === 'approved' || submitted;
  const issues = requiredFieldIssues(ret);

  if (submitted) return <SuccessView ret={ret} />;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ReadinessCard ret={ret} approved={approved} issues={issues} />
      <SaFilingCard ret={ret} patch={patch} approved={approved} issues={issues} />
      <ManualCard patch={patch} approved={approved} issues={issues} taxYear={ret.taxYear} id={ret.id} />
    </div>
  );
}

// A shared banner listing the required fields that must be filled before filing.
function RequiredFieldsBanner({ issues }: { issues: FieldIssue[] }) {
  if (!issues.length) return null;
  return (
    <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-800">
      <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} /> Complete these required fields before filing:</p>
      <ul className="mt-1 list-disc pl-6">{issues.map((f, i) => <li key={i}>{f.label}</li>)}</ul>
    </div>
  );
}

// ─── Readiness checklist ─────────────────────────────────────────────────────
function ReadinessCard({ ret, approved, issues }: { ret: TaxReturn; approved: boolean; issues: FieldIssue[] }) {
  const checks = [
    { ok: ret.stageStatus.review === 'complete', label: 'Review complete' },
    { ok: issues.length === 0, label: 'Required details complete' },
    { ok: approved, label: 'Client approval recorded' },
    { ok: !!ret.utr, label: 'UTR present' },
  ];
  return (
    <StudioCard className="p-5">
      <SectionTitle title="Submit to HMRC" sub="Final checks before the return is filed." />
      <div className="space-y-2">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-2.5 text-[12.5px]">
            {c.ok ? <CheckCircle2 size={15} className="text-emerald-500" /> : <ShieldCheck size={15} className="text-slate-300" />}
            <span className={c.ok ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{c.label}</span>
          </div>
        ))}
      </div>
      {issues.length > 0 && <div className="mt-3"><RequiredFieldsBanner issues={issues} /></div>}
    </StudioCard>
  );
}

// ─── Legacy SA100 online filing (GovTalk / Transaction Engine) ───────────────
// MTD-ITSA lives in the MTD IT tool; Tax Studio files the legacy SA100 return.
function SaFilingCard({ ret, patch, approved, issues }: { ret: TaxReturn; patch: Patch; approved: boolean; issues: FieldIssue[] }) {
  const [credsConfigured, setCredsConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/firms/sa-filing')
      .then(r => r.json())
      .then(d => setCredsConfigured(d.ready ?? false))
      .catch(() => setCredsConfigured(false));
  }, []);
  const canFile = approved && issues.length === 0 && !!ret.utr && credsConfigured === true;
  const [phase, setPhase] = useState<'idle' | 'filing'>('idle');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ irmark: string; message: string } | null>(null);
  const [isTest, setIsTest] = useState(true);
  const [xml, setXml] = useState<{ xml: string; irmark: string; note: string } | null>(null);
  const [loadingXml, setLoadingXml] = useState(false);

  async function previewXml() {
    setLoadingXml(true); setError('');
    try {
      const res = await fetch(`/api/tax-studio/returns/${ret.id}/sa-xml`);
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((json.error as string) || 'Could not build the return XML.');
      setXml({ xml: json.xml as string, irmark: json.irmark as string, note: json.note as string });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the return XML.');
    } finally {
      setLoadingXml(false);
    }
  }

  async function file() {
    setPhase('filing'); setError(''); setPending(null);
    try {
      const res = await fetch(`/api/tax-studio/returns/${ret.id}/sa-submit`, { method: 'POST' });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (typeof json.isTest === 'boolean') setIsTest(json.isTest);
      if (!res.ok) throw new Error((json.error as string) || 'HMRC rejected the return.');
      if (json.accepted) {
        patch(r => ({
          ...r,
          approvalStatus: 'submitted', submittedAt: json.submittedAt as string, submissionRef: json.irmark as string,
          timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: json.submittedAt as string, kind: 'filed', label: `Filed SA100 to HMRC${json.isTest ? ' (TPVS test)' : ''} — IRmark ${json.irmark}` }],
        }));
      } else if (json.pending) {
        setPending({ irmark: json.irmark as string, message: (json.message as string) || 'Submitted — HMRC is still processing.' });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Filing failed.');
    } finally {
      setPhase('idle'); setConfirming(false);
    }
  }

  return (
    <StudioCard className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Landmark size={18} /></div>
        <div className="flex-1">
          <p className="text-[13.5px] font-bold text-[var(--text-primary)]">File SA100 online with HMRC</p>
          <p className="text-[11.5px] text-[var(--text-muted)]">Submit the full SA100 return to HMRC’s online filing service.</p>
        </div>
        {isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Test</span>}
      </div>

      <div className="px-5 py-4">
        <RequiredFieldsBanner issues={issues} />
        {credsConfigured === false && (
          <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
            <AlertTriangle size={13} /> HMRC filing isn’t fully set up yet. Check{' '}
            <a href="/settings?tab=sa-filing" className="font-semibold underline">Settings → Tax Studio</a>.
          </p>
        )}
        {!approved && (
          <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
            <AlertTriangle size={13} /> Record client approval before filing.
          </p>
        )}
        {!ret.utr && (
          <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
            <AlertTriangle size={13} /> A UTR is required before the SA100 can be filed.
          </p>
        )}

        {pending ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-800"><Loader2 size={14} className="animate-spin" /> Submitted — awaiting HMRC</p>
            <p className="mt-0.5 text-[11.5px] text-amber-700">{pending.message}</p>
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">IRmark {pending.irmark}</p>
          </div>
        ) : !confirming ? (
          <button onClick={() => setConfirming(true)} disabled={!canFile} className="btn-primary w-full justify-center disabled:opacity-40">
            <Send size={15} /> File SA100 to HMRC
          </button>
        ) : (
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-rose-800"><AlertTriangle size={14} /> This files {ret.clientName}’s {ret.taxYear} SA100 with HMRC.</p>
            <p className="mt-0.5 text-[11.5px] text-rose-700">A live submission cannot be undone{isTest ? ' (currently in TPVS test mode — no real filing)' : ''}.</p>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => setConfirming(false)} className="btn-secondary bg-white">Cancel</button>
              <button onClick={file} disabled={phase === 'filing'} className="btn-primary flex-1 justify-center">
                {phase === 'filing' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Confirm &amp; file
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}

        <button onClick={previewXml} disabled={loadingXml} className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-50">
          {loadingXml ? <Loader2 size={13} className="animate-spin" /> : <Code2 size={13} />} Preview filing XML
        </button>

        <p className="mt-3 text-[10.5px] text-[var(--text-muted)]">
          Files the SA100 (with any supplementary pages) to HMRC’s Transaction Engine as a GovTalk submission, signed with an IRmark. Requires the firm’s Government Gateway SA-agent credentials and the client’s 64-8 authorisation. Currently in TPVS test mode until HMRC recognition is granted. For clients on Making Tax Digital, use the MTD IT tool instead.
        </p>
      </div>

      {xml && <XmlViewer data={xml} clientName={ret.clientName} onClose={() => setXml(null)} />}
    </StudioCard>
  );
}

// ─── Filing-XML preview (generation only — nothing sent to HMRC) ──────────────
function XmlViewer({ data, clientName, onClose }: { data: { xml: string; irmark: string; note: string }; clientName: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3">
          <Code2 size={16} className="text-[var(--accent)]" />
          <div className="flex-1">
            <p className="text-[13px] font-bold text-[var(--text-primary)]">Filing XML preview — {clientName}</p>
            <p className="text-[11px] text-[var(--text-muted)]">The SA100 return that would be filed. IRmark {data.irmark}</p>
          </div>
          <button onClick={() => navigator.clipboard?.writeText(data.xml)} className="btn-secondary text-[11px]">Copy</button>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
          <pre className="whitespace-pre text-[10.5px] leading-snug text-slate-700">{data.xml}</pre>
        </div>
        <p className="border-t border-black/5 px-5 py-2 text-[10.5px] text-amber-700">{data.note}</p>
      </div>
    </div>
  );
}

// ─── Manual / paper filing ───────────────────────────────────────────────────
function ManualCard({ patch, approved, issues, taxYear, id }: { patch: Patch; approved: boolean; issues: FieldIssue[]; taxYear: string; id: string }) {
  const canFile = approved && issues.length === 0;
  const [open, setOpen] = useState(false);
  function markFiled() {
    const ref = `MAN-${taxYear.replace('/', '')}-${Math.abs(hash(id)).toString().slice(0, 6)}`;
    patch(r => ({
      ...r,
      approvalStatus: 'submitted', submittedAt: new Date().toISOString(), submissionRef: ref,
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'filed', label: `Recorded as filed (manual) — ${ref}` }],
    }));
  }
  return (
    <StudioCard className="p-4">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 text-left">
        <PenLine size={15} className="text-[var(--text-muted)]" />
        <span className="flex-1 text-[13px] font-semibold text-[var(--text-primary)]">Record filing manually</span>
        <ChevronDown size={15} className={`text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 border-t border-black/5 pt-3">
          <p className="text-[12px] text-[var(--text-muted)]">For clients not on MTD for Income Tax (filed via HMRC online or on paper), record the return as filed here to complete the workflow.</p>
          <RequiredFieldsBanner issues={issues} />
          <button onClick={markFiled} disabled={!canFile} className="btn-secondary mt-2 disabled:opacity-40"><CheckCircle2 size={14} /> Mark as filed</button>
        </div>
      )}
    </StudioCard>
  );
}

// ─── Filed success view ──────────────────────────────────────────────────────
function SuccessView({ ret }: { ret: TaxReturn }) {
  return (
    <StudioCard className="overflow-hidden">
      <div className="relative flex flex-col items-center gap-3 px-8 py-10 text-center" style={{ background: 'linear-gradient(140deg,#4F46E5 0%,#7C3AED 100%)' }}>
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur"><FileCheck2 size={28} className="text-white" /></div>
        <h2 className="text-xl font-bold text-white">Return filed</h2>
        <p className="max-w-sm text-[13px] text-white/85">{ret.clientName}&apos;s {ret.taxYear} return has been recorded as filed with HMRC.</p>
        {ret.submissionRef && <span className="rounded-full bg-white/20 px-3 py-1 text-[12px] font-bold text-white backdrop-blur">{ret.submissionRef}</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 px-8 py-6 sm:grid-cols-3">
        <Receipt icon={CheckCircle2} label="Submission" sub={ret.submittedAt ? fmtDateUK(ret.submittedAt) : '—'} />
        <Receipt icon={Archive} label="Archived" sub="Snapshot stored" />
        <Receipt icon={Lock} label="Locked" sub="Version snapshot taken" />
      </div>
    </StudioCard>
  );
}

function Receipt({ icon: Icon, label, sub }: { icon: typeof CheckCircle2; label: string; sub: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-white/60 py-4 text-center">
      <Icon size={18} className="text-[var(--accent)]" />
      <p className="text-[12px] font-semibold text-[var(--text-primary)]">{label}</p>
      <p className="text-[11px] text-[var(--text-muted)]">{sub}</p>
    </div>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}
