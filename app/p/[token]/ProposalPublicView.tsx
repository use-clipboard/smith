'use client';

import { useState, useEffect } from 'react';
import { Loader2, Check, X, AlertTriangle, FileSignature, Printer } from 'lucide-react';

interface LineItem {
  id: string;
  offered_package_id: string | null;
  service_name: string;
  description: string | null;
  tier_label: string | null;
  frequency: 'one_off' | 'monthly' | 'quarterly' | 'annual';
  unit_price: number;
  quantity: number;
  vat_treatment: 'inclusive' | 'exclusive' | 'exempt';
  display_order: number;
}
interface OfferedPackage {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  total_one_off: number;
  total_monthly: number;
  total_annual: number;
}
interface BrandPayload {
  logo_url: string | null;
  header_image_url: string | null;
  primary_color: string;
  accent_color: string;
  font_family: string;
  footer_text: string | null;
  show_firm_name: boolean;
}

interface PublicProposal {
  id: string;
  title: string;
  intro: string | null;
  terms: string | null;
  vat_mode: 'inclusive' | 'exclusive';
  vat_rate: number;
  discount_amount: number;
  discount_type?: 'amount' | 'percent';
  discount_label: string | null;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  sent_at: string | null;
  expires_at: string | null;
  /** Drives the post-acceptance screen: when 'none' or 'auto_create_client'
   *  we hide the "Continue to onboarding form" call-to-action because there
   *  is no form to fill out. */
  post_acceptance_action?: 'none' | 'send_onboarding' | 'auto_create_client' | null;
  /** How the totals block reads. See migration 20260614. */
  totals_display?: 'first_year' | 'monthly' | null;
  total_one_off: number;
  total_monthly: number;
  total_annual: number;
  firm_name: string | null;
  brand?: BrandPayload;
  prospect: { contact_name: string; company_name: string | null; email: string };
  offered_packages: OfferedPackage[];
  line_items: LineItem[];
  required_signers?: Array<{ id: string; signer_name: string; signer_email: string; signer_role: string | null; display_order: number }>;
  signatures?: Array<{ id: string; required_signer_id: string | null; signer_name: string; signer_email: string; signed_at: string }>;
}

const FONT_CSS: Record<string, string> = {
  system:  '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
  inter:   'Inter,-apple-system,sans-serif',
  serif:   'Georgia,"Times New Roman",serif',
  mono:    'ui-monospace,SFMono-Regular,Menlo,monospace',
  rounded: '"Nunito",-apple-system,sans-serif',
};

/**
 * Public proposal view.
 *
 * Two modes:
 *   1. `{ token }` — production: loads the proposal from /api/p/[token],
 *      handles accept / decline server calls. This is what real prospects see.
 *   2. `{ previewData }` — in-app preview: skips the fetch and renders the
 *      provided proposal data directly. Accept / decline form still renders
 *      so the preparer sees the exact prospect layout, but the buttons are
 *      no-ops and a "preview mode" notice is shown.
 *
 * Both modes share 100% of the JSX below so what you see in preview really
 * is what the prospect gets.
 */
type ProposalPublicViewProps =
  | { token: string; previewData?: undefined }
  | { token?: undefined; previewData: PublicProposal };

