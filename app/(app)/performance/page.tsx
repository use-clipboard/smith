'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import SaveReportModal from '@/components/ui/SaveReportModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { consumePendingClient, peekPendingClient } from '@/lib/pendingClient';
import { consumePendingAnalysis, peekPendingAnalysis, type PendingAnalysisData } from '@/lib/bookkeeping/pendingAnalysis';
import ToolLayout from '@/components/ui/ToolLayout';
import PerformanceEditor, { getThemeColor } from '@/components/features/performance/PerformanceEditor';
import PerformanceHistory, { type PerformanceSeed } from '@/components/features/performance/PerformanceHistory';
import { Gauge, Check, ArrowLeft, ArrowRight, Sparkles, ShieldCheck, FileText, Activity, Save, Loader2, CheckCircle2, Circle, AlertCircle, UploadCloud, BookCopy, X } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { fileToBase64 } from '@/utils/fileUtils';

type AppState = 'idle' | 'loading' | 'success' | 'error';

export type CoverStyleId = 'gradient' | 'split' | 'minimal' | 'corporate';

export interface CoverOptions {
  showCover: boolean;
  showFirmLogo: boolean;
  clientLogoUrl: string | null;
  gradient: string;
  titleOverride?: string;
  periodOverride?: string;
  coverStyle?: CoverStyleId;
  firmLabel?: string;    // branding text shown where 'SMITH' used to be
  subtitle?: string;     // report subtitle, e.g. '${subtitleText}'
}

const DEFAULT_GRADIENT = 'linear-gradient(150deg,#0f2540 0%,#1a3558 50%,#1e4a82 100%)';

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  sole_trader: 'Sole Trader', partnership: 'Partnership',
  limited_company: 'Limited Company', rent: 'Rental Income',
  trust: 'Trust', charity: 'Charity', other: 'Business',
};

