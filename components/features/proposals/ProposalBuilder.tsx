'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, Plus, Trash2, Send, Save, AlertTriangle, Check, Copy, Eye, Package as PackageIcon, X,
  Ban, Bell, Clock, Sparkles, Wand2, CopyPlus,
} from 'lucide-react';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import { EMAIL_SENT_EVENT } from '@/components/features/email/GlobalComposeWindow';
import { useModules } from '@/components/ui/ModulesProvider';
import ProposalPreviewModal from './ProposalPreviewModal';

type Frequency = 'one_off' | 'monthly' | 'quarterly' | 'annual';
type VatTreatment = 'inclusive' | 'exclusive' | 'exempt';

interface Tier { id: string; label: string; price: number; frequency: Frequency }
interface Service {
  id: string;
  name: string;
  description: string | null;
  fee_type: 'fixed' | 'tiered';
  base_price: number;
  frequency: Frequency;
  vat_treatment: 'firm_default' | VatTreatment;
  active: boolean;
  tiers?: Tier[];
}

interface OfferedPackage {
  id: string;            // client-side temp id OR server uuid
  name: string;
  description: string | null;
  display_order?: number;
  isPersisted?: boolean;
}

interface LineItem {
  id: string;
  offered_package_id: string | null; // null => one shared list (no packages on this proposal)
  service_id: string | null;
  service_name: string;
  description: string | null;
  tier_label: string | null;
  frequency: Frequency;
  unit_price: number;
  quantity: number;
  vat_treatment: VatTreatment;
  display_order?: number;
}

interface ProposalRow {
  id: string;
  title: string;
  intro: string | null;
  terms: string | null;
  notes_internal: string | null;
  vat_mode: 'inclusive' | 'exclusive';
  vat_rate: number;
  discount_amount: number;
  discount_type: 'amount' | 'percent';
  discount_label: string | null;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  public_token: string | null;
  expires_at: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  decided_at: string | null;
  decline_reason: string | null;
  onboarding_response_id: string | null;
  /** What happens automatically when the prospect accepts this proposal.
   *  See migration 20260614 for the full enum semantics. */
  post_acceptance_action: 'none' | 'send_onboarding' | 'auto_create_client';
  post_acceptance_onboarding_form_id: string | null;
  /** How the prospect-facing totals block summarises the proposal. See
   *  migration 20260614 for the semantics. */
  totals_display: 'first_year' | 'monthly';
  prospect: { id: string; contact_name: string; company_name: string | null; email: string };
  offered_packages: Array<OfferedPackage & { total_one_off: number; total_monthly: number; total_annual: number }>;
  line_items: Array<LineItem & { id: string }>;
  signature?: { signer_name: string; signed_at: string } | null;
}

interface Props {
  proposalId: string;
}

let _id = 0;
function tmpId(prefix: string) { _id++; return `${prefix}_${Date.now()}_${_id}`; }

/** Onboarding form reference for the "When accepted, send this form" picker. */
interface OnboardingFormRef { id: string; name: string; client_type: string | null; is_default: boolean; active: boolean; }