export default function ProposalPublicView(props: ProposalPublicViewProps) {
  const token        = props.token;
  const previewMode  = props.previewData !== undefined;
  const [proposal, setProposal] = useState<PublicProposal | null>(previewMode ? props.previewData : null);
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState<string | null>(null);
  const [chosenPackage, setChosenPackage] = useState<string | null>(() => {
    const pkgs = previewMode ? props.previewData.offered_packages : [];
    return pkgs.length === 1 ? pkgs[0].id : null;
  });
  const [signerName, setSignerName] = useState(previewMode ? (props.previewData.prospect?.contact_name ?? '') : '');
  const [signerEmail, setSignerEmail] = useState(previewMode ? (props.previewData.prospect?.email ?? '') : '');
  const [typedSig, setTypedSig] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declineOpen, setDeclineOpen] = useState(false);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);

  // Keep state in sync when the parent updates previewData (live edit).
  useEffect(() => {
    if (previewMode) {
      setProposal(props.previewData);
      if (props.previewData.offered_packages.length === 1) setChosenPackage(props.previewData.offered_packages[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, props.previewData]);

  useEffect(() => {
    if (previewMode || !token) return;
    fetch(`/api/p/${token}`)
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.error ?? 'Could not load proposal');
        } else {
          setProposal(data.proposal);
          setSignerName(data.proposal.prospect?.contact_name ?? '');
          setSignerEmail(data.proposal.prospect?.email ?? '');
          if (data.proposal.offered_packages?.length === 1) setChosenPackage(data.proposal.offered_packages[0].id);
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [token, previewMode]);

  async function accept() {
    if (!proposal) return;
    if (previewMode || !token) return; // preview can't accept
    if (proposal.offered_packages.length > 0 && !chosenPackage) {
      setError('Please choose a package.'); return;
    }
    if (!signerName.trim() || !signerEmail.trim() || !typedSig.trim()) {
      setError('Please fill in your name, email, and type your name as a signature.'); return;
    }
    setAccepting(true); setError(null);
    try {
      const res = await fetch(`/api/p/${token}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_name: signerName,
          signer_email: signerEmail,
          typed_signature: typedSig,
          chosen_package_id: chosenPackage,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Accept failed');
      setDone('accepted');
    } catch (e) { setError(e instanceof Error ? e.message : 'Accept failed'); }
    finally { setAccepting(false); }
  }

  async function decline() {
    if (previewMode || !token) return;
    setDeclining(true);
    try {
      const res = await fetch(`/api/p/${token}/decline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Decline failed');
      setDone('declined');
    } catch (e) { setError(e instanceof Error ? e.message : 'Decline failed'); }
    finally { setDeclining(false); setDeclineOpen(false); }
  }

  if (loading) {
    return <FullPageState><Loader2 size={20} className="animate-spin text-[var(--accent)]" /><p className="text-sm text-[var(--text-muted)]">Loading your proposal…</p></FullPageState>;
  }
  if (error && !proposal) {
    return <FullPageState><AlertTriangle size={24} className="text-amber-500" /><p className="text-sm text-[var(--text-secondary)]">{error}</p></FullPageState>;
  }
  if (!proposal) return null;

  const alreadyDecided = proposal.status === 'accepted' || proposal.status === 'declined';
  if (done === 'accepted' || proposal.status === 'accepted') {
    // When the firm picked "no auto steps" or "auto-create client" on this
    // proposal, there's no form to fill — show a simple thank-you instead of
    // the onboarding CTA.
    const sendsOnboarding = (proposal.post_acceptance_action ?? 'send_onboarding') === 'send_onboarding';
    return (
      <FullPageState>
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center"><Check size={24} className="text-emerald-700" /></div>
        <h1 className="text-lg font-semibold">Thanks, {proposal.prospect.contact_name.split(' ')[0]}!</h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-md text-center">Your acceptance has been recorded.</p>
        {sendsOnboarding ? (
          <>
            <a href={`/p/${token}/onboarding`} className="text-sm text-white bg-[var(--accent)] px-4 py-2 rounded-md font-semibold">Continue to onboarding form →</a>
            <p className="text-[11px] text-[var(--text-muted)] max-w-md text-center">We've also emailed you a link in case you'd rather complete it later.</p>
          </>
        ) : (
          <p className="text-[11px] text-[var(--text-muted)] max-w-md text-center">{proposal.firm_name ?? 'The firm'} will be in touch shortly to take it from here.</p>
        )}
      </FullPageState>
    );
  }
  if (done === 'declined' || proposal.status === 'declined') {
    return <FullPageState><div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"><X size={24} className="text-gray-700" /></div><h1 className="text-lg font-semibold">Proposal declined</h1><p className="text-sm text-[var(--text-secondary)]">We've let {proposal.firm_name ?? 'the firm'} know.</p></FullPageState>;
  }

  const brand: BrandPayload = proposal.brand ?? {
    logo_url: null, header_image_url: null, primary_color: '#0EA5E9', accent_color: '#0284C7',
    font_family: 'system', footer_text: null, show_firm_name: true,
  };
  const fontStack = FONT_CSS[brand.font_family] ?? FONT_CSS.system;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4" style={{ fontFamily: fontStack, ['--brand' as string]: brand.primary_color, ['--brand-accent' as string]: brand.accent_color } as React.CSSProperties}>
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Optional banner image */}
        {brand.header_image_url && (
          <div className="h-32 sm:h-40 w-full bg-cover bg-center" style={{ backgroundImage: `url(${brand.header_image_url})` }} />
        )}
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100" style={{ background: brand.primary_color, color: '#fff' }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              {brand.logo_url && (
                <img src={brand.logo_url} alt="" className="h-9 w-auto bg-white p-1 rounded" />
              )}
              <div className="min-w-0">
                {brand.show_firm_name && <p className="text-xs opacity-85">{proposal.firm_name ?? 'Proposal'}</p>}
                <h1 className="text-xl sm:text-2xl font-semibold truncate">{proposal.title}</h1>
                <p className="text-sm opacity-90 mt-0.5">For {proposal.prospect.contact_name}{proposal.prospect.company_name ? ` · ${proposal.prospect.company_name}` : ''}</p>
              </div>
            </div>
            <button onClick={() => window.print()} className="text-xs inline-flex items-center gap-1 print:hidden bg-white/15 hover:bg-white/25 transition-colors text-white px-3 py-1.5 rounded">
              <Printer size={11} />Print / save PDF
            </button>
          </div>
        </div>

        {/* Intro */}
        {proposal.intro && (
          <div className="px-8 py-6 border-b border-gray-100">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{proposal.intro}</p>
          </div>
        )}

        {/* Packages or single list */}
        <div className="px-8 py-6 border-b border-gray-100">
          {proposal.offered_packages.length === 0 ? (
            <ServicesTable items={proposal.line_items.filter(li => li.offered_package_id === null)} vatMode={proposal.vat_mode} />
          ) : (
            <div className="space-y-4">
              <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)]">Pick a package</p>
              {proposal.offered_packages.sort((a, b) => a.display_order - b.display_order).map(pkg => {
                const items = proposal.line_items.filter(li => li.offered_package_id === pkg.id);
                const chosen = chosenPackage === pkg.id;
                return (
                  <div key={pkg.id} className="rounded-xl border-2 p-4" style={chosen ? { borderColor: brand.primary_color, background: `${brand.primary_color}14` } : { borderColor: '#e5e7eb' }}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="radio" name="package" checked={chosen} onChange={() => setChosenPackage(pkg.id)} disabled={alreadyDecided} className="mt-1" />
                      <div className="flex-1">
                        <p className="text-base font-semibold">{pkg.name}</p>
                        {pkg.description && <p className="text-sm text-[var(--text-secondary)] mt-0.5">{pkg.description}</p>}
                      </div>
                      <div className="text-right text-sm">
                        {pkg.total_monthly > 0 && <p><strong className="text-lg">£{Number(pkg.total_monthly).toFixed(2)}</strong> <span className="text-[var(--text-muted)] text-xs">/mo</span></p>}
                        {pkg.total_annual > 0 && <p className="text-xs text-[var(--text-muted)]">+ £{Number(pkg.total_annual).toFixed(2)} /yr</p>}
                        {pkg.total_one_off > 0 && <p className="text-xs text-[var(--text-muted)]">+ £{Number(pkg.total_one_off).toFixed(2)} one-off</p>}
                      </div>
                    </label>
                    <div className="mt-3 ml-7">
                      <ServicesTable items={items} vatMode={proposal.vat_mode} compact />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Totals — per-frequency breakdown, only frequencies with non-zero
            items are shown. Discount line and after-discount total appear
            below when applicable. */}
        <ProposalTotalsBlock proposal={proposal} />

        {/* Terms */}
        {proposal.terms && (
          <div className="px-8 py-6 border-b border-gray-100">
            <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)] mb-2">Terms</p>
            <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{proposal.terms}</p>
          </div>
        )}

        {/* Signature */}
        {!alreadyDecided && (
          <div className="px-8 py-6 print:hidden">
            <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)] mb-2 flex items-center gap-1.5"><FileSignature size={12} />Accept this proposal</p>
            {(proposal.required_signers ?? []).length > 0 && (
              <div className="mb-3 p-3 rounded-lg bg-sky-50 border border-sky-200 text-xs">
                <p className="font-semibold text-sky-900 mb-1.5">This proposal needs signatures from each of the following:</p>
                <ul className="space-y-0.5 text-sky-900">
                  {(proposal.required_signers ?? []).sort((a, b) => a.display_order - b.display_order).map(rs => {
                    const signed = (proposal.signatures ?? []).some(s => s.required_signer_id === rs.id);
                    return (
                      <li key={rs.id} className="flex items-center gap-2">
                        {signed ? <Check size={11} className="text-emerald-700" /> : <span className="w-3 h-3 rounded-full border border-sky-400 inline-block" />}
                        <span className={signed ? 'line-through opacity-60' : ''}>{rs.signer_name} ({rs.signer_email}){rs.signer_role ? ` — ${rs.signer_role}` : ''}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[11px] text-sky-800">Enter your details below to sign your slot. The proposal is only fully accepted once everyone has signed.</p>
              </div>
            )}
            <p className="text-xs text-[var(--text-muted)] mb-3">By typing your name below and clicking Accept, you confirm you have authority to enter into this engagement.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <FieldP label="Your name *"><input value={signerName} onChange={e => setSignerName(e.target.value)} className="input-base text-sm w-full" /></FieldP>
              <FieldP label="Your email *"><input type="email" value={signerEmail} onChange={e => setSignerEmail(e.target.value)} className="input-base text-sm w-full" /></FieldP>
              <FieldP label="Typed signature *"><input value={typedSig} onChange={e => setTypedSig(e.target.value)} className="input-base text-sm w-full font-serif italic" placeholder="Type your full name as a signature" /></FieldP>
            </div>
            {error && <div className="mt-3 text-xs text-red-700 flex items-center gap-1.5"><AlertTriangle size={12} />{error}</div>}
            <div className="flex flex-wrap items-center justify-end gap-2 mt-4">
              {/* Decline button — explicitly styled with a rose outline so it
                  reads as a clear "no" option next to the bold-coloured Accept.
                  Was previously btn-secondary which rendered as a faint grey
                  outline that prospects routinely missed. */}
              <button
                onClick={() => !previewMode && setDeclineOpen(true)}
                disabled={previewMode}
                className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md font-semibold border-2 border-rose-300 text-rose-700 bg-white hover:bg-rose-50 hover:border-rose-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={12} />Decline
              </button>
              <button
                onClick={() => void accept()}
                disabled={accepting || previewMode}
                className="text-sm inline-flex items-center gap-1.5 text-white px-4 py-2 rounded-md font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: brand.primary_color }}
              >
                {accepting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Accept proposal
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        {brand.footer_text && (
          <div className="px-8 py-4 border-t border-gray-100 bg-gray-50 text-[11px] text-[var(--text-muted)] whitespace-pre-wrap">
            {brand.footer_text}
          </div>
        )}
      </div>

      {declineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !declining && setDeclineOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">Decline this proposal</h3>
            <p className="text-xs text-[var(--text-muted)] mb-3">Could you let us know why? It really helps us improve.</p>
            <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3} className="input-base text-sm w-full" placeholder="e.g. Going with a different provider for now" />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setDeclineOpen(false)} disabled={declining} className="btn-secondary text-sm">Cancel</button>
              <button onClick={() => void decline()} disabled={declining} className="btn-primary text-sm bg-red-600 hover:bg-red-700">
                {declining ? <Loader2 size={12} className="animate-spin" /> : 'Confirm decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ServicesTable({ items, vatMode, compact }: { items: LineItem[]; vatMode: 'inclusive' | 'exclusive'; compact?: boolean }) {
  const sorted = [...items].sort((a, b) => a.display_order - b.display_order);
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        <tr className="border-b border-gray-100">
          <th className="text-left py-1.5">Service</th>
          {!compact && <th className="text-left py-1.5">Tier</th>}
          <th className="text-right py-1.5">Frequency</th>
          <th className="text-right py-1.5">Price ({vatMode === 'inclusive' ? 'incl. VAT' : 'excl. VAT'})</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(li => {
          const lineTotal = Number(li.unit_price) * Number(li.quantity);
          return (
            <tr key={li.id} className="border-b border-gray-50">
              <td className="py-1.5">
                <p className="font-medium">{li.service_name}</p>
                {li.description && <p className="text-xs text-[var(--text-muted)]">{li.description}</p>}
                {compact && li.tier_label && <p className="text-xs text-[var(--text-muted)]">{li.tier_label}</p>}
              </td>
              {!compact && <td className="py-1.5 text-xs text-[var(--text-muted)]">{li.tier_label ?? '—'}</td>}
              <td className="py-1.5 text-right text-xs text-[var(--text-muted)]">{li.frequency.replace('_', '-')}</td>
              <td className="py-1.5 text-right tabular-nums">£{lineTotal.toFixed(2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Renders the totals breakdown shown above the Terms block. Sums all line
 * items across packages and standalone, splits by frequency, and applies
 * the discount (flat or percent) to the appropriate headline figure.
 *
 * Two display modes, controlled by `proposal.totals_display`:
 *
 *   • 'first_year' (default) — bold "First-year total" headline. Per-frequency
 *     rows above. Discount applied to first-year total. Best for fixed-fee or
 *     one-off-heavy proposals.
 *   • 'monthly' — emphasises the monthly retainer figure. The first-year
 *     headline line is hidden; the discount (if any) is also expressed
 *     per-month. One-offs / annuals / quarterlies still appear in their
 *     own rows for transparency. Best for retainer-style proposals.
 *
 * VAT indicator: a small clarifying line at the top of the card states whether
 * amounts are shown inclusive or exclusive of VAT, so prospects don't have to
 * guess. Driven by `proposal.vat_mode`.
 */
function ProposalTotalsBlock({ proposal }: { proposal: PublicProposal }) {
  // Aggregate every line item — packaged and standalone alike — so the
  // breakdown is a single answer to "what will this cost".
  let one_off = 0, monthly = 0, quarterly = 0, annual = 0;
  for (const li of proposal.line_items) {
    const sub = Number(li.unit_price) * Number(li.quantity);
    if (li.frequency === 'one_off')        one_off   += sub;
    else if (li.frequency === 'monthly')   monthly   += sub;
    else if (li.frequency === 'quarterly') quarterly += sub;
    else if (li.frequency === 'annual')    annual    += sub;
  }

  const firstYearTotal = one_off + monthly * 12 + quarterly * 4 + annual;
  const discountType   = proposal.discount_type ?? 'amount';
  const discountRaw    = Number(proposal.discount_amount) || 0;
  // Discount value is always computed against the first-year total — this is
  // how it's stored in the proposal. In "monthly" mode we then divide by 12
  // to express it per-month, so the maths stays consistent across modes.
  const discountValue  = discountType === 'percent'
    ? Math.min(firstYearTotal, (discountRaw / 100) * firstYearTotal)
    : Math.min(firstYearTotal, discountRaw);
  const afterDiscount  = firstYearTotal - discountValue;
  const showDiscount   = discountValue > 0;

  const mode = proposal.totals_display ?? 'first_year';
  const monthlyDiscount = discountValue / 12;
  const monthlyAfterDiscount = monthly - monthlyDiscount;

  const rows: Array<{ label: string; value: string }> = [];
  if (one_off   > 0) rows.push({ label: 'One-off',   value: `£${one_off.toFixed(2)}` });
  if (monthly   > 0) rows.push({ label: 'Monthly',   value: `£${monthly.toFixed(2)} /mo` });
  if (quarterly > 0) rows.push({ label: 'Quarterly', value: `£${quarterly.toFixed(2)} /qtr` });
  if (annual    > 0) rows.push({ label: 'Annual',    value: `£${annual.toFixed(2)} /yr` });

  if (rows.length === 0) return null;

  // VAT suffix appended inline to each total. We only add it when there's a
  // real VAT impact — a 0% exclusive line would just be visual noise.
  const vatSuffix = proposal.vat_mode === 'inclusive'
    ? ' inc VAT'
    : (proposal.vat_rate && proposal.vat_rate > 0 ? ' +VAT' : '');

  return (
    <div className="px-8 py-5 border-b border-gray-100 bg-gray-50/60">
      <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)] mb-3">Totals</p>
      <div className="max-w-md ml-auto space-y-1.5 text-sm">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between text-gray-700">
            <span>{r.label}</span>
            <span className="tabular-nums">{r.value}{vatSuffix}</span>
          </div>
        ))}

        {mode === 'first_year' ? (
          <>
            <div className="flex items-center justify-between text-gray-900 font-semibold border-t border-gray-200 pt-1.5 mt-1.5">
              <span>First-year total</span>
              <span className="tabular-nums">£{firstYearTotal.toFixed(2)}{vatSuffix}</span>
            </div>
            {showDiscount && (
              <>
                <div className="flex items-center justify-between text-emerald-700">
                  <span>
                    {proposal.discount_label ?? 'Discount'}
                    {discountType === 'percent' && discountRaw > 0 && (
                      <span className="text-xs text-[var(--text-muted)] ml-1">({discountRaw}% off)</span>
                    )}
                  </span>
                  <span className="font-semibold tabular-nums">− £{discountValue.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-gray-900 font-semibold border-t border-gray-200 pt-1.5 mt-1.5">
                  <span>Total after discount</span>
                  <span className="tabular-nums">£{afterDiscount.toFixed(2)}{vatSuffix}</span>
                </div>
              </>
            )}
          </>
        ) : (
          /* ── Monthly mode ─────────────────────────────────────────────
             Hides the first-year headline. If there's a discount, express
             it per-month. The headline becomes monthly-after-discount when
             a discount exists; otherwise just the monthly subtotal. */
          <>
            {showDiscount && monthly > 0 && (
              <div className="flex items-center justify-between text-emerald-700">
                <span>
                  {proposal.discount_label ?? 'Discount'}
                  {discountType === 'percent' && discountRaw > 0 && (
                    <span className="text-xs text-[var(--text-muted)] ml-1">({discountRaw}% off)</span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">− £{monthlyDiscount.toFixed(2)} /mo</span>
              </div>
            )}
            {monthly > 0 && (
              <div className="flex items-center justify-between text-gray-900 font-semibold border-t border-gray-200 pt-1.5 mt-1.5">
                <span>{showDiscount ? 'Monthly after discount' : 'Monthly total'}</span>
                <span className="tabular-nums">£{(showDiscount ? monthlyAfterDiscount : monthly).toFixed(2)} /mo{vatSuffix}</span>
              </div>
            )}
            {/* Tiny first-year reference for context (small, muted) so the
                prospect can still see the annual commitment if they want. */}
            {monthly > 0 && (
              <p className="text-[11px] text-[var(--text-muted)] text-right pt-1">
                Equivalent first-year total: £{afterDiscount.toFixed(2)}{vatSuffix}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FieldP({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</span>{children}</label>;
}

function FullPageState({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 bg-gray-50">
      {children}
    </div>
  );
}