/** Generates a professional client-facing cover page (inline styles so it survives PDF rendering). */
function buildTitlePageHtml(
  businessName: string,
  businessType: string,
  trade: string,
  location: string,
  period: string,
  opts: { gradient?: string; firmLogoUrl?: string | null; clientLogoUrl?: string | null; titleOverride?: string; periodOverride?: string; coverStyle?: CoverStyleId; firmLabel?: string; subtitle?: string } = {},
): string {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const typeLabel = BUSINESS_TYPE_LABELS[businessType] || 'Business';
  const loc = location || 'United Kingdom';
  const gradient = opts.gradient || DEFAULT_GRADIENT;
  const tc = getThemeColor(gradient); // theme accent colour
  const displayTitle = opts.titleOverride !== undefined ? opts.titleOverride : businessName;
  const displayPeriod = opts.periodOverride !== undefined ? opts.periodOverride : period;
  const style = opts.coverStyle ?? 'gradient';
  const subtitleText = opts.subtitle?.trim() ?? '';
  const firmLabelHtml = opts.firmLabel?.trim()
    ? `<span style="font-size:12px;font-weight:800;letter-spacing:3px;text-transform:uppercase;">${opts.firmLabel.trim()}</span>`
    : '';

  // Logo helpers — dark bg variant inverts to white; light bg variant uses natural colours
  const firmDark  = opts.firmLogoUrl ? `<img src="${opts.firmLogoUrl}" alt="Firm logo" style="height:34px;max-width:130px;object-fit:contain;opacity:0.88;filter:brightness(0) invert(1);" />` : '';
  const firmLight = opts.firmLogoUrl ? `<img src="${opts.firmLogoUrl}" alt="Firm logo" style="height:32px;max-width:120px;object-fit:contain;" />` : '';
  const clientDark  = opts.clientLogoUrl ? `<div style="margin-bottom:24px;"><img src="${opts.clientLogoUrl}" alt="Client logo" style="height:44px;max-width:170px;object-fit:contain;background:rgba(255,255,255,0.1);padding:7px 12px;border-radius:6px;" /></div>` : '';
  const clientLight = opts.clientLogoUrl ? `<div style="margin-bottom:24px;"><img src="${opts.clientLogoUrl}" alt="Client logo" style="height:44px;max-width:170px;object-fit:contain;border-radius:6px;" /></div>` : '';

  const outerBase = `margin:-48px -48px 0;height:1123px;max-height:1123px;padding:0;position:relative;overflow:hidden;display:flex;`;

  // ── Split: coloured left panel + white right content ────────────────────────
  if (style === 'split') return `
<div class="force-page-start" style="${outerBase}flex-direction:row;background:#fff;">
  <div style="width:220px;background:${gradient};display:flex;flex-direction:column;padding:40px 28px;position:relative;flex-shrink:0;overflow:hidden;">
    <div style="position:absolute;top:-60px;left:-40px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,0.05);pointer-events:none;"></div>
    <div style="position:absolute;bottom:-40px;right:-60px;width:240px;height:240px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none;"></div>
    <span style="font-size:11px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,0.75);">${opts.firmLabel?.trim() || ''}</span>
    <div style="margin-top:auto;">${firmDark}${firmDark ? `<div style="height:10px;"></div>` : ''}<div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.35);">Performance Analysis</div></div>
  </div>
  <div style="flex:1;background:#fff;display:flex;flex-direction:column;justify-content:center;padding:56px 52px;">
    <div style="font-size:10px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:18px;">${subtitleText}</div>
    ${clientLight}
    <div style="font-size:42px;font-weight:800;line-height:1.1;color:${tc};margin-bottom:10px;font-family:Arial,sans-serif;">${displayTitle}</div>
    <div style="font-size:16px;color:#6b7280;font-weight:400;margin-bottom:48px;">${typeLabel}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;max-width:460px;border-top:1px solid #e5e7eb;">
      <div style="padding:13px 18px 13px 0;border-bottom:1px solid #f3f4f6;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:5px;">Analysis Period</div><div style="font-size:14px;font-weight:600;color:#111827;">${displayPeriod}</div></div>
      <div style="padding:13px 0 13px 18px;border-bottom:1px solid #f3f4f6;border-left:1px solid #f3f4f6;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:5px;">Business Trade</div><div style="font-size:14px;font-weight:600;color:#111827;">${trade}</div></div>
      <div style="padding:13px 18px 13px 0;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:5px;">Date Prepared</div><div style="font-size:14px;font-weight:600;color:#111827;">${date}</div></div>
      <div style="padding:13px 0 13px 18px;border-left:1px solid #f3f4f6;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:5px;">Trading Location</div><div style="font-size:14px;font-weight:600;color:#111827;">${loc}</div></div>
    </div>
    <div style="margin-top:auto;padding-top:36px;font-size:10px;color:#d1d5db;">Confidential — prepared for ${displayTitle}</div>
  </div>
</div>`;

  // ── Minimal: white with thin gradient top/bottom stripe ──────────────────────
  if (style === 'minimal') return `
<div class="force-page-start" style="${outerBase}flex-direction:column;background:#fff;">
  <div style="height:7px;background:${gradient};flex-shrink:0;"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;padding:28px 60px 0;flex-shrink:0;">
    <span style="font-size:12px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:${tc};">${opts.firmLabel?.trim() || ''}</span>
    ${firmLight}
  </div>
  <div style="height:1px;background:#e5e7eb;margin:20px 60px 0;flex-shrink:0;"></div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:40px 60px;">
    <div style="font-size:10px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:22px;">${subtitleText}</div>
    ${clientLight}
    <div style="font-size:50px;font-weight:800;line-height:1.05;color:${tc};margin-bottom:12px;font-family:Arial,sans-serif;max-width:560px;">${displayTitle}</div>
    <div style="font-size:18px;color:#6b7280;font-weight:400;margin-bottom:52px;">${typeLabel}</div>
    <div style="display:flex;gap:44px;flex-wrap:wrap;">
      <div><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:5px;">Analysis Period</div><div style="font-size:15px;font-weight:600;color:#111827;">${displayPeriod}</div></div>
      <div><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:5px;">Trade</div><div style="font-size:15px;font-weight:600;color:#111827;">${trade}</div></div>
      <div><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:5px;">Location</div><div style="font-size:15px;font-weight:600;color:#111827;">${loc}</div></div>
      <div><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:5px;">Date Prepared</div><div style="font-size:15px;font-weight:600;color:#111827;">${date}</div></div>
    </div>
  </div>
  <div style="height:4px;background:${gradient};flex-shrink:0;"></div>
  <div style="padding:18px 60px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
    <div style="font-size:10px;color:#d1d5db;">Confidential — prepared for ${displayTitle}</div>
    <div style="font-size:10px;color:#d1d5db;"></div>
  </div>
</div>`;

  // ── Corporate: gradient header band + white lower body with detail cards ─────
  if (style === 'corporate') return `
<div class="force-page-start" style="${outerBase}flex-direction:column;background:#fff;">
  <div style="background:${gradient};padding:44px 60px;min-height:380px;display:flex;flex-direction:column;position:relative;overflow:hidden;flex-shrink:0;">
    <div style="position:absolute;top:-80px;right:-80px;width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,0.05);pointer-events:none;"></div>
    <div style="position:absolute;bottom:-40px;left:40%;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none;"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span style="font-size:12px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,0.8);">${opts.firmLabel?.trim() || ''}</span>
      ${firmDark}
    </div>
    <div style="margin-top:auto;padding-top:36px;">
      <div style="font-size:10px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:14px;">${subtitleText}</div>
      ${clientDark}
      <div style="font-size:44px;font-weight:800;line-height:1.1;color:#fff;font-family:Arial,sans-serif;max-width:580px;">${displayTitle}</div>
      <div style="font-size:16px;color:rgba(255,255,255,0.65);margin-top:8px;">${typeLabel}</div>
    </div>
  </div>
  <div style="flex:1;background:#fff;padding:44px 60px;display:flex;flex-direction:column;justify-content:center;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:540px;">
      <div style="padding:18px 22px;border:1px solid #e5e7eb;border-radius:8px;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:7px;">Analysis Period</div><div style="font-size:15px;font-weight:600;color:#111827;">${displayPeriod}</div></div>
      <div style="padding:18px 22px;border:1px solid #e5e7eb;border-radius:8px;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:7px;">Business Trade</div><div style="font-size:15px;font-weight:600;color:#111827;">${trade}</div></div>
      <div style="padding:18px 22px;border:1px solid #e5e7eb;border-radius:8px;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:7px;">Date Prepared</div><div style="font-size:15px;font-weight:600;color:#111827;">${date}</div></div>
      <div style="padding:18px 22px;border:1px solid #e5e7eb;border-radius:8px;"><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;margin-bottom:7px;">Trading Location</div><div style="font-size:15px;font-weight:600;color:#111827;">${loc}</div></div>
    </div>
  </div>
  <div style="padding:18px 60px;border-top:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
    <div style="font-size:10px;color:#d1d5db;">Confidential — prepared for ${displayTitle}</div>
    <div style="font-size:10px;color:#d1d5db;"></div>
  </div>
</div>`;

  // ── Gradient (default): full bleed gradient, white text ───────────────────────
  return `
<div class="force-page-start" style="${outerBase}flex-direction:column;background:${gradient};color:#fff;">
  <div style="position:absolute;top:-120px;right:-100px;width:420px;height:420px;border-radius:50%;background:rgba(255,255,255,0.04);pointer-events:none;"></div>
  <div style="position:absolute;bottom:-80px;left:-60px;width:280px;height:280px;border-radius:50%;background:rgba(255,255,255,0.03);pointer-events:none;"></div>
  <div style="position:absolute;top:50%;left:-80px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,0.02);pointer-events:none;"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;padding:32px 56px 0;">
    <span style="font-size:13px;font-weight:800;letter-spacing:4px;text-transform:uppercase;opacity:0.9;">${opts.firmLabel?.trim() || ''}</span>
    <div style="display:flex;align-items:center;gap:14px;">${firmDark}<div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.4;">Performance Analysis</div></div>
  </div>
  <div style="margin:28px 56px 0;height:1px;background:rgba(255,255,255,0.12);"></div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:60px 56px 40px;">
    <div style="font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;opacity:0.5;margin-bottom:28px;">${subtitleText}</div>
    <div style="font-size:46px;font-weight:800;line-height:1.1;color:#fff;margin-bottom:10px;font-family:Arial,sans-serif;max-width:600px;">${displayTitle}</div>
    <div style="font-size:17px;opacity:0.6;font-weight:400;margin-bottom:${opts.clientLogoUrl ? '20px' : '56px'};">${typeLabel}</div>
    ${clientDark}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;max-width:540px;">
      <div style="padding:18px 24px 18px 0;border-top:1px solid rgba(255,255,255,0.13);"><div style="font-size:9px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;opacity:0.4;margin-bottom:6px;">Analysis Period</div><div style="font-size:15px;font-weight:600;opacity:0.95;">${displayPeriod}</div></div>
      <div style="padding:18px 0 18px 24px;border-top:1px solid rgba(255,255,255,0.13);border-left:1px solid rgba(255,255,255,0.13);"><div style="font-size:9px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;opacity:0.4;margin-bottom:6px;">Business Trade</div><div style="font-size:15px;font-weight:600;opacity:0.95;">${trade}</div></div>
      <div style="padding:18px 24px 18px 0;border-top:1px solid rgba(255,255,255,0.13);"><div style="font-size:9px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;opacity:0.4;margin-bottom:6px;">Date Prepared</div><div style="font-size:15px;font-weight:600;opacity:0.95;">${date}</div></div>
      <div style="padding:18px 0 18px 24px;border-top:1px solid rgba(255,255,255,0.13);border-left:1px solid rgba(255,255,255,0.13);"><div style="font-size:9px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;opacity:0.4;margin-bottom:6px;">Trading Location</div><div style="font-size:15px;font-weight:600;opacity:0.95;">${loc}</div></div>
    </div>
  </div>
  <div style="padding:24px 56px;border-top:1px solid rgba(255,255,255,0.10);display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:10px;opacity:0.3;letter-spacing:0.5px;">Confidential — prepared for ${displayTitle}</div>
    <div style="font-size:10px;opacity:0.3;letter-spacing:0.5px;"></div>
  </div>
</div>`;
}

