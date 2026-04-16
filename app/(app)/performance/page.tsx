'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import SaveReportModal from '@/components/ui/SaveReportModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { consumePendingClient } from '@/lib/pendingClient';
import ToolLayout from '@/components/ui/ToolLayout';
import PerformanceEditor, { getThemeColor } from '@/components/features/performance/PerformanceEditor';
import { TrendingUp, Check } from 'lucide-react';
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

export default function PerformancePage() {
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
  const [paCustomStart, setPaCustomStart] = useState('');
  const [paCustomEnd, setPaCustomEnd] = useState('');

  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);

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

  const [selectedSections, setSelectedSections] = useState<SectionId[]>(
    PERFORMANCE_SECTIONS.filter(s => s.defaultOn).map(s => s.id)
  );

  function toggleSection(id: SectionId) {
    setSelectedSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  }

  useEffect(() => {
    if (!selectedClient) return;
    if (selectedClient.name) setPaBusinessName(selectedClient.name);
    if (selectedClient.business_type) setPaBusinessType(selectedClient.business_type);
  }, [selectedClient]);
  const [managementAccounts, setManagementAccounts] = useState<File[]>([]);
  const [priorAccounts, setPriorAccounts] = useState<File[]>([]);
  const [priorAnalysis, setPriorAnalysis] = useState<File[]>([]);
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

  const canProcess = !!(paBusinessName && managementAccounts.length > 0 && paBusinessType && paBusinessTrade && paAnalysisPeriod &&
    (paAnalysisPeriod !== 'custom' || (paCustomStart && paCustomEnd)) && selectedSections.length > 0);
  const allFiles = [...managementAccounts, ...priorAccounts, ...priorAnalysis];

  const handleProcess = useCallback(async () => {
    if (!canProcess) return;
    setAppState('loading'); setError(null); setProgress(0);
    const est = (5 + allFiles.length * 2) * 1000; let elapsed = 0;
    progressRef.current = setInterval(() => { elapsed += 100; setProgress(Math.min(99, (elapsed / est) * 100)); }, 100);
    try {
      const fileData = await Promise.all(allFiles.map(async f => ({ name: f.name, mimeType: f.type || 'application/pdf', base64: await fileToBase64(f) })));
      const effectivePeriodDescription = paAnalysisPeriod === 'custom'
        ? `${paCustomStart} to ${paCustomEnd}`
        : paAnalysisPeriodDescription;
      const res = await fetch('/api/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paBusinessName, paBusinessType, paBusinessTrade, paTradingLocation, paRelevantInfo, paAnalysisPeriod, paAnalysisPeriodDescription: effectivePeriodDescription, selectedSections, files: fileData, clientId: selectedClient?.id ?? null, clientCode: selectedClient?.client_ref ?? null }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const data = await res.json();
      if (progressRef.current) clearInterval(progressRef.current);
      const html = data.reportHtml || '<p>No report generated.</p>';
      setStoredPeriod(effectivePeriodDescription);
      setTitlePageHtml(buildTitlePageHtml(paBusinessName, paBusinessType, paBusinessTrade, paTradingLocation, effectivePeriodDescription));
      setProgress(100); setReportHtml(html); setEditorHtml(html); setAppState('success');
    } catch (err) {
      if (progressRef.current) clearInterval(progressRef.current);
      setError(err instanceof Error ? err.message : 'Unknown error'); setAppState('error'); setProgress(0);
    }
  }, [canProcess, paBusinessName, paBusinessType, paBusinessTrade, paTradingLocation, paRelevantInfo, paAnalysisPeriod, paAnalysisPeriodDescription, allFiles, selectedClient?.id]);

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
    '    h2, h3 { page-break-before: avoid; break-before: avoid; }',
    '    div[data-page-break] { display: block; height: 0; border: none; background: transparent; margin: 0; padding: 0; box-shadow: none; }',
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
    const processingFiles: ProgressFile[] = allFiles.map(f => ({ name: f.name, status: 'processing' as const }));
    return (
      <ProcessingView
        progress={progress}
        fileCount={allFiles.length}
        files={processingFiles}
        steps={['Reading accounts', 'Calculating KPIs', 'Benchmarking performance', 'Writing commentary', 'Building report']}
      />
    );
  }
  if (appState === 'error') return <ToolLayout title="Performance Analysis" icon={TrendingUp} iconColor="#059669"><ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} /></ToolLayout>;

  return (
    <ToolLayout title="Performance Analysis" description="Analyse management accounts and produce a business performance report with KPI ratios." icon={TrendingUp} iconColor="#059669">
      {appState === 'idle' && (
        <div className="space-y-5">
          <div className="glass-solid rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Business Details</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[var(--text-secondary)]">Client</span>
              <ClientSelector value={selectedClient} onSelect={setSelectedClient} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <input value={paBusinessName} onChange={e => setPaBusinessName(e.target.value)} placeholder="* Business Name" className="input-base" />
              <select value={paBusinessType} onChange={e => setPaBusinessType(e.target.value)} className="input-base">
                <option value="">* Select Business Type</option>
                <option value="sole_trader">Sole Trader</option>
                <option value="partnership">Partnership</option>
                <option value="limited_company">Limited Company</option>
                <option value="rent">Rent</option>
                <option value="trust">Trust</option>
                <option value="charity">Charity</option>
                <option value="other">Other</option>
              </select>
              <input value={paBusinessTrade} onChange={e => setPaBusinessTrade(e.target.value)} placeholder="* Business Trade (e.g., Cafe, Plumber)" className="input-base" />
              <input value={paTradingLocation} onChange={e => setPaTradingLocation(e.target.value)} placeholder="Trading Location (e.g., London)" className="input-base" />
              <select value={paAnalysisPeriod} onChange={e => { setPaAnalysisPeriod(e.target.value); setPaCustomStart(''); setPaCustomEnd(''); }} className="input-base">
                <option value="">* Select Analysis Period</option>
                <option value="yearly">Yearly</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom</option>
              </select>
              {paAnalysisPeriod === 'custom' ? (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">Start Date</span>
                    <input type="date" value={paCustomStart} onChange={e => setPaCustomStart(e.target.value)} className="input-base" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">End Date</span>
                    <input type="date" value={paCustomEnd} onChange={e => setPaCustomEnd(e.target.value)} className="input-base" />
                  </label>
                </>
              ) : (
                <input value={paAnalysisPeriodDescription} onChange={e => setPaAnalysisPeriodDescription(e.target.value)} placeholder="Period Description (e.g., Q2 2024)" className="input-base" />
              )}
            </div>
            <textarea value={paRelevantInfo} onChange={e => setPaRelevantInfo(e.target.value)} placeholder="Any other relevant info or key business priorities?" rows={2} className="input-base resize-none w-full" />
          </div>
          {/* Report sections checklist */}
          <div className="glass-solid rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Report Sections</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Select which sections to include — fewer sections = faster generation</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelectedSections(PERFORMANCE_SECTIONS.map(s => s.id))} className="text-xs text-[var(--accent)] hover:underline">All</button>
                <span className="text-xs text-[var(--text-muted)]">/</span>
                <button type="button" onClick={() => setSelectedSections([])} className="text-xs text-[var(--accent)] hover:underline">None</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {PERFORMANCE_SECTIONS.map(section => {
                const active = selectedSections.includes(section.id);
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      active
                        ? 'bg-[var(--accent-light)] border-[var(--accent)]'
                        : 'bg-[var(--bg-nav-hover)] border-[var(--border)] hover:border-[var(--accent)]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        active ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-input)]'
                      }`}>
                        {active && <Check size={10} className="text-white" />}
                      </div>
                      <div>
                        <div className={`text-xs font-semibold leading-tight ${active ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{section.label}</div>
                        <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-tight">{section.description}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedSections.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Select at least one section to generate a report.</p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <FileUpload title="* Management Accounts" onFilesChange={setManagementAccounts} multiple accept="application/pdf" helpText="P&L, Balance Sheet for the current period." existingFiles={managementAccounts} />
            <div className="space-y-4">
              <FileUpload title="Prior Period Accounts" onFilesChange={setPriorAccounts} multiple accept="application/pdf" optional helpText="For comparative analysis." existingFiles={priorAccounts} />
              <FileUpload title="Prior Analysis/Reports" onFilesChange={setPriorAnalysis} multiple accept="application/pdf" optional helpText="For context and follow-up." existingFiles={priorAnalysis} />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleProcess} disabled={!canProcess} className="btn-primary"><TrendingUp size={15} />Analyse Documents</button>
          </div>
        </div>
      )}
      {appState === 'success' && (
        <div>
          <SaveReportModal
            isOpen={saveModalOpen}
            reportHtml={fullReportHtml}
            paperRef={paperRef}
            reportFileName={reportFileName}
            feature="performance_analysis"
            documentType="report"
            initialClient={selectedClient}
            onClose={() => setSaveModalOpen(false)}
          />

          <PerformanceEditor
            initialHtml={reportHtml}
            titlePageHtml={titlePageHtml}
            firmLogoUrl={firmLogoUrl}
            defaultTitle={paBusinessName}
            defaultPeriod={storedPeriod}
            paperRef={paperRef}
            onHtmlChange={setEditorHtml}
            onCoverChange={handleCoverChange}
            onFirmLogoUploaded={url => setFirmLogoUrl(url)}
            onSave={() => setSaveModalOpen(true)}
            onNewAnalysis={() => setAppState('idle')}
          />
        </div>
      )}
    </ToolLayout>
  );
}
