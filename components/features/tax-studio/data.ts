import {
  User, Building2, Users, Landmark, TrendingUp, Globe2,
  type LucideIcon,
} from 'lucide-react';
import type {
  TaxReturn, ReturnTypeId, StageId, StageState, ReturnStatus,
  Sa100Income, ConnectedSource, TaxSuggestion, ReviewPoint,
} from './types';
import { estimateSa100, employmentBenefits } from './calc';

// ─── Return types ────────────────────────────────────────────────────────────
export const RETURN_TYPES: {
  id: ReturnTypeId; form: string; label: string; blurb: string;
  icon: LucideIcon; entityLabel: string; enabled: boolean;
}[] = [
  { id: 'sa100',        form: 'SA100', label: 'Personal Tax',     blurb: 'Individuals & sole traders',   icon: User,      entityLabel: 'Individual',        enabled: true },
  { id: 'ct600',        form: 'CT600', label: 'Company Tax',      blurb: 'Limited companies',            icon: Building2, entityLabel: 'Limited company',   enabled: false },
  { id: 'sa800',        form: 'SA800', label: 'Partnership',      blurb: 'Partnerships & LLPs',          icon: Users,     entityLabel: 'Partnership',       enabled: false },
  { id: 'sa900',        form: 'SA900', label: 'Trust & Estate',   blurb: 'Trusts & estates',             icon: Landmark,  entityLabel: 'Trust',             enabled: false },
  { id: 'cgt',          form: 'CGT',   label: 'Capital Gains',    blurb: 'Standalone CGT reporting',     icon: TrendingUp,entityLabel: 'Individual',        enabled: false },
  { id: 'non_resident', form: 'SA109', label: 'Non-resident',     blurb: 'Non-resident individuals',     icon: Globe2,    entityLabel: 'Non-resident',      enabled: false },
];

export function returnType(id: ReturnTypeId) {
  return RETURN_TYPES.find(r => r.id === id) ?? RETURN_TYPES[0];
}

// ─── Stages ──────────────────────────────────────────────────────────────────
export const STAGES: { id: StageId; label: string; blurb: string }[] = [
  { id: 'setup',    label: 'Setup',            blurb: 'Year, return type & connected data' },
  { id: 'analyse',  label: 'Analyse',          blurb: 'SMITH pulls figures from every module' },
  { id: 'review',   label: 'Review & Adjust',  blurb: 'Check figures, risks & opportunities' },
  { id: 'approval', label: 'Client Approval',  blurb: 'Approval pack & e-signature' },
  { id: 'submit',   label: 'Submit',           blurb: 'File to HMRC & archive' },
];

export const ALL_STAGES: StageId[] = ['setup', 'analyse', 'review', 'approval', 'submit'];

export function freshStageStatus(active: StageId): Record<StageId, StageState> {
  const idx = ALL_STAGES.indexOf(active);
  const map = {} as Record<StageId, StageState>;
  ALL_STAGES.forEach((s, i) => { map[s] = i < idx ? 'complete' : i === idx ? 'active' : 'upcoming'; });
  return map;
}

// ─── Workflow status metadata ────────────────────────────────────────────────
export const STATUS_META: Record<ReturnStatus, { label: string; tone: string }> = {
  'not-started':       { label: 'Not started',       tone: 'bg-slate-100 text-slate-600' },
  'waiting-info':      { label: 'Waiting information', tone: 'bg-amber-100 text-amber-700' },
  'analysing':         { label: 'Analysing',          tone: 'bg-sky-100 text-sky-700' },
  'review':            { label: 'Review required',    tone: 'bg-indigo-100 text-indigo-700' },
  'awaiting-approval': { label: 'Awaiting approval',  tone: 'bg-violet-100 text-violet-700' },
  'approved':          { label: 'Approved',           tone: 'bg-teal-100 text-teal-700' },
  'ready-to-file':     { label: 'Ready to file',      tone: 'bg-cyan-100 text-cyan-700' },
  'filed':             { label: 'Filed',              tone: 'bg-emerald-100 text-emerald-700' },
  'amended':           { label: 'Amended',            tone: 'bg-orange-100 text-orange-700' },
  'archived':          { label: 'Archived',           tone: 'bg-slate-100 text-slate-500' },
};

/** Kanban column order. */
export const WORKFLOW_COLUMNS: ReturnStatus[] = [
  'not-started', 'waiting-info', 'analysing', 'review', 'awaiting-approval', 'approved', 'ready-to-file', 'filed',
];

