'use client';

import { useEffect, useRef, useState } from 'react';
import { Save, Lock, Check, Hash, Percent, Building2, Landmark, BookCopy, CreditCard, MailWarning, Mail, Plus, Palette, Upload, Trash2 } from 'lucide-react';
import { GlassCard, SectionHeader } from '@/components/features/timesheets/shared/ui';
import type { BillingSettings } from '@/lib/billing/types';
import { INVOICE_MERGE_TAGS } from '@/lib/billing/invoiceMergeTags';
import StageLadderEditor from './StageLadderEditor';

type Editable = Pick<BillingSettings,
  | 'invoicePrefix' | 'creditNotePrefix' | 'defaultPaymentTermsDays' | 'defaultVatRate'
  | 'postToBookkeeping' | 'bookkeepingSalesAccount' | 'firstInvoiceMode'
  | 'businessName' | 'businessAddress' | 'vatNumber' | 'bankDetails' | 'invoiceFooter'
  | 'autoChaseEnabled' | 'chaseWeekdaysOnly' | 'chaseMinBalancePence' | 'chaseReplyTo'
  | 'vatRegistered' | 'emailSenderMailboxId' | 'invoiceEmailSubject' | 'invoiceEmailBody'
  | 'invoiceAccent' | 'invoiceTemplate' | 'defaultTerms' | 'bookkeepingBookId'>;

const EDITABLE_KEYS: (keyof Editable)[] = [
  'invoicePrefix', 'creditNotePrefix', 'defaultPaymentTermsDays', 'defaultVatRate',
  'postToBookkeeping', 'bookkeepingSalesAccount', 'firstInvoiceMode',
  'businessName', 'businessAddress', 'vatNumber', 'bankDetails', 'invoiceFooter',
  'autoChaseEnabled', 'chaseWeekdaysOnly', 'chaseMinBalancePence', 'chaseReplyTo',
  'vatRegistered', 'emailSenderMailboxId', 'invoiceEmailSubject', 'invoiceEmailBody',
  'invoiceAccent', 'invoiceTemplate', 'defaultTerms', 'bookkeepingBookId',
];