const PERFORMANCE_SECTIONS = [
  { id: 'executive_summary',    label: 'Executive Summary',           description: 'Key insights and headline performance at a glance',        defaultOn: true  },
  { id: 'financial_performance', label: 'Financial Performance',       description: 'P&L analysis — revenue, costs and profitability',          defaultOn: true  },
  { id: 'margin_analysis',      label: 'Margin Analysis',             description: 'Gross, net and operating margin breakdown with trends',     defaultOn: true  },
  { id: 'comparative',          label: 'Year-on-Year Comparison',     description: 'Detailed variance vs prior period (if prior data uploaded)', defaultOn: true  },
  { id: 'kpi_dashboard',        label: 'KPI Dashboard',               description: 'Key performance indicators summary table',                  defaultOn: true  },
  { id: 'industry_benchmarking', label: 'Actual vs Industry Averages', description: 'KPI comparison against typical sector benchmarks',          defaultOn: true  },
  { id: 'swot',                 label: 'SWOT Analysis',               description: 'Strengths, Weaknesses, Opportunities and Threats',          defaultOn: true  },
  { id: 'budget_vs_actual',     label: 'Budget vs Actual',            description: 'Variance analysis against budgeted figures',                defaultOn: false },
  { id: 'cashflow_forecast',    label: 'Rolling Cashflow Forecast',   description: '12-month forward-looking cash flow projection',             defaultOn: false },
  { id: 'projections',          label: 'Forecasts & Projections',     description: '1, 3 and 5-year financial projections',                    defaultOn: false },
  { id: 'strategy_advice',      label: 'Performance Strategy Advice', description: 'Actionable recommendations to improve performance',         defaultOn: true  },
  { id: 'tax_strategy',         label: 'Tax Strategy Planning',       description: 'Tax efficiency opportunities and planning considerations',  defaultOn: false },
] as const;

type SectionId = typeof PERFORMANCE_SECTIONS[number]['id'];

// ── Setup-screen helpers ──────────────────────────────────────────────────────
const CURRENCIES = [
  { code: 'GBP', label: 'GBP (£)' },
  { code: 'EUR', label: 'EUR (€)' },
  { code: 'USD', label: 'USD ($)' },
  { code: 'AUD', label: 'AUD ($)' },
];
const CURRENCY_SYMBOL: Record<string, string> = { GBP: '£', EUR: '€', USD: '$', AUD: '$' };
const FREQ_LABELS: Record<string, string> = { yearly: 'Year', quarterly: 'Quarter', monthly: 'Month' };

// Build a readable period description from frequency + period-end when the user
// hasn't typed their own (e.g. "Year ending 31/12/2025").
function buildPeriodDesc(freq: string, end: string): string {
  const lbl = FREQ_LABELS[freq] ?? '';
  if (end) {
    const [y, m, d] = end.split('-');
    const human = d && m && y ? `${d}/${m}/${y}` : end;
    return `${lbl ? lbl + ' ending ' : ''}${human}`.trim();
  }
  return lbl;
}

// Hand-tuned section presets keyed off business type + trade. Honest heuristics —
// a smart default, not a claim of mining "similar businesses".
function recommendSections(type: string, trade: string): { ids: SectionId[]; why: string } {
  const t = (trade || '').toLowerCase();
  const base: SectionId[] = ['executive_summary', 'financial_performance', 'kpi_dashboard', 'margin_analysis', 'industry_benchmarking', 'comparative', 'swot', 'strategy_advice'];
  const ids = new Set<SectionId>(base);
  let why = 'A balanced default — performance, margins, KPIs and benchmarking — the core of a useful management report.';

  if (type === 'rent' || /rent|propert|landlord|estate/.test(t)) {
    ids.delete('margin_analysis');
    ids.add('cashflow_forecast');
    why = 'For property / rental income we focus on cashflow and benchmarking rather than trading margins.';
  } else if (/shop|retail|store|cafe|restaurant|bar|pub|food|product|manufactur|wholesale/.test(t)) {
    ids.add('budget_vs_actual');
    why = 'For a product / retail business, budget-vs-actual and margin analysis matter most alongside the core KPIs.';
  } else if (/consult|plumb|electric|legal|account|agency|service|build|joiner|garage|salon|clinic|dental/.test(t)) {
    why = 'For a service business we prioritise margins, KPIs and strategy advice over inventory / budget sections.';
  }
  if (type === 'limited_company') ids.add('tax_strategy');

  // Preserve the canonical section order.
  return { ids: PERFORMANCE_SECTIONS.map(s => s.id).filter(id => ids.has(id)), why };
}

const PERF_STEPS = ['Business Details', 'Select Sections', 'Management Accounts', 'Generate Report'];
function PerfStepper({ current, onStep }: { current: number; onStep?: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {PERF_STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : 'todo';
        return (
          <div key={s} className="flex items-center shrink-0">
            <button type="button" onClick={() => onStep?.(n)} className="flex items-center">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                state === 'active' ? 'bg-[var(--accent)] text-white'
                  : state === 'done' ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                  : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'
              }`}>{state === 'done' ? <Check size={14} /> : n}</span>
              <span className={`ml-2 text-sm font-medium whitespace-nowrap ${
                state === 'active' ? 'text-[var(--accent)]'
                  : state === 'done' ? 'text-[var(--text-secondary)]'
                  : 'text-[var(--text-muted)]'
              }`}>{s}</span>
            </button>
            {i < PERF_STEPS.length - 1 && <div className="w-8 sm:w-14 h-0.5 rounded bg-slate-300 mx-2 sm:mx-3" />}
          </div>
        );
      })}
    </div>
  );
}

// ── Document "package" upload (Accounts-Review style) ─────────────────────────
type PerfDocCat = 'management_accounts' | 'prior_period' | 'prior_analysis' | 'other';
type PerfDoc = { id: string; file: File; cat: PerfDocCat };
const PERF_REQUIRED_CATS: { key: PerfDocCat; label: string }[] = [
  { key: 'management_accounts', label: 'Management Accounts' },
];
const PERF_OPTIONAL_CATS: { key: PerfDocCat; label: string }[] = [
  { key: 'prior_period', label: 'Prior Period Accounts' },
  { key: 'prior_analysis', label: 'Prior Analysis / Reports' },
];
const PERF_ALL_CATS = [...PERF_REQUIRED_CATS, ...PERF_OPTIONAL_CATS];

// Guess a document's category from its filename. Defaults to management accounts
// (the main upload). Re-taggable in the UI.
function detectPerfCat(name: string): PerfDocCat {
  const n = name.toLowerCase();
  if (/prior|previous|comparativ|last\s*year/.test(n)) {
    return /analysis|report|review|commentary/.test(n) ? 'prior_analysis' : 'prior_period';
  }
  if (/analysis|report|review|commentary/.test(n)) return 'prior_analysis';
  return 'management_accounts';
}

function PerfReadyRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {done ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" /> : <Circle size={18} className="text-[var(--text-muted)] shrink-0" />}
      <span className={`text-sm ${done ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{label}</span>
    </div>
  );
}

// ── Page wrapper: history dashboard or tool ─────────────────────────────────
export default function PerformancePage() {
  // Skip the history view when arriving via a Quick Launch pill (pending client present).
  const [view, setView] = useState<'history' | 'tool'>(
    () => (peekPendingClient('/performance') || peekPendingAnalysis('/performance')) ? 'tool' : 'history',
  );
  const [seed, setSeed] = useState<PerformanceSeed | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
      .catch(() => {/* ignore */});
  }, []);

  // Subsequent pill clicks while the tab is already open
  useEffect(() => {
    function onPending(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/performance') return;
      setSeed(null);
      setView('tool');
    }
    window.addEventListener('smith:pending-client', onPending);
    window.addEventListener('smith:pending-analysis', onPending);
    return () => {
      window.removeEventListener('smith:pending-client', onPending);
      window.removeEventListener('smith:pending-analysis', onPending);
    };
  }, []);

  return view === 'history' ? (
    <PerformanceHistory
      currentUserId={me.userId}
      isAdmin={me.userRole === 'admin'}
      onNew={() => { setSeed(null); setView('tool'); }}
      onOpen={s => { setSeed(s); setView('tool'); }}
    />
  ) : (
    <PerformanceTool seed={seed} onBack={() => { setSeed(null); setView('history'); }} />
  );
}