/** Derive the headline status from the approval lifecycle + stage progress. */
export function deriveStatus(r: TaxReturn): ReturnStatus {
  if (r.approvalStatus === 'submitted') return r.amended ? 'amended' : 'filed';
  if (r.approvalStatus === 'approved') return 'approved';
  if (r.approvalStatus === 'sent') return 'awaiting-approval';
  const done = (s: StageId) => r.stageStatus[s] === 'complete';
  if (done('review')) return 'ready-to-file';
  if (r.stageStatus.review === 'active' || done('analyse')) return 'review';
  if (r.stageStatus.analyse === 'active') return 'analysing';
  if (done('setup')) return 'waiting-info';
  return 'not-started';
}

export function stageProgress(r: TaxReturn): number {
  return ALL_STAGES.filter(s => r.stageStatus[s] === 'complete').length;
}

// ─── Tax season ──────────────────────────────────────────────────────────────
/** UK tax year label for a date, e.g. 6 Apr 2025–5 Apr 2026 → '2025/26'. */
export function taxYearLabelFor(d: Date): string {
  const y = d.getFullYear();
  // After 5 April the current tax year started this calendar year.
  const startYear = (d.getMonth() > 3 || (d.getMonth() === 3 && d.getDate() >= 6)) ? y : y - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The most recently completed tax year — the one currently being filed. */
export function currentFilingSeason(now = new Date()): { taxYear: string; deadline: Date; daysToDeadline: number } {
  // The tax year that ended on the most recent 5 April.
  const y = now.getFullYear();
  const endedThisYear = (now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6));
  const endYear = endedThisYear ? y : y - 1; // year the 5 Apr fell in
  const startYear = endYear - 1;
  const taxYear = `${startYear}/${String(endYear % 100).padStart(2, '0')}`;
  // Online filing deadline: 31 January following the tax year end.
  const deadline = new Date(endYear + 1, 0, 31);
  const daysToDeadline = Math.round((deadline.getTime() - now.getTime()) / 86400000);
  return { taxYear, deadline, daysToDeadline };
}

/** Online filing deadline (31 Jan following the tax year end) for a tax-year label. */
export function deadlineForTaxYear(taxYear: string): Date {
  const startYear = parseInt(taxYear.slice(0, 4), 10);
  // Tax year 2024/25 ends 5 Apr 2025 → deadline 31 Jan 2026 = startYear + 2.
  return new Date(Number.isNaN(startYear) ? 2026 : startYear + 2, 0, 31);
}

/** Options for the tax-year selector — current filing year plus the four prior. */
export function taxYearOptions(now = new Date()): string[] {
  const cur = currentFilingSeason(now).taxYear;
  const startYear = parseInt(cur.slice(0, 4), 10);
  return Array.from({ length: 5 }, (_, i) => {
    const s = startYear - i;
    return `${s}/${String((s + 1) % 100).padStart(2, '0')}`;
  });
}

// ─── Formatting helpers ──────────────────────────────────────────────────────
export function fmtMoney(n: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP',
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  }).format(n);
}