export default function BillingSettingsTab() {
  const [form, setForm] = useState<Editable | null>(null);
  const [nextNumbers, setNextNumbers] = useState({ invoice: 1, creditNote: 1 });
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/billing/settings')
      .then(r => (r.ok ? r.json() : null))
      .then((s: (BillingSettings & { canEdit: boolean; firmName: string }) | null) => {
        if (!s) return;
        setCanEdit(s.canEdit);
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
          vatRegistered: s.vatRegistered,
          emailSenderMailboxId: s.emailSenderMailboxId,
          invoiceEmailSubject: s.invoiceEmailSubject,
          invoiceEmailBody: s.invoiceEmailBody,
          invoiceAccent: s.invoiceAccent,
          invoiceTemplate: s.invoiceTemplate,
          defaultTerms: s.defaultTerms,
          bookkeepingBookId: s.bookkeepingBookId,
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
        <div className="mb-4">
          <Toggle
            label="VAT registered"
            desc="When on, new invoices default to your VAT rate. Turn off if your firm isn't VAT registered — new lines default to 0%."
            checked={form.vatRegistered}
            onChange={v => set('vatRegistered', v)}
            disabled={disabled}
            icon={Percent}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField icon={Percent} label="Default VAT rate (%)" value={form.defaultVatRate} onChange={v => set('defaultVatRate', v)} disabled={disabled || !form.vatRegistered} min={0} max={100} step={0.5} />
          <NumberField icon={CreditCard} label="Default due date (days from issue)" value={form.defaultPaymentTermsDays} onChange={v => set('defaultPaymentTermsDays', Math.round(v))} disabled={disabled} min={0} max={365} step={1} />
        </div>
      </GlassCard>

      {/* Letterhead */}
      <GlassCard>
        <SectionHeader title="Invoice letterhead" subtitle="Your firm's details, shown at the top of every invoice PDF" />
        <div className="space-y-4">
          <TextField icon={Building2} label="Business name" value={form.businessName} onChange={v => set('businessName', v)} disabled={disabled} placeholder="Your firm's name on invoices" />
          <TextAreaField label="Business address" value={form.businessAddress} onChange={v => set('businessAddress', v)} disabled={disabled} rows={3} placeholder={'123 High Street\nTown\nAB1 2CD'} />
          <TextField label="VAT registration number" value={form.vatNumber} onChange={v => set('vatNumber', v)} disabled={disabled} placeholder="GB123456789" />
        </div>
      </GlassCard>

      {/* Invoice design */}
      <InvoiceDesignCard
        accent={form.invoiceAccent}
        template={form.invoiceTemplate}
        disabled={disabled}
        onAccent={v => set('invoiceAccent', v)}
        onTemplate={v => set('invoiceTemplate', v)}
      />

      {/* Remittance */}
      <GlassCard>
        <SectionHeader title="Payment details" subtitle="Bank details and footer note printed on invoices" />
        <div className="space-y-4">
          <TextAreaField icon={Landmark} label="Bank / remittance details" value={form.bankDetails} onChange={v => set('bankDetails', v)} disabled={disabled} rows={3} placeholder={'Bank: Example Bank\nSort code: 00-00-00\nAccount: 12345678'} />
          <TextAreaField label="Invoice footer note" value={form.invoiceFooter} onChange={v => set('invoiceFooter', v)} disabled={disabled} rows={2} placeholder="Thank you for your business. Please pay within the terms above." />
          <TextAreaField label="Terms & conditions (printed at the bottom of every invoice)" value={form.defaultTerms} onChange={v => set('defaultTerms', v)} disabled={disabled} rows={3} placeholder="Payment is due within the stated terms. Late payment may incur statutory interest." />
        </div>
      </GlassCard>

      {/* Invoice emails */}
      <InvoiceEmailCard
        mailboxId={form.emailSenderMailboxId}
        subject={form.invoiceEmailSubject}
        body={form.invoiceEmailBody}
        disabled={disabled}
        onMailbox={v => set('emailSenderMailboxId', v)}
        onSubject={v => set('invoiceEmailSubject', v)}
        onBody={v => set('invoiceEmailBody', v)}
      />

      {/* Bookkeeping posting */}
      <GlassCard>
        <SectionHeader title="Bookkeeping" subtitle="Post issued invoices into your own sales ledger" />
        <Toggle
          label="Post invoices to Bookkeeping"
          desc="When on, issuing (sending) an invoice posts a matching sale into the chosen Bookkeeping book — Dr Trade debtors, Cr Sales, Cr VAT."
          checked={form.postToBookkeeping}
          onChange={v => set('postToBookkeeping', v)}
          disabled={disabled}
          icon={BookCopy}
        />
        {form.postToBookkeeping && (
          <div className="mt-3 space-y-3">
            <BookPicker value={form.bookkeepingBookId} onChange={v => set('bookkeepingBookId', v)} disabled={disabled} />
            <TextField label="Sales nominal account (optional)" value={form.bookkeepingSalesAccount ?? ''} onChange={v => set('bookkeepingSalesAccount', v)} disabled={disabled} placeholder="Leave blank to use the book's Sales account" />
            {!form.bookkeepingBookId && <p className="text-[11px] text-amber-600">Choose a book — posting is skipped until one is selected.</p>}
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

      {/* Stripe / card payments */}
      <StripeStatusCard />

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

// ── Bookkeeping book picker ───────────────────────────────────────────────────

function BookPicker({ value, onChange, disabled }: { value: string | null; onChange: (v: string | null) => void; disabled: boolean }) {
  const [books, setBooks] = useState<{ id: string; name: string; client?: { name?: string } | { name?: string }[] | null }[]>([]);
  useEffect(() => { fetch('/api/bookkeeping/books').then(r => (r.ok ? r.json() : null)).then(d => setBooks(d?.books ?? [])).catch(() => {}); }, []);
  const clientName = (c: { name?: string } | { name?: string }[] | null | undefined) => (Array.isArray(c) ? c[0]?.name : c?.name) ?? '';
  return (
    <div>
      <label className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]"><BookCopy size={13} className="text-[var(--text-muted)]" />Bookkeeping book</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} disabled={disabled} className="w-full rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60">
        <option value="">— choose a book —</option>
        {books.map(b => <option key={b.id} value={b.id}>{b.name}{clientName(b.client) ? ` · ${clientName(b.client)}` : ''}</option>)}
      </select>
      {books.length === 0 && <p className="mt-1 text-[11px] text-[var(--text-muted)]">No bookkeeping books yet — create one in the Bookkeeping tool first.</p>}
    </div>
  );
}

// ── Invoice design card (template + accent + logo) ────────────────────────────

const ACCENT_PRESETS = ['#7C3AED', '#2563EB', '#0EA5E9', '#059669', '#DC2626', '#EA580C', '#DB2777', '#0F172A'];
const TEMPLATES: { id: 'modern' | 'classic' | 'minimal'; label: string; desc: string }[] = [
  { id: 'modern', label: 'Modern', desc: 'Coloured title + accent rule' },
  { id: 'classic', label: 'Classic', desc: 'Accent top bar' },
  { id: 'minimal', label: 'Minimal', desc: 'Monochrome, thin lines' },
];

function InvoiceDesignCard({ accent, template, disabled, onAccent, onTemplate }: {
  accent: string; template: 'modern' | 'classic' | 'minimal'; disabled: boolean;
  onAccent: (v: string) => void; onTemplate: (v: 'modern' | 'classic' | 'minimal') => void;
}) {
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetch('/api/billing/logo').then(r => (r.ok ? r.json() : null)).then(d => setLogo(d?.dataUrl ?? null)).catch(() => {}); }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (file) e.target.value = '';
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/billing/logo', { method: 'POST', body: fd });
    setBusy(false);
    if (r.ok) { const d = await r.json(); setLogo(d.dataUrl); } else alert('Could not upload logo.');
  }
  async function removeLogo() { setBusy(true); await fetch('/api/billing/logo', { method: 'DELETE' }); setLogo(null); setBusy(false); }

  return (
    <GlassCard>
      <SectionHeader title="Invoice design" subtitle="Template, brand colour and logo for the invoice PDF & client portal" />
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]"><Palette size={13} className="text-[var(--text-muted)]" />Template</label>
          <div className="grid grid-cols-3 gap-2">
            {TEMPLATES.map(t => (
              <button key={t.id} onClick={() => !disabled && onTemplate(t.id)} disabled={disabled}
                className={`rounded-xl border p-3 text-left transition ${template === t.id ? 'border-[var(--accent)] bg-[var(--accent)]/[0.06]' : 'border-black/10 hover:bg-black/[0.02]'} ${disabled ? 'opacity-60' : ''}`}>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">{t.label}</div>
                <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">Brand colour</label>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map(c => (
              <button key={c} onClick={() => !disabled && onAccent(c)} disabled={disabled} aria-label={c}
                className={`h-7 w-7 rounded-full transition ${accent.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-offset-2 ring-black/30' : ''}`} style={{ background: c }} />
            ))}
            <input type="color" value={accent} onChange={e => onAccent(e.target.value)} disabled={disabled} className="h-7 w-9 cursor-pointer rounded border border-black/10 bg-transparent" />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">Logo</label>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="hidden" />
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-lg border border-black/10 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logo ? <img src={logo} alt="Logo" className="max-h-14 max-w-[112px] object-contain" /> : <span className="text-[11px] text-[var(--text-muted)]">No logo</span>}
            </div>
            {!disabled && (
              <div className="flex flex-col gap-1.5">
                <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-secondary text-[12px] disabled:opacity-50"><Upload size={13} /> {logo ? 'Replace' : 'Upload'}</button>
                {logo && <button onClick={removeLogo} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline"><Trash2 size={12} /> Remove</button>}
              </div>
            )}
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">PNG, JPEG or WebP, under 2 MB. Appears top-left on the invoice.</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Invoice-email card ───────────────────────────────────────────────────────

function InvoiceEmailCard({ mailboxId, subject, body, disabled, onMailbox, onSubject, onBody }: {
  mailboxId: string | null; subject: string; body: string; disabled: boolean;
  onMailbox: (v: string | null) => void; onSubject: (v: string) => void; onBody: (v: string) => void;
}) {
  const [mailboxes, setMailboxes] = useState<{ id: string; google_email: string; label: string | null }[]>([]);
  useEffect(() => {
    fetch('/api/tasks/sending-mailboxes').then(r => (r.ok ? r.json() : null)).then(d => setMailboxes(d?.mailboxes ?? [])).catch(() => {});
  }, []);

  return (
    <GlassCard>
      <SectionHeader title="Invoice emails" subtitle="Send invoices from a firm Gmail, with a customisable template" />
      <div className="space-y-4">
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-secondary)]"><Mail size={13} className="text-[var(--text-muted)]" />Send invoices from</label>
          {mailboxes.length === 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-dashed border-black/15 bg-black/[0.02] px-3 py-2.5 text-[13px]">
              <span className="text-[var(--text-muted)]">No firm email connected.</span>
              <a href="/api/tasks/sending-mailboxes/connect" className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Connect a firm email</a>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select value={mailboxId ?? ''} onChange={e => onMailbox(e.target.value || null)} disabled={disabled}
                className="h-9 flex-1 rounded-lg border border-black/10 bg-white/70 px-3 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60">
                <option value="">— choose a mailbox —</option>
                {mailboxes.map(m => <option key={m.id} value={m.id}>{m.label ? `${m.label} · ` : ''}{m.google_email}</option>)}
              </select>
              <a href="/api/tasks/sending-mailboxes/connect" className="shrink-0 text-[12px] font-semibold text-[var(--accent)] hover:underline">Connect another</a>
            </div>
          )}
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Firm mailboxes are shared with Tasks. Connecting one here makes it available to both.</p>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Subject template</label>
          <input value={subject} onChange={e => onSubject(e.target.value)} disabled={disabled} className="w-full rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60" />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Message template</label>
          <textarea value={body} onChange={e => onBody(e.target.value)} disabled={disabled} rows={6} className="w-full resize-none rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)] disabled:opacity-60" />
          {!disabled && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">Insert:</span>
              {INVOICE_MERGE_TAGS.map(t => (
                <button key={t.tag} onClick={() => onBody(`${body}${t.tag}`)} title={`${t.label} — e.g. ${t.example}`}
                  className="rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20">{t.label}</button>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">A &ldquo;View &amp; pay invoice&rdquo; button linking to the client&rsquo;s secure statement is added to every email automatically.</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Stripe status card ───────────────────────────────────────────────────────

function StripeStatusCard() {
  const [status, setStatus] = useState<{ configured: boolean; webhookConfigured: boolean } | null>(null);
  useEffect(() => {
    fetch('/api/billing/stripe/status').then(r => (r.ok ? r.json() : null)).then(setStatus).catch(() => {});
  }, []);

  const configured = status?.configured ?? false;
  return (
    <GlassCard>
      <SectionHeader title="Card payments & Direct Debit (Stripe)" subtitle="Take card payments and Bacs Direct Debit through Stripe" />
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${configured ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
          <span className={`h-2 w-2 rounded-full ${configured ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {configured ? 'Connected' : 'Not connected'}
        </span>
        {configured && !status?.webhookConfigured && (
          <span className="text-[12px] text-amber-600">Webhook secret missing — payments won&apos;t auto-record until set.</span>
        )}
      </div>
      {!configured && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          Set <code className="rounded bg-black/5 px-1">STRIPE_SECRET_KEY</code>, <code className="rounded bg-black/5 px-1">STRIPE_WEBHOOK_SECRET</code> and
          <code className="ml-1 rounded bg-black/5 px-1">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> in your environment, and point a Stripe webhook at
          <code className="ml-1 rounded bg-black/5 px-1">/api/billing/stripe/webhook</code> (events: <em>checkout.session.completed</em>). Then &ldquo;Pay by card&rdquo; links and Direct Debit mandates go live.
        </p>
      )}
    </GlassCard>
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