export default function ProposalBuilder({ proposalId }: Props) {
  const [proposal, setProposal] = useState<ProposalRow | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [onboardingForms, setOnboardingForms] = useState<OnboardingFormRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<OfferedPackage[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  // Tracks whether we've handed a proposal off to the Compose window and
  // are still waiting on the user to either send or cancel. Used to scope
  // the EMAIL_SENT_EVENT listener so unrelated email sends elsewhere in
  // the app don't accidentally flip THIS proposal to "sent".
  const [awaitingCompose, setAwaitingCompose] = useState(false);
  const compose = useComposeWindow();
  const { isModuleActive } = useModules();
  // Compose-based send is only available when the firm has Email Triage
  // enabled — that's where the linked Gmail account lives. Without it we
  // can't open the compose window, so the button stays disabled rather
  // than silently sending via Resend behind the user's back.
  const emailTriageActive = isModuleActive('email-triage');

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, sRes, fRes] = await Promise.all([
      fetch(`/api/proposals/${proposalId}`).then(r => r.json()),
      fetch('/api/proposals/services').then(r => r.json()),
      // Onboarding-form templates for the "When accepted, send this form" picker.
      // Best-effort — if the endpoint fails the dropdown just shows "(firm default)".
      fetch('/api/proposals/onboarding-forms').then(r => r.ok ? r.json() : { forms: [] }).catch(() => ({ forms: [] })),
    ]);
    const p = pRes.proposal as ProposalRow;
    setProposal(p);
    const pkgs = (p.offered_packages ?? [])
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      .map(pk => ({ id: pk.id, name: pk.name, description: pk.description, display_order: pk.display_order ?? 0, isPersisted: true }));
    setPackages(pkgs);
    setItems(p.line_items.map(li => ({ ...li })));
    setServices(sRes.services ?? []);
    setOnboardingForms((fRes.forms ?? []) as OnboardingFormRef[]);
    setLoading(false);
  }, [proposalId]);
  useEffect(() => { void load(); }, [load]);

  // Listen for a successful send from the Compose window. The browser
  // dispatches `smith:email-sent` on the window object whenever Compose
  // dispatches a fresh email. When that fires while we're waiting on the
  // user to send, mark the proposal as 'sent' and reload to pick up the
  // new status. If Compose is closed without a send, the listener simply
  // never fires and the proposal stays in draft state.
  useEffect(() => {
    if (!awaitingCompose) return;
    function onSent() {
      setAwaitingCompose(false);
      void fetch(`/api/proposals/${proposalId}/mark-sent`, { method: 'POST' })
        .then(() => load())
        .catch(err => console.error('[proposals] mark-sent failed', err));
    }
    window.addEventListener(EMAIL_SENT_EVENT, onSent);
    return () => window.removeEventListener(EMAIL_SENT_EVENT, onSent);
  }, [awaitingCompose, proposalId, load]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  function update<K extends keyof ProposalRow>(k: K, v: ProposalRow[K]) {
    setProposal(p => p ? { ...p, [k]: v } : p);
  }

  function addPackage() {
    const next: OfferedPackage = { id: tmpId('pkg'), name: `Package ${packages.length + 1}`, description: null, display_order: packages.length };
    setPackages([...packages, next]);
  }
  function removePackage(id: string) {
    setPackages(packages.filter(p => p.id !== id));
    setItems(items.filter(li => li.offered_package_id !== id));
  }
  function updatePackage(id: string, patch: Partial<OfferedPackage>) {
    setPackages(packages.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  function addServiceTo(packageId: string | null, service: Service, tier?: Tier) {
    const li: LineItem = {
      id: tmpId('li'),
      offered_package_id: packageId,
      service_id: service.id,
      service_name: service.name,
      description: service.description,
      tier_label: tier?.label ?? null,
      frequency: tier?.frequency ?? service.frequency,
      unit_price: tier?.price ?? Number(service.base_price ?? 0),
      quantity: 1,
      vat_treatment: service.vat_treatment === 'firm_default' ? (proposal?.vat_mode ?? 'exclusive') : (service.vat_treatment as VatTreatment),
      display_order: items.length,
    };
    setItems([...items, li]);
  }
  function addCustomLine(packageId: string | null) {
    const li: LineItem = {
      id: tmpId('li'),
      offered_package_id: packageId,
      service_id: null,
      service_name: 'Custom line',
      description: null,
      tier_label: null,
      frequency: 'monthly',
      unit_price: 0,
      quantity: 1,
      vat_treatment: proposal?.vat_mode ?? 'exclusive',
      display_order: items.length,
    };
    setItems([...items, li]);
  }
  function updateItem(id: string, patch: Partial<LineItem>) {
    setItems(items.map(li => li.id === id ? { ...li, ...patch } : li));
  }
  function removeItem(id: string) {
    setItems(items.filter(li => li.id !== id));
  }

  // ── Totals (per package + grand) ───────────────────────────────────────
  const totals = useMemo(() => {
    // Per-frequency subtotals — each frequency is tracked separately so
    // the display can show only the ones with non-zero items.
    const calc = (ls: LineItem[]) => {
      let one_off = 0, monthly = 0, quarterly = 0, annual = 0;
      for (const li of ls) {
        const sub = Number(li.unit_price) * Number(li.quantity);
        if (li.frequency === 'one_off')        one_off   += sub;
        else if (li.frequency === 'monthly')   monthly   += sub;
        else if (li.frequency === 'quarterly') quarterly += sub;
        else if (li.frequency === 'annual')    annual    += sub;
      }
      return { one_off, monthly, quarterly, annual };
    };
    const perPackage = new Map<string, ReturnType<typeof calc>>();
    for (const pk of packages) {
      perPackage.set(pk.id, calc(items.filter(li => li.offered_package_id === pk.id)));
    }
    const standalone = items.filter(li => li.offered_package_id === null);
    return { perPackage, standalone: calc(standalone), discount: Number(proposal?.discount_amount ?? 0) };
  }, [packages, items, proposal?.discount_amount]);

  async function handleSave(options: { silent?: boolean } = {}) {
    if (!proposal) return;
    setSaving(true); setError(null);
    try {
      const body = {
        title: proposal.title,
        intro: proposal.intro,
        terms: proposal.terms,
        notes_internal: proposal.notes_internal,
        vat_mode: proposal.vat_mode,
        vat_rate: Number(proposal.vat_rate),
        discount_amount: Number(proposal.discount_amount ?? 0),
        discount_type:   proposal.discount_type ?? 'amount',
        discount_label: proposal.discount_label,
        expires_at: proposal.expires_at,
        post_acceptance_action: proposal.post_acceptance_action ?? 'send_onboarding',
        post_acceptance_onboarding_form_id: proposal.post_acceptance_onboarding_form_id,
        totals_display: proposal.totals_display ?? 'first_year',
        packages: packages.map((p, i) => ({
          id: p.isPersisted ? p.id : undefined,
          name: p.name,
          description: p.description,
          display_order: i,
        })),
        line_items: items.map((li, i) => ({
          offered_package_id: li.offered_package_id,
          service_id: li.service_id,
          service_name: li.service_name,
          description: li.description,
          tier_label: li.tier_label,
          frequency: li.frequency,
          unit_price: Number(li.unit_price),
          quantity: Number(li.quantity),
          vat_treatment: li.vat_treatment,
          display_order: i,
        })),
      };
      // The PATCH server returns ok; we then reload to get fresh server-side IDs
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      await load();
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  async function handleSend() {
    if (!proposal) return;
    // Save first so the draft on disk matches what the prospect will see.
    await handleSave({ silent: true });
    setSending(true); setError(null);
    try {
      // prepare_only: true commits status / totals / token server-side
      // but returns the rendered email body so we can hand it to the
      // in-app Compose window. The user does the actual send via their
      // own Gmail, mirroring the MTD IT approval flow.
      const res = await fetch(`/api/proposals/${proposalId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prepare_only: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Send failed');
      const prepared = data.prepared as { to_email: string; to_name: string; subject: string; html_body: string } | undefined;
      if (!prepared) throw new Error('Backend did not return prepared email payload.');

      // Open Compose pre-filled. Prospects aren't clients yet so we pass
      // no defaultClients — Compose is happy with a recipient-only send.
      // We DON'T flip the local proposal status yet; the EMAIL_SENT_EVENT
      // listener above handles that once Compose actually dispatches the
      // email. This way a user who opens Compose then cancels leaves the
      // proposal as a draft (with a token + computed totals, ready for a
      // retry). The token is committed server-side either way so the
      // "View proposal" link in the Compose body is live.
      setAwaitingCompose(true);
      compose.open({
        defaultTo:      [{ name: prepared.to_name, email: prepared.to_email }],
        defaultSubject: prepared.subject,
        prefilledBody:  prepared.html_body,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally { setSending(false); }
  }

  async function handleWithdraw() {
    if (!proposal) return;
    if (!confirm('Withdraw this proposal? The public link will stop working and the prospect can no longer accept.')) return;
    try {
      const res = await fetch(`/api/proposals/${proposalId}/withdraw`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Withdraw failed');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Withdraw failed'); }
  }

  async function handleSuggestIntro() {
    if (!proposal) return;
    if (proposal.intro && !confirm('Replace the current intro paragraph with an AI-generated one?')) return;
    try {
      const res = await fetch(`/api/proposals/${proposalId}/suggest-intro`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Generation failed');
      update('intro', data.intro);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleDuplicate() {
    if (!proposal) return;
    if (!confirm('Duplicate this proposal as a new draft?')) return;
    try {
      const res = await fetch(`/api/proposals/${proposalId}/duplicate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Duplicate failed');
      alert(`Duplicated. The new draft is in your proposals dashboard.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Duplicate failed'); }
  }

  async function handleSuggestFollowup() {
    if (!proposal) return;
    try {
      const res = await fetch(`/api/proposals/${proposalId}/suggest-followup`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Generation failed');
      const message = `Subject: ${data.subject}\n\n${data.body}`;
      await navigator.clipboard.writeText(message).catch(() => {});
      alert(`Drafted follow-up copied to clipboard:\n\n${message}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleRemind() {
    if (!proposal) return;
    const note = prompt('Optional message to include in the reminder (leave blank for the default):') ?? '';
    try {
      const res = await fetch(`/api/proposals/${proposalId}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: note.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Reminder failed');
      alert(`Reminder sent to ${proposal.prospect.email}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Reminder failed'); }
  }

  if (loading || !proposal) {
    return <div className="text-center py-12 text-sm text-[#5b21b6]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading proposal…</div>;
  }

  const readonly = proposal.status === 'accepted' || proposal.status === 'declined';
  const isLive = proposal.status === 'sent' || proposal.status === 'viewed';

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="bg-white border border-[var(--border)] rounded-xl p-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--text-muted)]">To {proposal.prospect.contact_name}{proposal.prospect.company_name ? ` · ${proposal.prospect.company_name}` : ''} · {proposal.prospect.email}</p>
            <input value={proposal.title} onChange={e => update('title', e.target.value)} disabled={readonly} className="input-base text-lg font-semibold w-full mt-1" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill status={proposal.status} />
            {/* Live preview — works at any point (including drafts), uses
                the in-memory form state so changes show up immediately. */}
            <button
              onClick={() => setShowPreview(true)}
              className="btn-secondary text-xs inline-flex items-center gap-1"
            >
              <Eye size={11} />Preview proposal
            </button>
            {proposal.public_token && (
              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/p/${proposal.public_token}`)} className="btn-secondary text-xs inline-flex items-center gap-1"><Copy size={11} />Copy link</button>
            )}
            {proposal.public_token && (
              <a href={`/p/${proposal.public_token}`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs inline-flex items-center gap-1"><Eye size={11} />Open public link</a>
            )}
            {isLive && (
              <button onClick={() => void handleRemind()} className="btn-secondary text-xs inline-flex items-center gap-1"><Bell size={11} />Send reminder</button>
            )}
            {isLive && (
              <button onClick={() => void handleWithdraw()} className="btn-secondary text-xs inline-flex items-center gap-1 text-red-700 border-red-200 hover:bg-red-50"><Ban size={11} />Withdraw</button>
            )}
            <button onClick={() => void handleDuplicate()} className="btn-secondary text-xs inline-flex items-center gap-1"><CopyPlus size={11} />Duplicate</button>
            {proposal.status === 'declined' && proposal.decline_reason && (
              <button onClick={() => void handleSuggestFollowup()} className="btn-secondary text-xs inline-flex items-center gap-1 text-[var(--accent)]"><Wand2 size={11} />AI follow-up</button>
            )}
          </div>
        </div>

        {/* Activity timeline */}
        {(proposal.sent_at || proposal.first_viewed_at || proposal.decided_at || proposal.expires_at) && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
            <Clock size={11} className="text-[var(--text-muted)]" />
            {proposal.sent_at && <span>Sent <strong className="text-[var(--text-secondary)]">{fmtDateTime(proposal.sent_at)}</strong></span>}
            {proposal.first_viewed_at && <span>First viewed <strong className="text-[var(--text-secondary)]">{fmtDateTime(proposal.first_viewed_at)}</strong></span>}
            {proposal.last_viewed_at && proposal.last_viewed_at !== proposal.first_viewed_at && (
              <span>Last viewed <strong className="text-[var(--text-secondary)]">{fmtDateTime(proposal.last_viewed_at)}</strong></span>
            )}
            {proposal.decided_at && (
              <span>{proposal.status === 'accepted' ? 'Accepted' : proposal.status === 'declined' ? 'Declined' : 'Decided'} <strong className="text-[var(--text-secondary)]">{fmtDateTime(proposal.decided_at)}</strong></span>
            )}
            {proposal.expires_at && !proposal.decided_at && (
              <span>Expires <strong className="text-[var(--text-secondary)]">{fmtDateTime(proposal.expires_at)}</strong></span>
            )}
            {proposal.decline_reason && (
              <span className="basis-full text-red-700 mt-0.5">Reason: {proposal.decline_reason}</span>
            )}
          </div>
        )}

        {/* Onboarding status — visible once accepted */}
        {proposal.status === 'accepted' && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap text-xs">
            {proposal.onboarding_response_id ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700"><Check size={12} />Onboarding form submitted</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">Awaiting onboarding form submission from prospect</span>
            )}
            {proposal.public_token && !proposal.onboarding_response_id && (
              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/p/${proposal.public_token}/onboarding`)} className="btn-secondary text-xs inline-flex items-center gap-1">
                <Copy size={11} />Copy onboarding link
              </button>
            )}
          </div>
        )}
      </div>

      {/* Intro + meta */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Intro paragraph</span>
              {!readonly && (
                <button onClick={() => void handleSuggestIntro()} className="text-[11px] text-[var(--accent)] hover:underline inline-flex items-center gap-1"><Sparkles size={11} />Suggest with AI</button>
              )}
            </div>
            <textarea value={proposal.intro ?? ''} onChange={e => update('intro', e.target.value || null)} disabled={readonly} rows={4} className="input-base text-sm w-full" placeholder="Thanks for getting in touch. We've put together a proposal based on what we discussed…" />
          </div>
          <Field label="Terms (shown to the prospect on the proposal page)">
            <textarea value={proposal.terms ?? ''} onChange={e => update('terms', e.target.value || null)} disabled={readonly} rows={3} className="input-base text-sm w-full" />
          </Field>
          <Field label="Internal notes (not shown to the prospect)">
            <textarea value={proposal.notes_internal ?? ''} onChange={e => update('notes_internal', e.target.value || null)} disabled={readonly} rows={2} className="input-base text-sm w-full" />
          </Field>
        </div>
        <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
          <Field label="VAT mode">
            <select value={proposal.vat_mode} onChange={e => update('vat_mode', e.target.value as 'inclusive' | 'exclusive')} disabled={readonly} className="input-base text-sm w-full">
              <option value="exclusive">VAT-exclusive</option>
              <option value="inclusive">VAT-inclusive</option>
            </select>
          </Field>
          <Field label="VAT rate %"><input type="number" step="0.01" value={proposal.vat_rate} onChange={e => update('vat_rate', Number(e.target.value))} disabled={readonly} className="input-base text-sm w-full" /></Field>
          <Field label={proposal.discount_type === 'percent' ? 'Discount % (off the first-year total)' : 'Discount £ (off the first-year total)'}>
            <div className="flex gap-2">
              <input
                type="number"
                step={proposal.discount_type === 'percent' ? '0.1' : '0.01'}
                min={0}
                max={proposal.discount_type === 'percent' ? 100 : undefined}
                value={proposal.discount_amount}
                onChange={e => update('discount_amount', Number(e.target.value))}
                disabled={readonly}
                className="input-base text-sm flex-1"
              />
              <select
                value={proposal.discount_type ?? 'amount'}
                onChange={e => update('discount_type', e.target.value as 'amount' | 'percent')}
                disabled={readonly}
                className="input-base text-sm w-20"
                aria-label="Discount type"
              >
                <option value="amount">£</option>
                <option value="percent">%</option>
              </select>
            </div>
          </Field>
          <Field label="Discount label"><input value={proposal.discount_label ?? ''} onChange={e => update('discount_label', e.target.value || null)} disabled={readonly} className="input-base text-sm w-full" placeholder="e.g. First-year welcome" /></Field>
          <Field label="Expires (optional)"><input type="date" value={proposal.expires_at ? proposal.expires_at.slice(0, 10) : ''} onChange={e => update('expires_at', e.target.value || null)} disabled={readonly} className="input-base text-sm w-full" /></Field>
          <Field label="Totals headline">
            <select
              value={proposal.totals_display ?? 'first_year'}
              onChange={e => update('totals_display', e.target.value as 'first_year' | 'monthly')}
              disabled={readonly}
              className="input-base text-sm w-full"
            >
              <option value="first_year">First-year total (annual figure)</option>
              <option value="monthly">Monthly retainer (no annual line)</option>
            </select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Pick &ldquo;Monthly&rdquo; when the proposal is an ongoing retainer (bookkeeping, payroll, etc.). The discount will be expressed per-month too.
            </p>
          </Field>
        </div>
      </div>

      {/* ── When accepted ────────────────────────────────────────────────────
          What happens automatically the moment the prospect clicks Accept.
          Default is "send onboarding" to preserve pre-feature behaviour, but
          the preparer can switch to "do nothing" for white-glove clients or
          "auto-create client" when they want to skip the form entirely. */}
      <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">When this proposal is accepted</h3>
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">Auto-actions</span>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          You'll always be notified when a prospect accepts or declines. Choose what — if anything — happens next.
        </p>
        <div className="space-y-2">
          {([
            {
              id: 'none' as const,
              label: 'Just notify me — no automatic next steps',
              desc: 'Use this when you want to handle onboarding outside SMITH for this client.',
            },
            {
              id: 'send_onboarding' as const,
              label: 'Send the prospect an onboarding form',
              desc: 'Email them a link to complete an onboarding form. A client record is created once they submit.',
            },
            {
              id: 'auto_create_client' as const,
              label: 'Auto-create the client record (skip the onboarding form)',
              desc: 'Creates a client immediately using the prospect details — you can fill in the rest from the Clients screen.',
            },
          ]).map(opt => {
            const active = (proposal.post_acceptance_action ?? 'send_onboarding') === opt.id;
            return (
              <label
                key={opt.id}
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                    : 'border-[var(--border)] hover:border-[var(--text-muted)]'
                } ${readonly ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="post_acceptance_action"
                  checked={active}
                  disabled={readonly}
                  onChange={() => update('post_acceptance_action', opt.id)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{opt.label}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{opt.desc}</p>
                </div>
              </label>
            );
          })}
        </div>

        {/* Form picker — only shown when "Send onboarding" is selected. */}
        {(proposal.post_acceptance_action ?? 'send_onboarding') === 'send_onboarding' && (
          <Field label="Onboarding form template">
            <select
              value={proposal.post_acceptance_onboarding_form_id ?? ''}
              onChange={e => update('post_acceptance_onboarding_form_id', e.target.value || null)}
              disabled={readonly}
              className="input-base text-sm w-full"
            >
              <option value="">— Firm default (whichever active form fits the client type)</option>
              {onboardingForms
                .filter(f => f.active)
                .map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.client_type ? ` · ${f.client_type}` : ''}
                    {f.is_default ? ' (default)' : ''}
                  </option>
                ))}
            </select>
            {onboardingForms.filter(f => f.active).length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">
                You don't have any active onboarding forms set up. Go to Settings → Proposals → Onboarding to create one, or pick a different action above.
              </p>
            )}
          </Field>
        )}
      </div>

      {/* Packages or single list */}
      {packages.length === 0 ? (
        <SingleListEditor
          items={items.filter(li => li.offered_package_id === null)}
          services={services}
          totals={totals.standalone}
          readonly={readonly}
          onAddService={(svc, tier) => addServiceTo(null, svc, tier)}
          onAddCustom={() => addCustomLine(null)}
          onUpdate={updateItem}
          onRemove={removeItem}
        />
      ) : (
        <div className="space-y-3">
          {packages.map(pkg => (
            <PackagePanel
              key={pkg.id}
              pkg={pkg}
              items={items.filter(li => li.offered_package_id === pkg.id)}
              services={services}
              totals={totals.perPackage.get(pkg.id) ?? { one_off: 0, monthly: 0, annual: 0 }}
              readonly={readonly}
              onUpdatePackage={patch => updatePackage(pkg.id, patch)}
              onRemovePackage={() => removePackage(pkg.id)}
              onAddService={(svc, tier) => addServiceTo(pkg.id, svc, tier)}
              onAddCustom={() => addCustomLine(pkg.id)}
              onUpdateItem={updateItem}
              onRemoveItem={removeItem}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!readonly && (
          <button onClick={addPackage} className="btn-secondary text-sm inline-flex items-center gap-1.5"><PackageIcon size={13} />Add a package (Bronze/Silver/Gold)</button>
        )}
      </div>

      <RequiredSignersPanel proposalId={proposalId} readonly={readonly} />
      <CommentsPanel proposalId={proposalId} />

      {/* Footer bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-6 px-6 py-3 flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs text-[var(--text-muted)]">
          {error ? (
            <span className="text-red-700 inline-flex items-center gap-1"><AlertTriangle size={12} />{error}</span>
          ) : savedAt ? (
            <span className="text-emerald-700 inline-flex items-center gap-1"><Check size={12} />Saved {savedAt.toLocaleTimeString()}</span>
          ) : (
            <span>Changes are not saved automatically.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!readonly && (
            <>
              <button onClick={() => void handleSave()} disabled={saving || sending} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save draft
              </button>
              <button
                onClick={() => void handleSend()}
                disabled={saving || sending || !emailTriageActive}
                title={!emailTriageActive
                  ? 'Enable the Email tool in Settings → Tool Enabling to compose proposal emails from your linked Gmail.'
                  : 'Opens the compose window pre-filled with the proposal email. Edit if needed, then send from your linked email.'}
                className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Compose email
              </button>
            </>
          )}
        </div>
      </div>

      {/* Live preview modal — driven by in-memory form state so the
          preparer sees changes the moment they make them, no save needed. */}
      <ProposalPreviewModal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        proposal={{
          id:              proposal.id,
          title:           proposal.title,
          intro:           proposal.intro,
          terms:           proposal.terms,
          vat_mode:        proposal.vat_mode,
          vat_rate:        proposal.vat_rate,
          discount_amount: proposal.discount_amount,
          discount_type:   proposal.discount_type ?? 'amount',
          discount_label:  proposal.discount_label,
          status:          proposal.status,
          sent_at:         proposal.sent_at,
          expires_at:      proposal.expires_at,
          // Pass the new builder settings through so the preview matches what
          // the prospect will see — without needing to save the proposal first.
          totals_display:        proposal.totals_display ?? 'first_year',
          post_acceptance_action: proposal.post_acceptance_action ?? 'send_onboarding',
          prospect:        proposal.prospect,
        }}
        packages={packages.map(p => ({ id: p.id, name: p.name, description: p.description }))}
        items={items.map(li => ({
          id:                 li.id,
          offered_package_id: li.offered_package_id,
          service_name:       li.service_name,
          description:        li.description,
          tier_label:         li.tier_label,
          frequency:          li.frequency,
          unit_price:         li.unit_price,
          quantity:           li.quantity,
          vat_treatment:      li.vat_treatment,
        }))}
      />
    </div>
  );
}

// ── Single list (no packages) ─────────────────────────────────────────────
function SingleListEditor({ items, services, totals, readonly, onAddService, onAddCustom, onUpdate, onRemove }: {
  items: LineItem[];
  services: Service[];
  totals: { one_off: number; monthly: number; annual: number };
  readonly: boolean;
  onAddService: (svc: Service, tier?: Tier) => void;
  onAddCustom: () => void;
  onUpdate: (id: string, patch: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Services & pricing</h3>
        {!readonly && <AddServiceButtons services={services} onAdd={onAddService} onAddCustom={onAddCustom} />}
      </div>
      <ItemsTable items={items} readonly={readonly} onUpdate={onUpdate} onRemove={onRemove} />
      <TotalsRow totals={totals} />
    </div>
  );
}

function PackagePanel({ pkg, items, services, totals, readonly, onUpdatePackage, onRemovePackage, onAddService, onAddCustom, onUpdateItem, onRemoveItem }: {
  pkg: OfferedPackage;
  items: LineItem[];
  services: Service[];
  totals: { one_off: number; monthly: number; annual: number };
  readonly: boolean;
  onUpdatePackage: (patch: Partial<OfferedPackage>) => void;
  onRemovePackage: () => void;
  onAddService: (svc: Service, tier?: Tier) => void;
  onAddCustom: () => void;
  onUpdateItem: (id: string, patch: Partial<LineItem>) => void;
  onRemoveItem: (id: string) => void;
}) {
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <input value={pkg.name} onChange={e => onUpdatePackage({ name: e.target.value })} disabled={readonly} className="input-base text-base font-semibold w-full" />
          <textarea value={pkg.description ?? ''} onChange={e => onUpdatePackage({ description: e.target.value || null })} disabled={readonly} rows={2} className="input-base text-xs w-full" placeholder="Short description shown to the prospect…" />
        </div>
        {!readonly && (
          <button onClick={onRemovePackage} className="p-1.5 rounded text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
        )}
      </div>
      <div className="flex justify-end">
        {!readonly && <AddServiceButtons services={services} onAdd={onAddService} onAddCustom={onAddCustom} />}
      </div>
      <ItemsTable items={items} readonly={readonly} onUpdate={onUpdateItem} onRemove={onRemoveItem} />
      <TotalsRow totals={totals} />
    </div>
  );
}

// ── Items table ─────────────────────────────────────────────────────────
function ItemsTable({ items, readonly, onUpdate, onRemove }: {
  items: LineItem[];
  readonly: boolean;
  onUpdate: (id: string, patch: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-[var(--text-muted)] italic py-3">No services yet — add one from the catalogue above.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          <tr className="border-b border-gray-100">
            <th className="text-left py-1.5 px-2">Service</th>
            <th className="text-left py-1.5 px-2">Tier / description</th>
            <th className="text-left py-1.5 px-2">Freq</th>
            <th className="text-right py-1.5 px-2">Qty</th>
            <th className="text-right py-1.5 px-2">Unit £</th>
            <th className="text-left py-1.5 px-2">VAT</th>
            <th className="text-right py-1.5 px-2">Line £</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map(li => (
            <tr key={li.id} className="border-b border-gray-50">
              <td className="py-1.5 px-2"><input value={li.service_name} onChange={e => onUpdate(li.id, { service_name: e.target.value })} disabled={readonly} className="input-base text-sm w-full" /></td>
              <td className="py-1.5 px-2"><input value={li.tier_label ?? li.description ?? ''} onChange={e => onUpdate(li.id, { tier_label: e.target.value || null })} disabled={readonly} className="input-base text-xs w-full" placeholder="—" /></td>
              <td className="py-1.5 px-2">
                <select value={li.frequency} onChange={e => onUpdate(li.id, { frequency: e.target.value as Frequency })} disabled={readonly} className="input-base text-xs">
                  <option value="one_off">One-off</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </td>
              <td className="py-1.5 px-2 text-right"><input type="number" step="0.01" value={li.quantity} onChange={e => onUpdate(li.id, { quantity: Number(e.target.value) })} disabled={readonly} className="input-base text-xs w-16 text-right" /></td>
              <td className="py-1.5 px-2 text-right"><input type="number" step="0.01" value={li.unit_price} onChange={e => onUpdate(li.id, { unit_price: Number(e.target.value) })} disabled={readonly} className="input-base text-xs w-24 text-right" /></td>
              <td className="py-1.5 px-2">
                <select value={li.vat_treatment} onChange={e => onUpdate(li.id, { vat_treatment: e.target.value as VatTreatment })} disabled={readonly} className="input-base text-xs">
                  <option value="exclusive">Excl.</option>
                  <option value="inclusive">Incl.</option>
                  <option value="exempt">Exempt</option>
                </select>
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">£{(Number(li.unit_price) * Number(li.quantity)).toFixed(2)}</td>
              <td className="py-1.5 px-2 text-right">
                {!readonly && <button onClick={() => onRemove(li.id)} className="p-1.5 rounded text-red-600 hover:bg-red-50"><Trash2 size={12} /></button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TotalsRow({ totals }: { totals: { one_off: number; monthly: number; annual: number } }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 justify-end text-sm bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mt-1">
      {totals.monthly > 0 && <span><span className="text-[var(--text-muted)] mr-1">Monthly:</span><strong>£{totals.monthly.toFixed(2)}</strong></span>}
      {totals.annual > 0 && <span><span className="text-[var(--text-muted)] mr-1">Annual:</span><strong>£{totals.annual.toFixed(2)}</strong></span>}
      {totals.one_off > 0 && <span><span className="text-[var(--text-muted)] mr-1">One-off:</span><strong>£{totals.one_off.toFixed(2)}</strong></span>}
      {totals.monthly === 0 && totals.annual === 0 && totals.one_off === 0 && <span className="text-[var(--text-muted)]">—</span>}
    </div>
  );
}

// ── Add Service dropdown ────────────────────────────────────────────────
function AddServiceButtons({ services, onAdd, onAddCustom }: {
  services: Service[];
  onAdd: (svc: Service, tier?: Tier) => void;
  onAddCustom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = services.filter(s => s.active);

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="btn-secondary text-xs inline-flex items-center gap-1"><Plus size={11} />Add service</button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-72 max-h-80 overflow-y-auto bg-white border border-[var(--border)] rounded-lg shadow-lg z-40 p-1.5">
            {active.length === 0 && <p className="text-xs text-[var(--text-muted)] italic px-2 py-2">No services in catalogue. Add some in Settings → Proposals.</p>}
            {active.map(svc => (
              <div key={svc.id} className="hover:bg-[var(--bg-nav-hover)] rounded px-1.5 py-1">
                {svc.fee_type === 'fixed' ? (
                  <button onClick={() => { onAdd(svc); setOpen(false); }} className="w-full text-left text-xs">
                    <div className="flex justify-between"><span className="font-medium">{svc.name}</span><span className="text-[var(--text-muted)]">£{Number(svc.base_price).toFixed(2)}/{freqShort(svc.frequency)}</span></div>
                  </button>
                ) : (
                  <details>
                    <summary className="text-xs font-medium cursor-pointer list-none flex justify-between"><span>{svc.name}</span><span className="text-[var(--text-muted)]">tiered</span></summary>
                    <div className="pl-2 mt-1 space-y-0.5">
                      {(svc.tiers ?? []).map(t => (
                        <button key={t.id} onClick={() => { onAdd(svc, t); setOpen(false); }} className="w-full text-left text-[11px] py-0.5 hover:bg-[var(--bg-nav-hover)] rounded px-1">
                          <div className="flex justify-between"><span>{t.label}</span><span className="text-[var(--text-muted)]">£{Number(t.price).toFixed(2)}/{freqShort(t.frequency)}</span></div>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
            <div className="border-t border-gray-100 my-1" />
            <button onClick={() => { onAddCustom(); setOpen(false); }} className="w-full text-left text-xs px-1.5 py-1 hover:bg-[var(--bg-nav-hover)] rounded text-[var(--accent)]">+ Add custom line</button>
          </div>
        </>
      )}
    </div>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function freqShort(f: Frequency): string {
  switch (f) {
    case 'one_off': return 'once';
    case 'monthly': return 'mo';
    case 'quarterly': return 'qtr';
    case 'annual': return 'yr';
  }
}

function StatusPill({ status }: { status: ProposalRow['status'] }) {
  const map: Record<ProposalRow['status'], string> = {
    draft:     'bg-gray-100 text-gray-700',
    sent:      'bg-sky-100 text-sky-700',
    viewed:    'bg-indigo-100 text-indigo-700',
    accepted:  'bg-emerald-100 text-emerald-700',
    declined:  'bg-red-100 text-red-700',
    expired:   'bg-amber-100 text-amber-700',
    withdrawn: 'bg-gray-200 text-gray-600',
  };
  return <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full ${map[status]}`}>{status}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</span>{children}</label>;
}

// ── Required signatories panel ──────────────────────────────────────────
interface RequiredSigner { id: string; signer_name: string; signer_email: string; signer_role: string | null; display_order: number }

function RequiredSignersPanel({ proposalId, readonly }: { proposalId: string; readonly: boolean }) {
  const [signers, setSigners] = useState<RequiredSigner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Array<{ signer_name: string; signer_email: string; signer_role: string }>>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/proposals/${proposalId}/signers`);
    const data = await res.json();
    setSigners(data.signers ?? []);
    setLoading(false);
  }, [proposalId]);
  useEffect(() => { void load(); }, [load]);

  function openEditor() {
    setDraft(signers.length > 0
      ? signers.map(s => ({ signer_name: s.signer_name, signer_email: s.signer_email, signer_role: s.signer_role ?? '' }))
      : [{ signer_name: '', signer_email: '', signer_role: '' }, { signer_name: '', signer_email: '', signer_role: '' }]);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const clean = draft.filter(d => d.signer_name.trim() && d.signer_email.trim());
      await fetch(`/api/proposals/${proposalId}/signers`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signers: clean.map(d => ({ ...d, signer_role: d.signer_role || null })) }),
      });
      setEditing(false);
      await load();
    } finally { setSaving(false); }
  }

  if (loading) return null;
  if (signers.length === 0 && !editing) {
    return readonly ? null : (
      <div className="bg-white border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text-muted)] flex items-center justify-between">
        <span>Single signatory by default. Add multiple required signers if e.g. two directors must sign.</span>
        <button onClick={openEditor} className="text-[var(--accent)] hover:underline">+ Add required signatories</button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-2">
        <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)]">Required signatories</p>
        {draft.map((d, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input value={d.signer_name} onChange={e => { const n = [...draft]; n[i].signer_name = e.target.value; setDraft(n); }} placeholder="Name" className="input-base text-xs col-span-4" />
            <input value={d.signer_email} onChange={e => { const n = [...draft]; n[i].signer_email = e.target.value; setDraft(n); }} placeholder="Email" className="input-base text-xs col-span-4" />
            <input value={d.signer_role} onChange={e => { const n = [...draft]; n[i].signer_role = e.target.value; setDraft(n); }} placeholder="Role (e.g. Director)" className="input-base text-xs col-span-3" />
            <button onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="p-1.5 rounded text-red-600 hover:bg-red-50 col-span-1"><Trash2 size={12} /></button>
          </div>
        ))}
        <button onClick={() => setDraft([...draft, { signer_name: '', signer_email: '', signer_role: '' }])} className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1"><Plus size={11} />Add another</button>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => setEditing(false)} className="btn-secondary text-xs">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="btn-primary text-xs">{saving ? <Loader2 size={11} className="animate-spin inline mr-1" /> : <Check size={11} className="inline mr-1" />}Save signatories</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)]">Required signatories ({signers.length})</p>
        {!readonly && <button onClick={openEditor} className="text-xs text-[var(--accent)] hover:underline">Edit</button>}
      </div>
      <ul className="space-y-1">
        {signers.map(s => (
          <li key={s.id} className="text-sm">
            <span className="font-medium">{s.signer_name}</span>
            <span className="text-[var(--text-muted)]"> · {s.signer_email}</span>
            {s.signer_role && <span className="text-[var(--text-muted)]"> · {s.signer_role}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Internal comments panel ─────────────────────────────────────────────
interface CommentRow { id: string; user_id: string | null; author_name: string | null; body: string; created_at: string; user: { full_name: string | null; email: string; avatar_url: string | null } | null }

function CommentsPanel({ proposalId }: { proposalId: string }) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/proposals/${proposalId}/comments`);
    setComments((await res.json()).comments ?? []);
    setLoading(false);
  }, [proposalId]);
  useEffect(() => { void load(); }, [load]);

  async function post() {
    if (!body.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (res.ok) { setBody(''); await load(); }
    } finally { setPosting(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this comment?')) return;
    await fetch(`/api/proposals/${proposalId}/comments/${id}`, { method: 'DELETE' });
    void load();
  }

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
      <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)]">Internal comments ({comments.length})</p>
      {loading ? (
        <p className="text-xs text-[var(--text-muted)] italic">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] italic">No comments yet. Leave a note for a reviewer or for your future self.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map(c => (
            <li key={c.id} className="p-2 rounded-lg bg-gray-50 text-sm group">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-0.5">
                <span><strong className="text-[var(--text-secondary)]">{c.user?.full_name ?? c.author_name ?? 'Team member'}</strong> · {new Date(c.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <button onClick={() => void remove(c.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:bg-red-50 p-1 rounded"><Trash2 size={11} /></button>
              </div>
              <p className="whitespace-pre-wrap text-[var(--text-primary)]">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <input value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post(); }} placeholder="Add an internal comment (Cmd/Ctrl + Enter to send)…" className="input-base text-sm flex-1" />
        <button onClick={() => void post()} disabled={posting || !body.trim()} className="btn-primary text-sm">
          {posting ? <Loader2 size={11} className="animate-spin inline" /> : 'Post'}
        </button>
      </div>
    </div>
  );
}
