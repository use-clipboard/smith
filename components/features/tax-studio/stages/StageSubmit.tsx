'use client';

import { useState } from 'react';
import {
  Send, CheckCircle2, Loader2, ShieldCheck, Archive, Lock, FileCheck2,
  Landmark, Sparkles, AlertTriangle, ChevronDown, PenLine,
} from 'lucide-react';
import { StudioCard, SectionTitle } from '../primitives';
import { fmtDateUK, fmtMoney } from '../data';
import { computeSa100Full } from '../calc';
import { collectFraudData } from '@/lib/hmrc/clientFraudData';
import { hmrcCalculate, hmrcSubmitFinal, type HmrcCalcResponse } from '../persistence';
import type { TaxReturn } from '../types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

export default function StageSubmit({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  const submitted = ret.approvalStatus === 'submitted';
  const approved = ret.approvalStatus === 'approved' || submitted;

  if (submitted) return <SuccessView ret={ret} />;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ReadinessCard ret={ret} approved={approved} />
      <LiveHmrcCard ret={ret} patch={patch} approved={approved} />
      <ManualCard patch={patch} approved={approved} taxYear={ret.taxYear} id={ret.id} />
    </div>
  );
}

// ─── Readiness checklist ─────────────────────────────────────────────────────
function ReadinessCard({ ret, approved }: { ret: TaxReturn; approved: boolean }) {
  const checks = [
    { ok: ret.stageStatus.review === 'complete', label: 'Review complete' },
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
    </StudioCard>
  );
}

// ─── Live HMRC (MTD ITSA final declaration) ──────────────────────────────────
function LiveHmrcCard({ ret, patch, approved }: { ret: TaxReturn; patch: Patch; approved: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'calculating' | 'submitting'>('idle');
  const [calc, setCalc] = useState<HmrcCalcResponse | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const ours = computeSa100Full(ret.income, ret.taxYear);

  async function runCalc() {
    setPhase('calculating'); setError(''); setCalc(null); setConfirming(false);
    try {
      const fd = await collectFraudData();
      setCalc(await hmrcCalculate(ret.id, fd));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'HMRC calculation failed.');
    } finally {
      setPhase('idle');
    }
  }

  async function submitDeclaration() {
    if (!calc?.calculationId) return;
    setPhase('submitting'); setError('');
    try {
      const fd = await collectFraudData();
      const res = await hmrcSubmitFinal(ret.id, calc.calculationId, fd);
      patch(r => ({
        ...r,
        approvalStatus: 'submitted', submittedAt: res.submittedAt, submissionRef: res.submissionRef,
        timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: res.submittedAt, kind: 'filed', label: `Filed final declaration to HMRC${res.isTest ? ' (sandbox)' : ''} — ${res.submissionRef}` }],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'HMRC final declaration failed.');
      setConfirming(false);
    } finally {
      setPhase('idle');
    }
  }

  return (
    <StudioCard className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Landmark size={18} /></div>
        <div className="flex-1">
          <p className="text-[13.5px] font-bold text-[var(--text-primary)]">File with HMRC (Making Tax Digital)</p>
          <p className="text-[11.5px] text-[var(--text-muted)]">Trigger HMRC’s calculation, review it, then submit the final declaration.</p>
        </div>
        {calc?.isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Sandbox</span>}
      </div>

      <div className="px-5 py-4">
        {!approved && (
          <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700">
            <AlertTriangle size={13} /> Record client approval before filing.
          </p>
        )}

        {/* Step 1 — calculate */}
        {!calc ? (
          <button onClick={runCalc} disabled={!approved || phase === 'calculating'} className="btn-primary w-full justify-center disabled:opacity-40">
            {phase === 'calculating' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {phase === 'calculating' ? 'Asking HMRC…' : 'Calculate with HMRC'}
          </button>
        ) : (
          <>
            {/* HMRC vs our figures */}
            <div className="grid grid-cols-2 gap-3">
              <FigureCol title="HMRC calculation" rows={[
                ['Total income tax & NIC', calc.summary?.totalIncomeTaxAndNicsDue],
                ['Income tax', calc.summary?.incomeTaxDue],
                ['Class 4 NIC', calc.summary?.class4NicDue],
              ]} accent />
              <FigureCol title="Our computation" rows={[
                ['Total income tax & NIC', ours.incomeTax + ours.class4Nic],
                ['Income tax', ours.incomeTax],
                ['Class 4 NIC', ours.class4Nic],
              ]} />
            </div>
            {!calc.retrieved && (
              <p className="mt-2 text-[11px] text-amber-700">HMRC accepted the request but the calculation is still processing — re-run to refresh the figures.</p>
            )}
            <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">HMRC calc id: {calc.calculationId}</p>

            {/* Step 2 — final declaration */}
            {!confirming ? (
              <div className="mt-3 flex items-center gap-2">
                <button onClick={runCalc} disabled={phase === 'calculating'} className="btn-secondary">{phase === 'calculating' ? <Loader2 size={14} className="animate-spin" /> : null} Recalculate</button>
                <button onClick={() => setConfirming(true)} className="btn-primary flex-1 justify-center"><Send size={15} /> Submit final declaration</button>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-rose-800"><AlertTriangle size={14} /> This is the final, legally-binding declaration.</p>
                <p className="mt-0.5 text-[11.5px] text-rose-700">Submitting crystallises {ret.clientName}’s {ret.taxYear} liability with HMRC and cannot be undone{calc.isTest ? ' (sandbox — no real filing)' : ''}.</p>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => setConfirming(false)} className="btn-secondary bg-white">Cancel</button>
                  <button onClick={submitDeclaration} disabled={phase === 'submitting'} className="btn-primary flex-1 justify-center">
                    {phase === 'submitting' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Confirm &amp; file
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}

        <p className="mt-3 text-[10.5px] text-[var(--text-muted)]">
          Reuses your HMRC Income Tax (MTD) connection. Requires the client to be signed up for MTD for Income Tax with a valid NINO, and their quarterly &amp; annual updates already submitted. Uses Individual Calculations API v8.0 (intent-to-finalise → final declaration); confirm the calculation response fields against the HMRC sandbox before a live filing.
        </p>
      </div>
    </StudioCard>
  );
}

function FigureCol({ title, rows, accent }: { title: string; rows: [string, number | null | undefined][]; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${accent ? 'border-[var(--accent)]/40 bg-[var(--accent)]/[0.04]' : 'border-[var(--border)] bg-white/60'}`}>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      {rows.map(([label, val], i) => (
        <div key={i} className="flex items-center justify-between py-0.5">
          <span className="text-[11.5px] text-[var(--text-muted)]">{label}</span>
          <span className={`text-[12px] font-semibold ${i === 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{val == null ? '—' : fmtMoney(val)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Manual / paper filing ───────────────────────────────────────────────────
function ManualCard({ patch, approved, taxYear, id }: { patch: Patch; approved: boolean; taxYear: string; id: string }) {
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
          <button onClick={markFiled} disabled={!approved} className="btn-secondary mt-2 disabled:opacity-40"><CheckCircle2 size={14} /> Mark as filed</button>
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
