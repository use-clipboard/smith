'use client';

/**
 * FraudHeaderValidator — admin dev/compliance harness for HMRC production
 * approval. Collects this browser's fraud-prevention data, sends it to our
 * server (which adds the public IP and builds the Gov-Client-* / Gov-Vendor-*
 * headers), forwards them to HMRC's Test Fraud Prevention Headers validator,
 * and shows the verdict + every header we sent. Run it across different
 * browsers / devices / screen sizes until it comes back clean — HMRC validates
 * these before issuing production credentials for VAT and MTD IT.
 */

import { useState } from 'react';
import { ShieldCheck, AlertTriangle, XCircle, CheckCircle2, Loader2, Play } from 'lucide-react';
import { collectFraudData } from '@/lib/hmrc/clientFraudData';

interface ValidateResult {
  env: string;
  httpStatus: number;
  verdict: 'pass' | 'warn' | 'fail';
  code: string | null;
  message: string | null;
  errors: unknown[];
  warnings: unknown[];
  raw: unknown;
  headersSent: Record<string, string>;
}

function asMessages(items: unknown[]): string[] {
  return items.map(it => {
    if (typeof it === 'string') return it;
    const o = it as Record<string, unknown>;
    return [o.code, o.message].filter(Boolean).join(' — ') || JSON.stringify(it);
  });
}

const VERDICT = {
  pass: { icon: CheckCircle2, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'Headers valid' },
  warn: { icon: AlertTriangle, cls: 'text-amber-700 bg-amber-50 border-amber-200', label: 'Valid with warnings' },
  fail: { icon: XCircle, cls: 'text-red-700 bg-red-50 border-red-200', label: 'Problems found' },
} as const;

export default function FraudHeaderValidator() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidateResult | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/hmrc/validate-fraud-headers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fraudData: collectFraudData() }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'Validation failed.'); return; }
      setResult(d as ValidateResult);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  const v = result ? VERDICT[result.verdict] : null;
  const VIcon = v?.icon ?? ShieldCheck;
  const errors = result ? asMessages(result.errors) : [];
  const warnings = result ? asMessages(result.warnings) : [];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">HMRC Fraud-Prevention Header Validator</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sends this browser&apos;s fraud-prevention headers to HMRC&apos;s test validator. Getting a clean result
              (across several browsers, devices and screen sizes) is required before HMRC issues production credentials.
            </p>
          </div>
        </div>

        <button
          onClick={() => void run()}
          disabled={running}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {running ? <><Loader2 size={14} className="animate-spin" /> Validating…</> : <><Play size={14} /> Run validation</>}
        </button>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
        )}
      </div>

      {result && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${v!.cls}`}>
            <VIcon size={18} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{v!.label}</p>
              <p className="text-xs opacity-80">
                {result.env} · HTTP {result.httpStatus}{result.code ? ` · ${result.code}` : ''}
                {result.message ? ` · ${result.message}` : ''}
              </p>
            </div>
          </div>

          {errors.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-700 mb-1.5">Errors ({errors.length})</p>
              <ul className="space-y-1 text-xs text-slate-700">
                {errors.map((m, i) => <li key={i} className="flex gap-2"><XCircle size={13} className="text-red-500 mt-0.5 shrink-0" />{m}</li>)}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1.5">Warnings ({warnings.length})</p>
              <ul className="space-y-1 text-xs text-slate-700">
                {warnings.map((m, i) => <li key={i} className="flex gap-2"><AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />{m}</li>)}
              </ul>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-600 mb-1.5">Headers sent</p>
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(result.headersSent).map(([k, val]) => (
                    <tr key={k} className="border-b border-slate-100 last:border-0">
                      <td className="px-2.5 py-1.5 font-mono font-medium text-slate-700 align-top whitespace-nowrap">{k}</td>
                      <td className="px-2.5 py-1.5 font-mono text-slate-600 break-all">{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Raw HMRC response</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify(result.raw, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
