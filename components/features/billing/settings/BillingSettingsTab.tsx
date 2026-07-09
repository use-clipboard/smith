'use client';

import { useEffect, useState } from 'react';
import { Save, Lock, Check, Hash, Percent, Building2, Landmark, BookCopy, CreditCard, MailWarning } from 'lucide-react';
import { GlassCard, SectionHeader } from '@/components/features/timesheets/shared/ui';
import type { BillingSettings } from '@/lib/billing/types';
import StageLadderEditor from './StageLadderEditor';

type Editable = Pick<BillingSettings,
  | 'invoicePrefix' | 'creditNotePrefix' | 'defaultPaymentTermsDays' | 'defaultVatRate'
  | 'postToBookkeeping' | 'bookkeepingSalesAccount' | 'firstInvoiceMode'
  | 'businessName' | 'businessAddress' | 'vatNumber' | 'bankDetails' | 'invoiceFooter'
  | 'autoChaseEnabled' | 'chaseWeekdaysOnly' | 'chaseMinBalancePence' | 'chaseReplyTo'>;

const EDITABLE_KEYS: (keyof Editable)[] = [
  'invoicePrefix', 'creditNotePrefix', 'defaultPaymentTermsDays', 'defaultVatRate',
  'postToBookkeeping', 'bookkeepingSalesAccount', 'firstInvoiceMode',
  'businessName', 'businessAddress', 'vatNumber', 'bankDetails', 'invoiceFooter',
  'autoChaseEnabled', 'chaseWeekdaysOnly', 'chaseMinBalancePence', 'chaseReplyTo',
];

