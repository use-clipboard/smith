'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Building2, FileText, MapPin, Phone, Calendar, CalendarClock, Banknote } from 'lucide-react';
import { StudioCard } from '../primitives';
import { ct600PaymentDue, ct600FilingDue } from '../calc';
import { fmtDateUK } from '../data';
import { fetchJson } from '@/lib/fetchJson';
import type { TaxReturn } from '../types';

// The subset of the client record we read to seed the company return.
interface ClientRecord {
  registration_number?: string | null;
  utr_number?: string | null;
  address?: string | null;
  contact_number?: string | null;
}

export default function StageSetupCt600({
  ret, patch, advance,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}): JSX.Element {
  const [regNumber, setRegNumber] = useState('');
  // Pull the company's registered details from the linked client record and
  // seed any return fields that are still empty (never overwrite existing edits).
  const pulled = useRef(false);
  useEffect(() => {
    if (pulled.current) return;
    if (!ret.clientId) return;
    pulled.current = true;
    (async () => {
      try {
        const { client } = await fetchJson<{ client: ClientRecord }>(`/api/clients/${ret.clientId}`, { cache: 'no-store' });
        setRegNumber(client.registration_number ?? '');
        patch(r => ({
          ...r,
          utr: r.utr ? r.utr : (client.utr_number ?? r.utr ?? null),
          taxpayer: {
            ...r.taxpayer,
            address: r.taxpayer?.address ? r.taxpayer.address : (client.address ?? ''),
            phone: r.taxpayer?.phone ? r.taxpayer.phone : (client.contact_number ?? ''),
          },
        }));
      } catch {
        // Client fetch is best-effort — the user can key the details in by hand.
      }
    })();
  }, [ret.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const paymentDue = ct600PaymentDue(ret.periodEnd);
  const filingDue = ct600FilingDue(ret.periodEnd);

  return (
    <div className="space-y-4">
      <StudioCard className="p-5">
        <div className="mb-3 flex items-center gap-1.5">
          <Building2 size={15} className="text-[var(--accent)]" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Company details</h3>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ReadField icon={Building2} label="Company name" value={ret.clientName || '—'} />
          <ReadField icon={FileText} label="Company registration number" value={regNumber || '—'} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>CT Unique Taxpayer Reference</Label>
            <input
              value={ret.utr ?? ''}
              onChange={e => patch(r => ({ ...r, utr: e.target.value }))}
              placeholder="10-digit CT UTR"
              className="input-base py-1.5 text-sm"
            />
          </div>
          <div>
            <Label icon={Phone}>Phone</Label>
            <input
              value={ret.taxpayer?.phone ?? ''}
              onChange={e => patch(r => ({ ...r, taxpayer: { ...r.taxpayer, phone: e.target.value } }))}
              placeholder="e.g. 0113 496 0000"
              className="input-base py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="mt-4">
          <Label icon={MapPin}>Registered office address</Label>
          <textarea
            value={ret.taxpayer?.address ?? ''}
            onChange={e => patch(r => ({ ...r, taxpayer: { ...r.taxpayer, address: e.target.value } }))}
            rows={3}
            placeholder="Registered office address"
            className="input-base resize-none py-2 text-sm"
          />
        </div>
      </StudioCard>

      <StudioCard className="p-5">
        <div className="mb-3 flex items-center gap-1.5">
          <Calendar size={15} className="text-[var(--accent)]" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Accounting period</h3>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Period</p>
          <p className="text-[15px] font-bold text-[var(--text-primary)]">
            {fmtDateUK(ret.periodStart ?? '')} – {fmtDateUK(ret.periodEnd ?? '')}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Set when the return was created</p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KeyDate icon={Banknote} label="Payment due" value={fmtDateUK(paymentDue)} hint="9 months + 1 day after period end" />
          <KeyDate icon={CalendarClock} label="Filing deadline" value={fmtDateUK(filingDue)} hint="12 months after period end" />
        </div>
      </StudioCard>

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Continue to analyse <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Label({ icon: Icon, children }: { icon?: typeof FileText; children: React.ReactNode }) {
  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
      {Icon && <Icon size={12} />} {children}
    </label>
  );
}

function ReadField({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Icon size={12} /> {label}</p>
      <p className="rounded-lg border border-[var(--border)] bg-white/60 px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function KeyDate({ icon: Icon, label, value, hint }: { icon: typeof FileText; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Icon size={12} /> {label}</p>
      <p className="text-[15px] font-bold text-[var(--text-primary)]">{value}</p>
      <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}
