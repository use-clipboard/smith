'use client';

import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle, XCircle, Info, HelpCircle, RefreshCw, Loader2 } from 'lucide-react';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'unknown';

interface Check { id: string; label: string; status: CheckStatus; detail: string; value?: string; fix?: string }
interface Report {
  domain: string | null;
  senderEmail: string | null;
  consumer: boolean;
  checks: Check[];
  summary: { pass: number; warn: number; fail: number };
}

const ICON: Record<CheckStatus, { Icon: typeof CheckCircle2; cls: string }> = {
  pass:    { Icon: CheckCircle2,  cls: 'text-green-600' },
  warn:    { Icon: AlertTriangle, cls: 'text-amber-500' },
  fail:    { Icon: XCircle,       cls: 'text-red-600' },
  info:    { Icon: Info,          cls: 'text-[var(--text-muted)]' },
  unknown: { Icon: HelpCircle,    cls: 'text-[var(--text-muted)]' },
};

export default function DeliverabilityPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/campaigns/deliverability');
      if (r.ok) setReport(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const overall = !report ? null
    : report.summary.fail > 0 ? { label: 'Action needed', cls: 'bg-red-100 text-red-700' }
    : report.summary.warn > 0 ? { label: 'Needs attention', cls: 'bg-amber-100 text-amber-700' }
    : { label: 'Healthy', cls: 'bg-green-100 text-green-700' };

  return (
    <section className="glass-solid rounded-2xl border border-[var(--border)] p-5">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Deliverability</h3>
        {overall && <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${overall.cls}`}>{overall.label}</span>}
        <button onClick={load} disabled={loading} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline disabled:opacity-50">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-check
        </button>
      </div>
      <p className="text-xs text-[var(--text-secondary)] mb-4">
        Live DNS checks on your sending domain{report?.domain ? <> (<span className="font-mono">{report.domain}</span>)</> : ''}, plus health from your own sends.
      </p>

      {loading && !report ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[var(--text-muted)]" /></div>
      ) : !report ? (
        <div className="text-sm text-[var(--text-secondary)] py-4">Couldn’t run the checks.</div>
      ) : (
        <div className="divide-y divide-black/5">
          {report.checks.map(c => {
            const { Icon, cls } = ICON[c.status] ?? ICON.info;
            return (
              <div key={c.id} className="flex items-start gap-3 py-2.5">
                <Icon size={16} className={`${cls} mt-0.5 shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">{c.label}</div>
                  <div className="text-xs text-[var(--text-secondary)]">{c.detail}</div>
                  {c.value && <div className="text-[11px] font-mono text-[var(--text-muted)] mt-1 break-all">{c.value}</div>}
                  {c.fix && <div className="text-[11px] text-[var(--accent)] mt-1">{c.fix}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