export default function BillingSettingsTab() {
  const [form, setForm] = useState<Editable | null>(null);
  const [nextNumbers, setNextNumbers] = useState({ invoice: 1, creditNote: 1 });
  const [canEdit, setCanEdit] = useState(false);
  const [firmName, setFirmName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/billing/settings')
      .then(r => (r.ok ? r.json() : null))
      .then((s: (BillingSettings & { canEdit: boolean; firmName: string }) | null) => {
        if (!s) return;
        setCanEdit(s.canEdit);
        setFirmName(s.firmName);
        setNextNumbers({ invoice: s.nextInvoiceNumber, creditNote: s.nextCreditNoteNumber });
        setForm({
          invoicePrefix: s.invoicePrefix,
          creditNotePrefix: s.creditNotePrefix,
          defaultPaymentTermsDays: s.defaultPaymentTermsDays,
          defaultVatRate: s.defaultVatRate,
          postToBookkeeping: s.postToBookkeeping,
          bookkeepingSalesAccount: s.bookkeepingSalesAccount,
          firstInvoiceMode: s.firstInvoiceMode,
          businessName: s.businessName,
          businessAddress: s.businessAddress,
          vatNumber: s.vatNumber,
          bankDetails: s.bankDetails,
          invoiceFooter: s.invoiceFooter,
          autoChaseEnabled: s.autoChaseEnabled,
          chaseWeekdaysOnly: s.chaseWeekdaysOnly,
          chaseMinBalancePence: s.chaseMinBalancePence,
          chaseReplyTo: s.chaseReplyTo,
        });
      })
      .catch(() => {});
  }, []);

  function set<K extends keyof Editable>(key: K, value: Editable[K]) {
    setForm(f => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    const body: Partial<Editable> = {};
    for (const k of EDITABLE_KEYS) (body as Record<string, unknown>)[k] = form[k];
    const r = await fetch('/api/billing/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  }

  if (!form) {
    return <div className="space-y-4">{Array.from({ length: 3 }, (_, i) => <div key={i} className="h-40 animate-pulse rounded-[20px] bg-white/50" />)}</div>;
  }

  const disabled = !canEdit;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!canEdit && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-700 border border-amber-200">
          <Lock size={14} className="shrink-0" /> Only firm admins can change billing settings. These are read-only for you.
        </div>
      )}

      {/* Invoice numbering */}
      <GlassCard>
        <SectionHeader title="Invoice numbering" subtitle="Prefixes and the next number in each sequence" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField icon={Hash} label="Invoice prefix" value={form.invoicePrefix} onChange={v => set('invoicePrefix', v)} disabled={disabled} hint={`Next: ${form.invoicePrefix}${String(nextNumbers.invoice).padStart(4, '0')}`} />
          <TextField icon={Hash} label="Credit-note prefix" value={form.creditNotePrefix} onChange={v => set('creditNotePrefix', v)} disabled={disabled} hint={`Next: ${form.creditNotePrefix}${String(nextNumbers.creditNote).padStart(4, '0')}`} />
        </div>
      </GlassCard>

      {/* Defaults */}
      <GlassCard>
        <SectionHeader title="Invoice defaults" subtitle="Applied to every new invoice (editable per invoice)" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField icon={Percent} label="Default VAT rate (%)" value={form.defaultVatRate} onChange={v => set('defaultVatRate', v)} disabled={disabled} min={0} max={100} step={0.5} />
          <NumberField icon={CreditCard} label="Payment terms (days)" value={form.defaultPaymentTermsDays} onChange={v => set('defaultPaymentTermsDays', Math.round(v))} disabled={disabled} min={0} max={365} step={1} />
        </div>
      </GlassCard>

      {/* Letterhead */}
      <GlassCard>
        <SectionHeader title="Invoice letterhead" subtitle="Your firm's details, shown at the top of every invoice PDF" />
        <div className="space-y-4">
          <TextField icon={Building2} label="Business name" value={form.businessName} onChange={v => set('businessName', v)} disabled={disabled} placeholder={firmName || 'Your firm name'} />
          <TextAreaField label="Business address" value={form.businessAddress} onChange={v => set('businessAddress', v)} disabled={disabled} rows={3} placeholder={'123 High Street\nTown\nAB1 2CD'} />
          <TextField label="VAT registration number" value={form.vatNumber} onChange={v => set('vatNumber', v)} disabled={disabled} placeholder="GB123456789" />
        </div>
      </GlassCard>

      {/* Remittance */}
      <GlassCard>
        <SectionHeader title="Payment details" subtitle="Bank details and footer note printed on invoices" />
        <div className="space-y-4">
          <TextAreaField icon={Landmark} label="Bank / remittance details" value={form.bankDetails} onChange={v => set('bankDetails', v)} disabled={disabled} rows={3} placeholder={'Bank: Example Bank\nSort code: 00-00-00\nAccount: 12345678'} />
          <TextAreaField label="Invoice footer note" value={form.invoiceFooter} onChange={v => set('invoiceFooter', v)} disabled={disabled} rows={2} placeholder="Thank you for your business. Please pay within the terms above." />
        </div>
      </GlassCard>

      {/* Bookkeeping posting */}
      <GlassCard>
        <SectionHeader title="Bookkeeping" subtitle="Post issued invoices into your own sales ledger" />
        <Toggle
          label="Post invoices to Bookkeeping"
          desc="When on, issuing an invoice posts a matching sale into your firm's Bookkeeping module. (Posting goes live in a later phase — the setting is saved now.)"
          checked={form.postToBookkeeping}
          onChange={v => set('postToBookkeeping', v)}
          disabled={disabled}
          icon={BookCopy}
        />
        {form.postToBookkeeping && (
          <div className="mt-3">
            <TextField label="Sales nominal account" value={form.bookkeepingSalesAccount ?? ''} onChange={v => set('bookkeepingSalesAccount', v)} disabled={disabled} placeholder="e.g. Sales / 4000" />
          </div>
        )}
      </GlassCard>

      {/* Auto-chaser */}
      <GlassCard>
        <SectionHeader title="Auto-chaser" subtitle="Automatically email clients when invoices go overdue" />
        <Toggle
          label="Chase overdue invoices automatically"
          desc="SMITH emails clients on your reminder ladder (below) when an invoice passes its due date. Only sent invoices with a client email are chased; a promise-to-pay pauses chasing until it lapses."
          checked={form.autoChaseEnabled}
          onChange={v => set('autoChaseEnabled', v)}
          disabled={disabled}
          icon={MailWarning}
        />
        {form.autoChaseEnabled && (
          <div className="mt-3 space-y-4">
            <Toggle
              label="Weekdays only"
              desc="Don't send chasers on Saturdays or Sundays."
              checked={form.chaseWeekdaysOnly}
              onChange={v => set('chaseWeekdaysOnly', v)}
              disabled={disabled}
              icon={CreditCard}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField icon={Percent} label="Only chase balances over (£)" value={form.chaseMinBalancePence / 100} onChange={v => set('chaseMinBalancePence', Math.round(v * 100))} disabled={disabled} min={0} max={1_000_000} step={1} />
              <TextField icon={MailWarning} label="Replies go to (email)" value={form.chaseReplyTo} onChange={v => set('chaseReplyTo', v)} disabled={disabled} placeholder="accounts@yourfirm.co.uk" hint="Chasers send from SMITH's verified domain; client replies are directed here." />
            </div>
          </div>
        )}
      </GlassCard>

      {/* Reminder ladder */}
      <StageLadderEditor canEdit={canEdit} />

      {/* Direct debit (forward config) */}
      <GlassCard>
        <SectionHeader title="Direct debit" subtitle="How the first invoice is collected once Stripe Bacs DD is live (Phase D)" />
        <div className="space-y-2">
          <RadioRow label="Collect the first invoice by card immediately, then Direct Debit from month two" value="card_now" current={form.firstInvoiceMode} onChange={v => set('firstInvoiceMode', v)} disabled={disabled} />
          <RadioRow label="Wait for the Direct Debit mandate to confirm (~3 working days) before collecting" value="wait_for_dd" current={form.firstInvoiceMode} onChange={v => set('firstInvoiceMode', v)} disabled={disabled} />
        </div>
      </GlassCard>

      {canEdit && (
        <div className="sticky bottom-0 flex items-center justify-end gap-3 pb-1">
          {saved && <span className="flex items-center gap-1 text-[13px] font-medium text-emerald-600"><Check size={14} /> Saved</span>}
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50"><Save size={15} /> {saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}
    </div>
  );
}

// ── Field primitives ─────────────────────────────────────────────────────────

function labelCls() { return 'mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]'; }
function inputCls(disabled: boolean) {
  return `w-full rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-[13px] outline-none transition focus:border-[var(--accent)] ${disabled ? 'opacity-60' : ''}`;
}

function TextField({ icon: Icon, label, value, onChange, disabled, hint, placeholder }: { icon?: typeof Hash; label: string; value: string; onChange: (v: string) => void; disabled: boolean; hint?: string; placeholder?: string }) {
  return (
    <div>
      <label className={labelCls()}>{Icon && <Icon size={13} className="text-[var(--text-muted)]" />}{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} className={inputCls(disabled)} />
      {hint && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

function NumberField({ icon: Icon, label, value, onChange, disabled, min, max, step }: { icon?: typeof Hash; label: string; value: number; onChange: (v: number) => void; disabled: boolean; min: number; max: number; step: number }) {
  return (
    <div>
      <label className={labelCls()}>{Icon && <Icon size={13} className="text-[var(--text-muted)]" />}{label}</label>
      <input type="number" value={value} min={min} max={max} step={step} onChange={e => onChange(parseFloat(e.target.value) || 0)} disabled={disabled} className={inputCls(disabled)} />
    </div>
  );
}

function TextAreaField({ icon: Icon, label, value, onChange, disabled, rows, placeholder }: { icon?: typeof Hash; label: string; value: string; onChange: (v: string) => void; disabled: boolean; rows: number; placeholder?: string }) {
  return (
    <div>
      <label className={labelCls()}>{Icon && <Icon size={13} className="text-[var(--text-muted)]" />}{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} disabled={disabled} rows={rows} placeholder={placeholder} className={`${inputCls(disabled)} resize-none`} />
    </div>
  );
}

function Toggle({ label, desc, checked, onChange, disabled, icon: Icon }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean; icon: typeof Hash }) {
  return (
    <button onClick={() => !disabled && onChange(!checked)} disabled={disabled} className="flex w-full items-start gap-3 text-left">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Icon size={16} /></div>
      <div className="flex-1">
        <p className="text-[13.5px] font-semibold text-[var(--text-primary)]">{label}</p>
        <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{desc}</p>
      </div>
      <span className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-[var(--accent)]' : 'bg-black/15'} ${disabled ? 'opacity-60' : ''}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function RadioRow({ label, value, current, onChange, disabled }: { label: string; value: 'card_now' | 'wait_for_dd'; current: string; onChange: (v: 'card_now' | 'wait_for_dd') => void; disabled: boolean }) {
  const active = current === value;
  return (
    <button onClick={() => !disabled && onChange(value)} disabled={disabled} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] transition ${active ? 'border-[var(--accent)] bg-[var(--accent)]/[0.05]' : 'border-black/10 hover:bg-black/[0.02]'} ${disabled ? 'opacity-60' : ''}`}>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-[var(--accent)]' : 'border-black/25'}`}>
        {active && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
      </span>
      <span className="text-[var(--text-secondary)]">{label}</span>
    </button>
  );
}