/** ISO → dd-mm-yyyy (UK display, per firm convention). */
export function fmtDateUK(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// ─── Empty income shell ──────────────────────────────────────────────────────
export function emptyIncome(): Sa100Income {
  return {
    employment: [], selfEmployment: [], property: [],
    dividends: 0, savingsInterest: 0, pensionsIncome: 0, otherIncome: 0,
    giftAid: 0, pensionContributions: 0, studentLoanPlan: 0,
  };
}

// ─── Return factory ──────────────────────────────────────────────────────────
export interface NewReturnInput {
  clientId: string | null;
  clientRef: string | null;
  clientName: string;
  returnType: ReturnTypeId;
  taxYear: string;
  utr?: string | null;
  amended?: boolean;
  late?: boolean;
  context?: string;
}

export function buildReturn(input: NewReturnInput): TaxReturn {
  const rt = returnType(input.returnType);
  return {
    id: `tr-${input.clientId ?? 'demo'}-${input.taxYear.replace('/', '')}`,
    clientId: input.clientId,
    clientRef: input.clientRef,
    clientName: input.clientName,
    returnType: input.returnType,
    taxYear: input.taxYear,
    utr: input.utr ?? null,
    entityLabel: rt.entityLabel,
    preparedBy: '',
    amended: input.amended ?? false,
    late: input.late ?? false,
    context: input.context ?? '',
    status: 'not-started',
    stageStatus: freshStageStatus('setup'),
    income: emptyIncome(),
    reviewPoints: [],
    suggestions: [],
    scenarios: [],
    connected: [],
    timeline: [],
  };
}

// ─── Tax Health Score ────────────────────────────────────────────────────────
export interface HealthFactor { key: string; label: string; score: number; weight: number; note: string; }
export interface HealthResult { score: number; band: 'green' | 'amber' | 'red'; factors: HealthFactor[]; }

/** A weighted, explainable health score (0–100). Deterministic from the return. */
export function healthScore(r: TaxReturn): HealthResult {
  const linked = r.connected.filter(c => c.linked).length;
  const dataQuality = r.connected.length ? Math.round((linked / r.connected.length) * 100) : 40;
  const unresolved = r.reviewPoints.filter(p => !p.resolved && p.severity !== 'info').length;
  const reviewScore = r.stageStatus.review === 'complete' ? 100 : unresolved > 0 ? Math.max(30, 100 - unresolved * 20) : 70;
  const approvalScore = r.approvalStatus === 'approved' || r.approvalStatus === 'submitted' ? 100 : r.approvalStatus === 'sent' ? 60 : 30;
  const analysed = r.stageStatus.analyse === 'complete' ? 100 : r.stageStatus.analyse === 'active' ? 55 : 20;
  const planning = r.suggestions.length === 0 ? 65 : r.suggestions.every(s => s.appliedToSandbox) ? 100 : 75;

  const factors: HealthFactor[] = [
    { key: 'data',     label: 'Connected data quality', score: dataQuality,   weight: 0.25, note: `${linked} of ${r.connected.length || '—'} modules linked` },
    { key: 'analysis', label: 'AI analysis complete',   score: analysed,      weight: 0.2,  note: r.stageStatus.analyse === 'complete' ? 'Figures imported' : 'Analysis pending' },
    { key: 'review',   label: 'Review completion',      score: reviewScore,   weight: 0.25, note: unresolved ? `${unresolved} point(s) to resolve` : 'No open review points' },
    { key: 'approval', label: 'Client approval',        score: approvalScore, weight: 0.2,  note: r.approvalStatus ?? 'Not yet sent' },
    { key: 'planning', label: 'Planning considered',    score: planning,      weight: 0.1,  note: r.suggestions.length ? `${r.suggestions.length} opportunity(ies)` : 'No opportunities flagged' },
  ];
  const score = Math.round(factors.reduce((a, f) => a + f.score * f.weight, 0));
  const band: HealthResult['band'] = score >= 85 ? 'green' : score >= 60 ? 'amber' : 'red';
  return { score, band, factors };
}

// ─── Next Best Action ────────────────────────────────────────────────────────
export interface NextAction { label: string; detail: string; stage: StageId; }

export function nextBestAction(r: TaxReturn): NextAction {
  if (r.approvalStatus === 'approved') return { label: 'File with HMRC', detail: 'The client has approved — submit the return.', stage: 'submit' };
  if (r.approvalStatus === 'sent') return { label: 'Chase approval', detail: 'Approval pack sent — client hasn’t responded yet.', stage: 'approval' };
  if (r.stageStatus.review === 'complete') return { label: 'Send for approval', detail: 'Review is complete — generate the approval pack.', stage: 'approval' };
  const unresolved = r.reviewPoints.filter(p => !p.resolved && p.severity !== 'info');
  if (unresolved.length) return { label: `Resolve ${unresolved.length} review point(s)`, detail: unresolved[0].issue, stage: 'review' };
  if (r.stageStatus.analyse === 'complete') return { label: 'Review the figures', detail: 'Figures are in — check variances, risks and opportunities.', stage: 'review' };
  if (r.stageStatus.setup === 'complete') return { label: 'Analyse connected data', detail: 'Pull figures from Accounts Studio, Payroll and more.', stage: 'analyse' };
  return { label: 'Complete setup', detail: 'Confirm the tax year and connect the client’s data.', stage: 'setup' };
}

// ─── Demo intelligence seeds (Phase 1 scaffolding, clearly labelled in UI) ─────
/** Candidate connected sources for a client — Phase 1 returns a plausible,
 *  clearly-labelled snapshot. A later increment replaces `value`/`linked` with
 *  real cross-module reads. */
export function seedConnectedSources(): ConnectedSource[] {
  return [
    { id: 'mtd-it',          module: 'mtd-it',          label: 'MTD IT',           value: 'Not imported',      detail: 'Sole trader & rental income', linked: false },
    { id: 'accounts-studio', module: 'accounts-studio', label: 'Accounts Studio', value: 'No linked accounts', detail: 'Latest profit figure', linked: false },
    { id: 'bookkeeping',     module: 'bookkeeping',     label: 'Bookkeeping',      value: 'No linked ledger',  detail: 'Ledger P&L net profit', linked: false },
    { id: 'payroll',         module: 'p32',             label: 'Payroll',          value: 'No linked payroll', detail: 'Salary & benefits',     linked: false },
    { id: 'capture',         module: 'full-analysis',   label: 'Capture',          value: 'No linked entries', detail: 'Categorised transactions', linked: false },
    { id: 'landlord',        module: 'landlord',        label: 'Landlord Analysis',value: 'No linked schedule',detail: 'Rental figures',        linked: false },
    { id: 'billing',         module: 'billing',         label: 'Billing',          value: '—',                 detail: 'Outstanding invoices',  linked: false },
    { id: 'email',           module: 'email-triage',    label: 'Email Triage',     value: '—',                 detail: 'Latest correspondence', linked: false },
    { id: 'tasks',           module: 'tasks',           label: 'Tasks',            value: '—',                 detail: 'Outstanding queries',   linked: false },
    { id: 'ch',              module: 'ch-secretarial',  label: 'Companies House',  value: '—',                 detail: 'Officer changes',       linked: false },
  ];
}

/** Review points SMITH raises from the figures. Phase 1 derives a handful of
 *  common, explainable checks; a later increment adds variance analysis against
 *  the prior year and cross-module reconciliation. */
export function seedReviewPoints(income: Sa100Income): ReviewPoint[] {
  const est = estimateSa100(income);
  const out: ReviewPoint[] = [];
  if (est.totalIncome > 100000 && est.totalIncome < 125140) {
    out.push({
      id: 'pa-taper', area: 'Allowances', severity: 'serious', resolved: false,
      issue: 'Income falls in the personal-allowance taper',
      explanation: 'Between £100,000 and £125,140 the personal allowance is withdrawn at £1 for every £2, giving an effective marginal rate of 60%. A pension contribution may be highly efficient here.',
      suggestedFix: 'Consider a pension contribution to restore the personal allowance.',
    });
  }
  if ((income.dividends || 0) > 500) {
    out.push({
      id: 'div-check', area: 'Dividends', severity: 'minor', resolved: false,
      issue: 'Dividends exceed the £500 allowance',
      explanation: 'Confirm the dividend figure agrees to the company’s dividend vouchers and that the £500 allowance has been applied.',
    });
  }
  if (income.employment.some(e => employmentBenefits(e) > 0)) {
    out.push({
      id: 'p11d', area: 'Employment', severity: 'info', resolved: false,
      issue: 'Benefits in kind present',
      explanation: 'Ensure the P11D benefits agree to the employer’s submission and that any payrolled benefits are not double-counted.',
    });
  }
  if (est.balancingPayment > 1000) {
    out.push({
      id: 'poa', area: 'Payments on account', severity: 'info', resolved: false,
      issue: 'Payments on account will be due',
      explanation: 'As the balancing payment exceeds £1,000, HMRC will require payments on account towards next year unless a reduction claim applies.',
    });
  }
  return out;
}

/** Opportunity ideas SMITH proposes at Analyse. Phase 1 seeds a representative
 *  set with estimated savings; a later increment derives these from the figures
 *  and firm knowledge. */
export function seedSuggestions(income: Sa100Income): TaxSuggestion[] {
  const est = estimateSa100(income);
  const higherRate = est.totalIncome > 50270;
  const out: TaxSuggestion[] = [];
  if (higherRate) {
    out.push({
      id: 'pension', title: 'Increase pension contribution', category: 'Pension',
      estSaving: Math.min(4000, Math.round(est.balancingPayment * 0.2)), confidence: 78,
      reasoning: 'Income falls in the higher-rate band. A personal pension contribution extends the basic-rate band and attracts 40% relief.',
      legislation: 's.188–194 FA 2004', appliedToSandbox: false,
    });
  }
  if ((income.dividends || 0) > 500) {
    out.push({
      id: 'spouse-dividends', title: 'Transfer dividend-bearing shares to spouse', category: 'Remuneration',
      estSaving: 900, confidence: 62,
      reasoning: 'Unused basic-rate band / dividend allowance in a spouse could reduce dividend tax at the higher rate.',
      legislation: 's.626 ITTOIA 2005', appliedToSandbox: false,
    });
  }
  out.push({
    id: 'marriage-allowance', title: 'Claim Marriage Allowance', category: 'Allowances',
    estSaving: 252, confidence: 55,
    reasoning: 'If one partner is a non-taxpayer, up to 10% of the personal allowance can transfer to a basic-rate spouse.',
    legislation: 's.55A–55E ITA 2007', appliedToSandbox: false,
  });
  if (est.balancingPayment > 2000) {
    out.push({
      id: 'reduce-poa', title: 'Review payments on account', category: 'Cashflow',
      estSaving: 0, confidence: 70,
      reasoning: 'Where income is expected to fall, a claim to reduce payments on account can ease the client’s cashflow.',
      legislation: 's.59A TMA 1970', appliedToSandbox: false,
    });
  }
  return out;
}