function BackToHistory({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 mb-3 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] drop-shadow-sm transition-colors"
    >
      <ArrowLeft size={13} />
      Back to history
    </button>
  );
}

function PerformanceTool({ seed, onBack }: { seed: PerformanceSeed | null; onBack: () => void }) {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/performance', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [paBusinessName, setPaBusinessName] = useState('');
  const [paBusinessType, setPaBusinessType] = useState('');
  const [paBusinessTrade, setPaBusinessTrade] = useState('');
  const [paTradingLocation, setPaTradingLocation] = useState('');
  const [paRelevantInfo, setPaRelevantInfo] = useState('');
  const [paAnalysisPeriod, setPaAnalysisPeriod] = useState('');
  const [paAnalysisPeriodDescription, setPaAnalysisPeriodDescription] = useState('');
  const [paReportingPeriodEnd, setPaReportingPeriodEnd] = useState('');
  const [paCurrency, setPaCurrency] = useState('GBP');
  const [sectionsCustomized, setSectionsCustomized] = useState(false);
  const [chartDataJson, setChartDataJson] = useState('');
  // Save & continue
  const [savedOutputId, setSavedOutputId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    if (!saveToast) return;
    const t = setTimeout(() => setSaveToast(null), 4000);
    return () => clearTimeout(t);
  }, [saveToast]);

  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);

  // Management figures handed over from the SMITH Bookkeeping tool (TB/P&L/BS as
  // text). When present they stand in for uploaded management accounts.
  const [bookkeeping, setBookkeeping] = useState<PendingAnalysisData | null>(null);
  const bookkeepingStatementsText = bookkeeping
    ? [bookkeeping.current.combined, bookkeeping.prior?.combined].filter(Boolean).join('\n\n\n')
    : undefined;

  // ── Seed loader: when opened from history, hydrate the success view
  const seedLoadedRef = useRef(false);
  useEffect(() => {
    if (!seed || seedLoadedRef.current) return;
    seedLoadedRef.current = true;
    if (seed.client) {
      setSelectedClient({
        id: seed.client.id,
        name: seed.client.name,
        client_ref: seed.client.client_ref,
        business_type: seed.client.business_type ?? null,
        vat_number: seed.client.vat_number ?? null,
        status: 'active',
      });
    }
    setPaBusinessName(seed.paBusinessName ?? '');
    setPaBusinessType(seed.paBusinessType ?? '');
    setPaBusinessTrade(seed.paBusinessTrade ?? '');
    setPaTradingLocation(seed.paTradingLocation ?? '');
    setPaRelevantInfo(seed.paRelevantInfo ?? '');
    setPaAnalysisPeriod(seed.paAnalysisPeriod ?? '');
    setPaAnalysisPeriodDescription(seed.paAnalysisPeriodDescription ?? '');
    setSelectedSections((seed.selectedSections ?? []) as SectionId[]);
    setSectionsCustomized(true); // restored sections — don't let the preset effect overwrite them
    setReportHtml(seed.reportHtml ?? '');
    setEditorHtml(seed.editorHtml ?? seed.reportHtml ?? '');
    setTitlePageHtml(seed.titlePageHtml ?? '');
    setStoredPeriod(seed.paAnalysisPeriodDescription ?? '');
    setChartDataJson(seed.chartDataJson ?? '');
    setSavedOutputId(seed.id);
    setAppState('success');
  }, [seed]);

  // ── Quick Launch: pre-fill client from client detail page ──────────────────
  useEffect(() => {
    const pending = consumePendingClient('/performance');
    if (pending) { setSelectedClient(pending); return; }
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/performance') return;
      const p = consumePendingClient('/performance');
      if (p) setSelectedClient(p);
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);

  // ── Launch from Bookkeeping: pre-fill management figures + period ───────────
  useEffect(() => {
    function apply(d: PendingAnalysisData) {
      setBookkeeping(d);
      if (d.businessName) setPaBusinessName(d.businessName);
      if (d.client?.business_type) setPaBusinessType(d.client.business_type);
      setPaReportingPeriodEnd(d.period.toIso);
      // A full financial year of figures → yearly analysis by default; the user
      // can switch to quarterly/monthly on the wizard if they'd rather.
      setPaAnalysisPeriod(prev => prev || 'yearly');
    }
    const pending = consumePendingAnalysis('/performance');
    if (pending) apply(pending);
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/performance') return;
      const p = consumePendingAnalysis('/performance');
      if (p) apply(p);
    }
    window.addEventListener('smith:pending-analysis', handle);
    return () => window.removeEventListener('smith:pending-analysis', handle);
  }, []);

  const [selectedSections, setSelectedSections] = useState<SectionId[]>(
    PERFORMANCE_SECTIONS.filter(s => s.defaultOn).map(s => s.id)
  );

  function toggleSection(id: SectionId) {
    setSectionsCustomized(true);
    setSelectedSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  }

  // Recommended preset — applied automatically as the business type/trade change,
  // unless the user has started customising the section list themselves.
  useEffect(() => {
    if (sectionsCustomized || !paBusinessType) return;
    setSelectedSections(recommendSections(paBusinessType, paBusinessTrade).ids);
  }, [paBusinessType, paBusinessTrade, sectionsCustomized]);

  useEffect(() => {
    if (!selectedClient) return;
    if (selectedClient.name) setPaBusinessName(selectedClient.name);
    if (selectedClient.business_type) setPaBusinessType(selectedClient.business_type);
  }, [selectedClient]);
  // ── Auto client-context: pulls past Performance analyses for this client and
  // feeds them to the AI for narrative continuity & trend awareness.
  type PastAnalysis = { createdAt: string; periodType: string; periodDescription: string; selectedSections: string[]; summaryText: string };
  const [pastAnalyses, setPastAnalyses]      = useState<PastAnalysis[]>([]);
  const [pastCtxLoading, setPastCtxLoading]  = useState(false);
  const [usePastContext, setUsePastContext]  = useState(true);

  useEffect(() => {
    if (!selectedClient?.id) {
      setPastAnalyses([]);
      return;
    }
    let cancelled = false;
    setPastCtxLoading(true);
    fetch(`/api/performance/client-context?clientId=${selectedClient.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setPastAnalyses(d.pastAnalyses ?? []);
      })
      .catch(() => {/* silent — context is optional */})
      .finally(() => { if (!cancelled) setPastCtxLoading(false); });
    return () => { cancelled = true; };
  }, [selectedClient?.id]);

  // Uploaded documents (the "package") + their detected category.
  const [docs, setDocs] = useState<PerfDoc[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (incoming.length === 0) return;
    setDocs(prev => [...prev, ...incoming.map(f => ({ id: crypto.randomUUID(), file: f, cat: detectPerfCat(f.name) }))]);
  };
  const removeDoc = (id: string) => setDocs(prev => prev.filter(d => d.id !== id));
  const retagDoc = (id: string, cat: PerfDocCat) => setDocs(prev => prev.map(d => d.id === id ? { ...d, cat } : d));
  // Wizard
  const [wizardStep, setWizardStep] = useState(1);
  const [sectionTab, setSectionTab] = useState<'suggestions' | 'custom'>('suggestions');
  const [reportHtml, setReportHtml] = useState('');
  const [editorHtml, setEditorHtml] = useState('');
  const [titlePageHtml, setTitlePageHtml] = useState('');
  const [firmLogoUrl, setFirmLogoUrl] = useState<string | null>(null);
  const [storedPeriod, setStoredPeriod] = useState('');
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  // Ref to the live A4 paper div inside PerformanceEditor — forwarded so that
  // SaveReportModal can clone the live DOM for pixel-perfect PDF generation.
  const paperRef = useRef<HTMLDivElement | null>(null);
  const [coverOpts, setCoverOpts] = useState<CoverOptions>({
    showCover: true, showFirmLogo: false, clientLogoUrl: null, gradient: DEFAULT_GRADIENT, coverStyle: 'gradient',
    firmLabel: '', subtitle: 'Performance Analysis Report',
  });

  // Fetch firm logo once on mount
  useEffect(() => {
    fetch('/api/firm/branding')
      .then(r => r.json())
      .then((d: { logoUrl: string | null }) => setFirmLogoUrl(d.logoUrl ?? null))
      .catch(() => {});
  }, []);

  // Wizard navigation — back freely; forward only when prior steps are valid.
  const goToStep = (n: number) => {
    if (n <= wizardStep) { setWizardStep(n); return; }
    if (n === 2 && step1Valid) setWizardStep(2);
    else if (n === 3 && step1Valid && step2Valid) setWizardStep(3);
    else if (n === 4 && step1Valid && step2Valid && step3Valid) setWizardStep(4);
  };

  // Called by PerformanceEditor's CoverPanel whenever cover options change
  function handleCoverChange(opts: CoverOptions) {
    setCoverOpts(opts);
    if (!opts.showCover) { setTitlePageHtml(''); return; }
    setTitlePageHtml(buildTitlePageHtml(
      paBusinessName, paBusinessType, paBusinessTrade, paTradingLocation, storedPeriod,
      {
        gradient: opts.gradient,
        firmLogoUrl: opts.showFirmLogo ? firmLogoUrl : null,
        clientLogoUrl: opts.clientLogoUrl,
        titleOverride: opts.titleOverride,
        periodOverride: opts.periodOverride,
        coverStyle: opts.coverStyle,
        firmLabel: opts.firmLabel,
        subtitle: opts.subtitle,
      },
    ));
  }

  const allFiles = docs.map(d => d.file);
  // The bookkeeping handoff supplies the management figures as text, so it
  // satisfies the "management accounts" requirement on its own.
  const hasCat = (c: PerfDocCat) => docs.some(d => d.cat === c) || (!!bookkeeping && c === 'management_accounts');
  const step1Valid = !!(paBusinessName && paBusinessType && paAnalysisPeriod && paReportingPeriodEnd);
  const step2Valid = selectedSections.length > 0;
  const step3Valid = hasCat('management_accounts') || !!bookkeeping;
  const canProcess = step1Valid && step2Valid && step3Valid;
  const businessTypeLabel = BUSINESS_TYPE_LABELS[paBusinessType] || 'business';
  const recommendation = recommendSections(paBusinessType, paBusinessTrade);

  // A section toggle row with a hover description (dark-pill Tooltip) — used on
  // the Select Sections wizard step.
  const sectionRow = (id: SectionId) => {
    const sec = PERFORMANCE_SECTIONS.find(s => s.id === id);
    if (!sec) return null;
    const active = selectedSections.includes(id);
    return (
      <Tooltip key={id} label={sec.description} side="top" className="w-full">
        <button type="button" onClick={() => toggleSection(id)} aria-label={`${sec.label}: ${sec.description}`}
          className={`w-full flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${active ? 'bg-[var(--accent-light)] border-[var(--accent)]' : 'bg-white border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'}`}>
          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${active ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-input)]'}`}>
            {active && <Check size={10} className="text-white" />}
          </span>
          <span className={`text-xs font-semibold ${active ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{sec.label}</span>
        </button>
      </Tooltip>
    );
  };

  // KPI / benchmark chart data — the AI returns this as a JSON string; we parse it
  // for the chart strip and keep the raw string for persistence.
  const chartItems = (() => {
    try {
      const parsed = JSON.parse(chartDataJson || '[]');
      if (!Array.isArray(parsed)) return [];
      const num = (s: unknown) => { const v = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(v) ? v : 0; };
      return parsed
        .map((d: { label?: string; company?: unknown; benchmark?: unknown }) => ({
          label: String(d?.label ?? ''),
          company: num(d?.company), benchmark: num(d?.benchmark),
          companyRaw: String(d?.company ?? ''), benchmarkRaw: String(d?.benchmark ?? ''),
        }))
        .filter(d => d.label);
    } catch { return []; }
  })();

  const handleProcess = useCallback(async () => {
    if (!canProcess) return;
    setAppState('loading'); setError(null); setProgress(0);
    const est = (5 + allFiles.length * 2) * 1000; let elapsed = 0;
    progressRef.current = setInterval(() => { elapsed += 100; setProgress(Math.min(99, (elapsed / est) * 100)); }, 100);
    try {
      const fileData = await Promise.all(allFiles.map(async f => ({ name: f.name, mimeType: f.type || 'application/pdf', base64: await fileToBase64(f) })));
      const effectivePeriodDescription = paAnalysisPeriodDescription.trim() || buildPeriodDesc(paAnalysisPeriod, paReportingPeriodEnd);
      // Currency is folded into the context sent to the AI so figures use the right symbol.
      const sym = CURRENCY_SYMBOL[paCurrency] ?? '£';
      const relevantInfoWithCurrency = `${paCurrency !== 'GBP' ? `All monetary figures are in ${paCurrency} (${sym}). ` : ''}${paRelevantInfo}`.trim();
      const effectivePastAnalyses = (usePastContext && pastAnalyses.length > 0) ? pastAnalyses.slice(0, 3) : null;
      const res = await fetch('/api/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paBusinessName, paBusinessType, paBusinessTrade, paTradingLocation, paRelevantInfo: relevantInfoWithCurrency, paAnalysisPeriod, paAnalysisPeriodDescription: effectivePeriodDescription, selectedSections, pastAnalyses: effectivePastAnalyses, files: fileData, clientId: selectedClient?.id ?? null, clientCode: selectedClient?.client_ref ?? null, bookkeepingStatements: bookkeepingStatementsText }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const data = await res.json();
      if (progressRef.current) clearInterval(progressRef.current);
      const html = data.reportHtml || '<p>No report generated.</p>';
      setStoredPeriod(effectivePeriodDescription);
      setTitlePageHtml(buildTitlePageHtml(paBusinessName, paBusinessType, paBusinessTrade, paTradingLocation, effectivePeriodDescription));
      setChartDataJson(data.chartDataJson ?? '');
      setSavedOutputId(null); // a fresh analysis is a new run until first saved
      setProgress(100); setReportHtml(html); setEditorHtml(html); setAppState('success');
    } catch (err) {
      if (progressRef.current) clearInterval(progressRef.current);
      setError(err instanceof Error ? err.message : 'Unknown error'); setAppState('error'); setProgress(0);
    }
  }, [canProcess, paBusinessName, paBusinessType, paBusinessTrade, paTradingLocation, paRelevantInfo, paAnalysisPeriod, paAnalysisPeriodDescription, paReportingPeriodEnd, paCurrency, selectedSections, allFiles, selectedClient?.id, usePastContext, pastAnalyses, bookkeepingStatementsText]);

  // Wrap the current (possibly edited) HTML in a standalone document for download/Drive
  const themeColor = getThemeColor(coverOpts.gradient);
  const fullReportHtml = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    `  <title>Performance Analysis \u2014 ${paBusinessName}</title>`,
    '  <style>',
    '    body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 48px; font-size: 13px; line-height: 1.75; max-width: 794px; }',
    `    h1 { font-size: 22px; font-weight: 700; color: ${themeColor}; margin: 28px 0 14px; padding-bottom: 8px; border-bottom: 2px solid ${themeColor}; }`,
    `    h2 { font-size: 17px; font-weight: 700; color: ${themeColor}; margin: 24px 0 10px; padding-bottom: 5px; border-bottom: 1.5px solid #e5e7eb; }`,
    `    h3 { font-size: 14px; font-weight: 600; color: ${themeColor}; margin: 18px 0 8px; }`,
    '    p  { margin: 0 0 10px; min-height: 1.5em; }',
    '    p:empty::before { content: "\\00a0"; }',
    `    strong { color: ${themeColor}; font-weight: 600; }`,
    '    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 11px; table-layout: fixed; page-break-inside: avoid; break-inside: avoid; }',
    `    th { background: ${themeColor}; color: #fff; padding: 6px 8px; text-align: left; font-weight: 600; border: 1px solid ${themeColor}; word-break: break-word; }`,
    '    td { padding: 5px 8px; border: 1px solid #e5e7eb; word-break: break-word; }',
    '    tr:nth-child(even) td { background: #f9fafb; }',
    '    ul, ol { padding-left: 22px; margin: 8px 0; }',
    '    li { margin-bottom: 4px; }',
    '    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }',
    '    h1, h2, h3, p, li, blockquote { page-break-inside: avoid; break-inside: avoid; }',
    '    tr, td, th { page-break-inside: avoid; break-inside: avoid; }',
    '    div[data-page-break] { display: block; height: 0; border: none; background: transparent; margin: 0; padding: 0; box-shadow: none; page-break-before: always; break-before: page; }',
    '    .tableWrapper { overflow-x: auto; }',
    '  </style>',
    '</head>',
    '<body>',
    titlePageHtml,
    // Preserve empty paragraphs so user-added blank lines survive PDF rendering
    editorHtml.replace(/<p><\/p>/g, '<p><br></p>'),
    '</body>',
    '</html>',
  ].join('\n');

  const reportFileName = `Performance_Analysis_${paBusinessName.replace(/\s+/g, '_') || 'Report'}`;

  if (appState === 'loading') {
    const processingFiles: ProgressFile[] = allFiles.length > 0
      ? allFiles.map(f => ({ name: f.name, status: 'processing' as const }))
      : bookkeeping ? [{ name: 'Statements from SMITH Bookkeeping', status: 'processing' as const }] : [];
    return (
      <ProcessingView
        progress={progress}
        fileCount={processingFiles.length}
        files={processingFiles}
        steps={['Reading accounts', 'Calculating KPIs', 'Benchmarking performance', 'Writing commentary', 'Building report']}
      />
    );
  }
  if (appState === 'error') return (
    <ToolLayout title="Performance Analysis" icon={Gauge} iconColor="#059669" wide>
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  // Save the full run to outputs history (Save & continue). Updates the same
  // record when we already have an id (no duplicates), persists the chart data,
  // and shows a toast unless `silent`. Used by the green Save button AND as a
  // side-effect of the editor's export Save.
  const persistRun = async (currentClient: SelectedClient | null, opts: { silent?: boolean } = {}): Promise<string | null> => {
    setSaving(true);
    try {
      const sourceFilenames = Array.from(new Set(allFiles.map(f => f.name)));
      const res = await fetch('/api/outputs/performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputId: savedOutputId,
          clientId: currentClient?.id ?? null,
          clientName: currentClient?.name ?? paBusinessName ?? null,
          clientCode: currentClient?.client_ref ?? null,
          paBusinessName, paBusinessType, paBusinessTrade, paTradingLocation, paRelevantInfo,
          paAnalysisPeriod, paAnalysisPeriodDescription: storedPeriod || paAnalysisPeriodDescription,
          selectedSections, reportHtml, editorHtml, titlePageHtml, themeColor, chartDataJson, sourceFilenames,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      const data = await res.json();
      if (data?.id) setSavedOutputId(data.id);
      if (!opts.silent) setSaveToast({ ok: true, msg: 'Saved — reopen any time from history.' });
      return data?.id ?? null;
    } catch (err) {
      if (!opts.silent) setSaveToast({ ok: false, msg: err instanceof Error ? err.message : 'Save failed. Please try again.' });
      else console.error('[Performance] history save failed:', err);
      return null;
    } finally {
      setSaving(false);
    }
  };

  return (
    <ToolLayout title="Performance Analysis" description="Analyse management accounts and produce a business performance report with KPI ratios." icon={Gauge} iconColor="#059669" wide>
      <BackToHistory onBack={onBack} />

      {/* Save toast — success/error feedback, auto-dismisses */}
      {saveToast && (
        <div className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold animate-slide-up ${saveToast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {saveToast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {saveToast.msg}
        </div>
      )}

      {appState === 'idle' && (
        <div className="space-y-5">
          <PerfStepper current={wizardStep} onStep={goToStep} />

          {/* ── Step 1: Business Details ───────────────────────────────────── */}
          {wizardStep === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-5 items-start">

            <div className="space-y-5">
              <div className="relative z-30 bg-white/[0.78] backdrop-blur-md rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">Business Details</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Tell us about the business and reporting period.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Client</label>
                    <ClientSelector value={selectedClient} onSelect={setSelectedClient} align="left" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Business Name <span className="text-red-500">*</span></label>
                    <input value={paBusinessName} onChange={e => setPaBusinessName(e.target.value)} placeholder="Business name" className="input-base py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Business Type <span className="text-red-500">*</span></label>
                    <select value={paBusinessType} onChange={e => setPaBusinessType(e.target.value)} className="input-base py-1.5 text-sm">
                      <option value="">Select…</option>
                      <option value="sole_trader">Sole Trader</option>
                      <option value="partnership">Partnership</option>
                      <option value="limited_company">Limited Company</option>
                      <option value="rent">Rent</option>
                      <option value="trust">Trust</option>
                      <option value="charity">Charity</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Industry / Trade <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
                    <input value={paBusinessTrade} onChange={e => setPaBusinessTrade(e.target.value)} placeholder="e.g. Plumbing, Cafe" className="input-base py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Trading Location <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
                    <input value={paTradingLocation} onChange={e => setPaTradingLocation(e.target.value)} placeholder="e.g. London, UK" className="input-base py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Reporting Frequency <span className="text-red-500">*</span></label>
                    <select value={paAnalysisPeriod} onChange={e => setPaAnalysisPeriod(e.target.value)} className="input-base py-1.5 text-sm">
                      <option value="">Select…</option>
                      <option value="yearly">Yearly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Reporting Period End <span className="text-red-500">*</span></label>
                    <input type="date" value={paReportingPeriodEnd} onChange={e => setPaReportingPeriodEnd(e.target.value)} className="input-base py-1.5 text-sm w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Period Description <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
                    <input value={paAnalysisPeriodDescription} onChange={e => setPaAnalysisPeriodDescription(e.target.value)} placeholder="e.g. Q2 2024" className="input-base py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Currency</label>
                    <select value={paCurrency} onChange={e => setPaCurrency(e.target.value)} className="input-base py-1.5 text-sm">
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Any other relevant information or key business priorities?</label>
                  <textarea value={paRelevantInfo} onChange={e => setPaRelevantInfo(e.target.value)} placeholder="e.g. Growth, cashflow, profitability, costs under control…" rows={2} className="input-base py-1.5 text-sm resize-none w-full" />
                </div>
              </div>

            </div>

            {/* Right: continuity + what happens next */}
            <div className="space-y-5">
              {selectedClient && (pastCtxLoading || pastAnalyses.length > 0) && (
                <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs ${
                  usePastContext ? 'bg-[var(--accent-light)] border-[var(--accent)]/30 text-[var(--accent)]' : 'bg-[var(--bg-nav-hover)] border-[var(--border)] text-[var(--text-muted)]'
                }`}>
                  <Sparkles size={13} className="shrink-0" />
                  <div className="flex-1 leading-snug">
                    {pastCtxLoading ? <span>Looking for past performance reports for this client…</span>
                      : usePastContext ? <>Using <span className="font-semibold">{pastAnalyses.length}</span> past {pastAnalyses.length === 1 ? 'report' : 'reports'} to keep the new commentary continuous.</>
                      : <>Past-report continuity is off.</>}
                  </div>
                  <Tooltip label={usePastContext ? 'Turn off past-report continuity' : 'Turn continuity back on'}>
                    <button onClick={() => setUsePastContext(v => !v)} aria-label="Toggle past-report continuity"
                      className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0 ${usePastContext ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${usePastContext ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </Tooltip>
                </div>
              )}
              <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-5">
                <h3 className="text-base font-bold text-[var(--text-primary)]">What happens next?</h3>
                <div className="mt-4 space-y-4">
                  {[
                    { icon: Sparkles, title: 'We analyse your management accounts', desc: 'Our AI reviews your data and calculates key KPIs.' },
                    { icon: Activity, title: 'We generate insights', desc: 'Identify trends, risks and opportunities.' },
                    { icon: FileText, title: 'You get a clear performance report', desc: 'Professional, client-ready and fully customisable.' },
                  ].map((s, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-light)] text-[var(--accent)]"><s.icon size={15} /></div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]"><span className="text-[var(--text-muted)]">{i + 1}</span> {s.title}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* ── Step 2: Select Sections ────────────────────────────────────── */}
          {wizardStep === 2 && (
            <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">Select Sections</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Choose what goes in the report — hover a section to see what it includes. Fewer sections generate faster.</p>
                </div>
                <span className="text-xs font-semibold text-[var(--accent)] bg-[var(--accent-light)] px-2 py-0.5 rounded-full shrink-0">{selectedSections.length} of {PERFORMANCE_SECTIONS.length} selected</span>
              </div>

              <div className="mt-4 flex w-fit gap-1 p-1 rounded-lg bg-[var(--bg-nav-hover)]">
                {(['suggestions', 'custom'] as const).map(t => (
                  <button key={t} type="button" onClick={() => setSectionTab(t)}
                    className={`px-5 py-1.5 rounded-md text-sm font-semibold capitalize transition-colors ${sectionTab === t ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>{t}</button>
                ))}
              </div>

              {sectionTab === 'suggestions' ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs text-[var(--text-secondary)]">Recommended for a <span className="font-semibold text-[var(--text-primary)]">{businessTypeLabel}</span>{paBusinessTrade ? <> · {paBusinessTrade}</> : null}:</p>
                    <button type="button" onClick={() => { setSectionsCustomized(false); setSelectedSections(recommendation.ids); }} className="text-xs font-semibold text-[var(--accent)] hover:underline">Use these {recommendation.ids.length} sections</button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {recommendation.ids.map(id => sectionRow(id))}
                  </div>
                  <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                    <p className="text-xs font-bold text-emerald-700">Why these sections?</p>
                    <p className="text-xs text-emerald-700/90 mt-1 leading-relaxed">{recommendation.why}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  <div className="flex items-center justify-end gap-2 text-xs">
                    <button type="button" onClick={() => { setSectionsCustomized(true); setSelectedSections(PERFORMANCE_SECTIONS.map(s => s.id)); }} className="text-[var(--accent)] hover:underline">All</button>
                    <span className="text-[var(--text-muted)]">/</span>
                    <button type="button" onClick={() => { setSectionsCustomized(true); setSelectedSections([]); }} className="text-[var(--accent)] hover:underline">None</button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {PERFORMANCE_SECTIONS.map(s => sectionRow(s.id))}
                  </div>
                </div>
              )}
              {selectedSections.length === 0 && <p className="mt-3 text-xs text-amber-600">Select at least one section to continue.</p>}
            </div>
          )}

          {/* ── Step 3: Management Accounts (package upload) ───────────────── */}
          {wizardStep === 3 && (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 items-start">
              <div className="space-y-4">
                <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                  className="rounded-2xl border-2 border-dashed border-[var(--border-input)] bg-white/[0.45] backdrop-blur-md p-8 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-light)]"><UploadCloud size={28} className="text-[var(--accent)]" /></div>
                  <h3 className="mt-4 text-xl font-bold text-[var(--text-primary)]">Upload your <span className="text-[var(--accent)]">management accounts</span></h3>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">We&apos;ll automatically detect and extract what we need.</p>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary mx-auto mt-5"><UploadCloud size={15} /> Drag and drop files here</button>
                  <div className="my-5 flex items-center gap-3 text-xs text-[var(--text-muted)]"><div className="flex-1 h-px bg-[var(--border)]" /> or <div className="flex-1 h-px bg-[var(--border)]" /></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-secondary justify-center bg-white"><UploadCloud size={14} /> Upload from device</button>
                    <Tooltip label="Connecting to SMITH Bookkeeping is coming soon"><button type="button" disabled className="btn-secondary justify-center w-full opacity-60 cursor-not-allowed"><BookCopy size={14} /> Connect to SMITH Bookkeeping</button></Tooltip>
                  </div>
                  <div className="my-5 flex items-center gap-3 text-xs text-[var(--text-muted)]"><div className="flex-1 h-px bg-[var(--border)]" /> <span className="whitespace-nowrap">or connect from your accounting software</span> <div className="flex-1 h-px bg-[var(--border)]" /></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Tooltip label="Xero integration is coming soon"><button type="button" disabled className="btn-secondary justify-center w-full opacity-60 cursor-not-allowed">Connect Xero</button></Tooltip>
                    <Tooltip label="QuickBooks integration is coming soon"><button type="button" disabled className="btn-secondary justify-center w-full opacity-60 cursor-not-allowed">Connect QuickBooks</button></Tooltip>
                  </div>
                  <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
                </div>

                {docs.length > 0 && (
                  <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">{docs.length} file{docs.length > 1 ? 's' : ''} uploaded</p>
                    {docs.map(d => (
                      <div key={d.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-white/60 px-3 py-2">
                        <FileText size={16} className="text-[var(--text-muted)] shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-sm text-[var(--text-primary)]">{d.file.name}</span>
                        <select value={d.cat} onChange={e => retagDoc(d.id, e.target.value as PerfDocCat)} className="input-base py-1 px-2 text-xs w-auto shrink-0">
                          {PERF_ALL_CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                          <option value="other">Other / Unsorted</option>
                        </select>
                        <button type="button" onClick={() => removeDoc(d.id)} aria-label="Remove file" className="text-[var(--text-muted)] hover:text-red-500 shrink-0"><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Management figures handed over from the Bookkeeping tool */}
                {bookkeeping && (
                  <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-4 space-y-2 border border-[var(--accent)]/30">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                        <BookCopy size={14} className="text-[var(--accent)]" /> From SMITH Bookkeeping
                      </p>
                      <button type="button" onClick={() => setBookkeeping(null)} aria-label="Remove bookkeeping statements" className="text-[var(--text-muted)] hover:text-red-500">
                        <X size={15} />
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {bookkeeping.current.periodLabel}{bookkeeping.prior ? ' · incl. prior year' : ''}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {['Profit & Loss', 'Balance Sheet', 'Trial Balance'].map(s => (
                        <span key={s} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--border)] bg-white/60 text-xs text-[var(--text-secondary)]">
                          <FileText size={11} /> {s}
                        </span>
                      ))}
                      {bookkeeping.prior && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--border)] bg-white/60 text-xs text-[var(--text-secondary)]">
                          Prior year
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <ShieldCheck size={14} className="text-[var(--accent)] shrink-0" />
                  Your data is encrypted and secure. Smith will only use it to generate your performance report.
                </div>
              </div>

              <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-5">
                <h3 className="text-base font-bold text-[var(--text-primary)]">AI Readiness</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">We&apos;ll let you know when your files are ready to analyse.</p>
                <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Required</p>
                <div className="mt-1">{PERF_REQUIRED_CATS.map(c => <PerfReadyRow key={c.key} label={c.label} done={hasCat(c.key)} />)}</div>
                <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Optional</p>
                <div className="mt-1">{PERF_OPTIONAL_CATS.map(c => <PerfReadyRow key={c.key} label={c.label} done={hasCat(c.key)} />)}</div>
              </div>
            </div>
          )}

          {/* ── Step 4: Generate Report (review) ──────────────────────────── */}
          {wizardStep === 4 && (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 items-start">
              <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">Ready to generate</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Review your setup, then generate the report.</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { l: 'Business', v: paBusinessName || '—' },
                    { l: 'Period', v: (paAnalysisPeriodDescription || buildPeriodDesc(paAnalysisPeriod, paReportingPeriodEnd)) || '—' },
                    { l: 'Sections', v: `${selectedSections.length}` },
                    { l: 'Files', v: `${docs.length}` },
                  ].map(m => (
                    <div key={m.l}><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{m.l}</p><p className="text-sm font-semibold text-[var(--text-primary)] truncate">{m.v}</p></div>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Included sections</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedSections.map(id => { const sec = PERFORMANCE_SECTIONS.find(s => s.id === id); return sec ? <span key={id} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-light)] text-[var(--accent)] font-medium">{sec.label}</span> : null; })}
                  </div>
                </div>
              </div>

              <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-5">
                <h3 className="text-base font-bold text-[var(--text-primary)]">What happens next?</h3>
                <div className="mt-4 space-y-4">
                  {[
                    { icon: Sparkles, title: 'We analyse your management accounts', desc: 'Our AI reviews your data and calculates key KPIs.' },
                    { icon: Activity, title: 'We generate insights', desc: 'Identify trends, risks and opportunities.' },
                    { icon: FileText, title: 'You get a clear performance report', desc: 'Professional, client-ready and fully customisable.' },
                  ].map((s, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-light)] text-[var(--accent)]"><s.icon size={15} /></div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]"><span className="text-[var(--text-muted)]">{i + 1}</span> {s.title}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Wizard navigation */}
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => goToStep(wizardStep - 1)} disabled={wizardStep === 1}
              className="btn-secondary bg-white text-[var(--text-primary)] border-[var(--border)] disabled:opacity-40"><ArrowLeft size={14} /> Back</button>
            {wizardStep < 4 ? (
              <button type="button" onClick={() => goToStep(wizardStep + 1)}
                disabled={(wizardStep === 1 && !step1Valid) || (wizardStep === 2 && !step2Valid) || (wizardStep === 3 && !step3Valid)}
                className="btn-primary">Next: {PERF_STEPS[wizardStep]} <ArrowRight size={14} /></button>
            ) : (
              <button type="button" onClick={handleProcess} disabled={!canProcess} className="btn-primary"><Gauge size={15} /> Generate Report</button>
            )}
          </div>
        </div>
      )}
      {appState === 'success' && (
        <div className="space-y-4">
          {/* Save & continue */}
          <div className="flex items-center justify-end">
            <Tooltip label="Save your progress — reopen and continue any time from history">
              <button onClick={() => void persistRun(selectedClient)} disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 shadow-[0_4px_12px_rgba(16,185,129,0.3)] transition-all">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{saving ? 'Saving…' : 'Save'}
              </button>
            </Tooltip>
          </div>

          <SaveReportModal
            isOpen={saveModalOpen}
            reportHtml={fullReportHtml}
            paperRef={paperRef}
            pdfOptions={{
              coverSelector: '[data-cover]',
              pageMarginPx: 48,
              avoidSplitSelector: 'h1, h2, h3, p, table, ul, ol, blockquote, [data-perf-chart]',
            }}
            reportFileName={reportFileName}
            feature="performance_analysis"
            documentType="report"
            initialClient={selectedClient}
            onAfterSave={ctx => { void persistRun(ctx.client, { silent: true }); }}
            onClose={() => setSaveModalOpen(false)}
          />

          <PerformanceEditor
            // Prefer the edited version when present — this is what makes
            // re-opening a saved report from history show the user's edits
            // instead of the original AI output. On a fresh run editorHtml
            // is initialised to the same value as reportHtml so the fallback
            // is harmless.
            initialHtml={editorHtml || reportHtml}
            titlePageHtml={titlePageHtml}
            firmLogoUrl={firmLogoUrl}
            defaultTitle={paBusinessName}
            defaultPeriod={storedPeriod}
            paperRef={paperRef}
            kpiData={chartItems.map(d => ({ label: d.label, company: d.company, benchmark: d.benchmark }))}
            onHtmlChange={setEditorHtml}
            onCoverChange={handleCoverChange}
            onFirmLogoUploaded={url => setFirmLogoUrl(url)}
            onSave={() => setSaveModalOpen(true)}
            onNewAnalysis={() => { setAppState('idle'); setWizardStep(1); }}
          />
        </div>
      )}
    </ToolLayout>
  );
}
