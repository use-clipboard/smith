'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Plus, Loader2, ChevronRight } from 'lucide-react';
import WizardStepper from './WizardStepper';
import StepReturnType from './StepReturnType';
import StepSelectClient from './StepSelectClient';
import StepTaxYear from './StepTaxYear';
import StepRollForward from './StepRollForward';
import StepConfirm from './StepConfirm';
import {
  ROLL_CATEGORIES, categoryHasData, rollForwardIncome, entityLabelForBusinessType,
  type RollKey, type WizardClient,
} from './wizardData';
import {
  buildReturn, currentFilingSeason, seedConnectedSources, returnType, emptyIncome,
} from '../data';
import { listReturns, type ReturnListItem } from '../persistence';
import type { ReturnTypeId, TaxReturn } from '../types';

function initialRoll(): Record<RollKey, boolean> {
  const r = {} as Record<RollKey, boolean>;
  for (const c of ROLL_CATEGORIES) r[c.key] = c.key === 'personal';
  return r;
}

export default function NewReturnWizard({
  onStart, onBack,
}: {
  onStart: (r: TaxReturn) => Promise<void>;
  onBack: () => void;
}) {
  const [step, setStep] = useState(1);
  const [furthest, setFurthest] = useState(1);
  const [returnTypeId, setReturnTypeId] = useState<ReturnTypeId>('sa100');
  const [client, setClient] = useState<WizardClient | null>(null);
  const [taxYear, setTaxYear] = useState(currentFilingSeason().taxYear);
  const [roll, setRoll] = useState<Record<RollKey, boolean>>(initialRoll);
  const [allReturns, setAllReturns] = useState<ReturnListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    listReturns().then(rs => { if (!cancelled) setAllReturns(rs); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const priorReturn = useMemo(() => {
    if (!client) return null;
    const hist = allReturns.filter(r => r.ret.clientId === client.id).sort((a, b) => (a.ret.taxYear < b.ret.taxYear ? 1 : -1));
    return hist.find(h => h.ret.taxYear !== taxYear) ?? hist[0] ?? null;
  }, [client, allReturns, taxYear]);

  const priorIncome = priorReturn?.ret.income ?? null;
  const priorYear = priorReturn?.ret.taxYear ?? null;

  // Re-seed roll toggles whenever the client's prior data changes.
  useEffect(() => {
    const next = {} as Record<RollKey, boolean>;
    for (const c of ROLL_CATEGORIES) {
      next[c.key] = c.key === 'personal' ? true : (priorIncome ? categoryHasData(c.key, priorIncome) : false);
    }
    setRoll(next);
  }, [client?.id, priorIncome]);

  const seededIncome = useMemo(
    () => (priorIncome ? rollForwardIncome(priorIncome, roll) : emptyIncome()),
    [priorIncome, roll],
  );

  const rt = returnType(returnTypeId);
  const canContinue = step === 2 ? !!client : true;

  function goTo(n: number) {
    if (n < 1 || n > 5) return;
    setStep(n);
    setFurthest(f => Math.max(f, n));
  }

  function next() {
    if (!canContinue) return;
    if (step === 5) { void create(); return; }
    goTo(step + 1);
  }

  async function create() {
    if (!client) { setError('Select a client first.'); setStep(2); return; }
    setCreating(true); setError('');
    try {
      const base = buildReturn({
        clientId: client.id, clientRef: client.client_ref, clientName: client.name,
        returnType: returnTypeId, taxYear, utr: client.utr_number ?? null,
      });
      const now = new Date().toISOString();
      const built: TaxReturn = {
        ...base,
        income: seededIncome,
        entityLabel: entityLabelForBusinessType(client.business_type),
        connected: seedConnectedSources(),
        stageStatus: { setup: 'complete', analyse: 'active', review: 'upcoming', approval: 'upcoming', submit: 'upcoming' },
        timeline: priorYear ? [{ id: 't-rf', at: now, kind: 'imported', label: `Rolled forward from ${priorYear}` }] : [],
      };
      await onStart(built);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the return.');
      setCreating(false);
    }
  }

  // Header content per step.
  const header = (() => {
    switch (step) {
      case 1: return { title: 'Create New Return', sub: 'Let’s create your new tax return in just a few simple steps.' };
      case 2: return { title: 'Select Client', sub: 'Choose the individual or sole trader client you want to prepare a Self Assessment return for.' };
      case 3: return { title: client ? `New Return for ${client.name}` : 'Tax Year', sub: 'Choose the tax year for this return.' };
      case 4: return { title: client ? `New Return for ${client.name}` : 'Roll Forward', sub: 'Review last year’s data and choose what to roll forward.' };
      default: return { title: 'Review & Confirm', sub: 'One last look before we create the return.' };
    }
  })();

  const crumbs = ['Home', 'New Return'];
  if (step >= 2) crumbs.push(`${rt.label} (${rt.form})`);
  if (step >= 3 && client) crumbs.push(client.name);

  return (
    <div className="space-y-5">
      {/* Breadcrumb + header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-[var(--text-muted)]">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={11} />}
                <span className={i === crumbs.length - 1 ? 'font-semibold text-[var(--text-secondary)]' : ''}>{c}</span>
              </span>
            ))}
          </div>
          <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-[var(--text-primary)]">{header.title}</h2>
          <p className="text-[13px] text-[var(--text-secondary)]">{header.sub}</p>
        </div>
        <button onClick={onBack} className="btn-secondary bg-white"><X size={14} /> Cancel</button>
      </div>

      {/* Stepper */}
      <div className="rounded-2xl border border-white/60 bg-white/60 px-5 py-3.5 backdrop-blur-md">
        <WizardStepper current={step} furthest={furthest} onSelect={goTo} />
      </div>

      {/* Step body */}
      {step === 1 && <StepReturnType selected={returnTypeId} onSelect={setReturnTypeId} />}
      {step === 2 && <StepSelectClient returnTypeId={returnTypeId} selected={client} onSelect={setClient} allReturns={allReturns} />}
      {step === 3 && <StepTaxYear taxYear={taxYear} onChange={setTaxYear} client={client} allReturns={allReturns} />}
      {step === 4 && <StepRollForward priorYear={priorYear} priorIncome={priorIncome} roll={roll} onToggle={k => setRoll(r => ({ ...r, [k]: !r[k] }))} onSetAll={v => setRoll(r => { const n = { ...r }; for (const c of ROLL_CATEGORIES) if (c.key !== 'personal') n[c.key] = v && (priorIncome ? categoryHasData(c.key, priorIncome) : false); return n; })} client={client} />}
      {step === 5 && <StepConfirm returnTypeId={returnTypeId} client={client} taxYear={taxYear} seededIncome={seededIncome} roll={roll} hasPrior={!!priorIncome} />}

      {error && <p className="text-right text-[12px] font-medium text-red-600">{error}</p>}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button onClick={() => (step === 1 ? onBack() : goTo(step - 1))} className="btn-secondary bg-white text-[var(--text-primary)]">
          <ArrowLeft size={14} /> {step === 1 ? 'Back to command centre' : 'Back'}
        </button>
        <button onClick={next} disabled={!canContinue || creating} className="btn-primary disabled:opacity-40">
          {creating ? <Loader2 size={15} className="animate-spin" /> : step === 5 ? <Plus size={15} /> : null}
          {step === 5 ? (creating ? 'Creating…' : 'Create return') : 'Continue'}
          {!creating && step < 5 && <ArrowRight size={15} />}
        </button>
      </div>
    </div>
  );
}
