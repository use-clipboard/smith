'use client';

/**
 * VatThresholdBanner — top-of-book warnings when turnover approaches/passes a
 * VAT threshold:
 *   • Not registered & taxable turnover near/over the £90k registration limit.
 *   • On the Flat Rate Scheme & turnover near/over the £230k FRS-exit limit.
 *
 * Yellow when approaching (≥90%), red once exceeded. Silent when comfortably
 * under, or when the data can't be loaded — a banner must never block the book.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

type ThresholdLevel = 'ok' | 'approaching' | 'exceeded';
interface ThresholdCheck { threshold: number; value: number; level: ThresholdLevel }
interface VatThresholdStatus {
  registered: boolean;
  scheme: string;
  rolling12Net: number;
  rolling12Gross: number;
  registration: ThresholdCheck | null;
  frsExit: ThresholdCheck | null;
}

const gbp = (n: number) =>
  `£${Math.round(n).toLocaleString('en-GB')}`;

function Banner({ level, children }: { level: 'approaching' | 'exceeded'; children: React.ReactNode }) {
  const cls = level === 'exceeded'
    ? 'border-rose-300 bg-rose-50 text-rose-800'
    : 'border-amber-300 bg-amber-50 text-amber-800';
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${cls}`}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

export default function VatThresholdBanner({ bookId }: { bookId: string }) {
  const [status, setStatus] = useState<VatThresholdStatus | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/bookkeeping/books/${bookId}/vat-thresholds`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d) setStatus(d as VatThresholdStatus); })
      .catch(() => {});
    return () => { alive = false; };
  }, [bookId]);

  if (!status) return null;

  const banners: React.ReactNode[] = [];

  const reg = status.registration;
  if (reg && reg.level !== 'ok') {
    banners.push(
      reg.level === 'exceeded' ? (
        <Banner key="reg" level="exceeded">
          <strong>VAT registration threshold passed.</strong> Taxable turnover over the last 12 months is{' '}
          <strong>{gbp(reg.value)}</strong>, above the {gbp(reg.threshold)} limit. This business should
          register for VAT — record the registration in <strong>Settings → VAT</strong> once done.
        </Banner>
      ) : (
        <Banner key="reg" level="approaching">
          <strong>Approaching the VAT registration threshold.</strong> Taxable turnover over the last 12
          months is <strong>{gbp(reg.value)}</strong> — nearing the {gbp(reg.threshold)} limit. Keep an eye
          on it; registration becomes compulsory once it's passed.
        </Banner>
      ),
    );
  }

  const frs = status.frsExit;
  if (frs && frs.level !== 'ok') {
    banners.push(
      frs.level === 'exceeded' ? (
        <Banner key="frs" level="exceeded">
          <strong>Flat Rate Scheme exit threshold passed.</strong> VAT-inclusive turnover over the last 12
          months is <strong>{gbp(frs.value)}</strong>, above the {gbp(frs.threshold)} limit. This business
          must leave the Flat Rate Scheme — switch it to standard VAT in <strong>Settings → VAT</strong>.
        </Banner>
      ) : (
        <Banner key="frs" level="approaching">
          <strong>Approaching the Flat Rate Scheme exit threshold.</strong> VAT-inclusive turnover over the
          last 12 months is <strong>{gbp(frs.value)}</strong> — nearing the {gbp(frs.threshold)} limit. Plan
          to move to standard VAT before it's passed.
        </Banner>
      ),
    );
  }

  if (banners.length === 0) return null;
  return <div className="space-y-2 print:hidden">{banners}</div>;
}
