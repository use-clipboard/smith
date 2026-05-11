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
  discount_label: string | null;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  sent_at: string | null;
  expires_at: string | null;
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

export default function ProposalPublicView({ token }: { token: string }) {
  const [proposal, setProposal] = useState<PublicProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chosenPackage, setChosenPackage] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [typedSig, setTypedSig] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declineOpen, setDeclineOpen] = useState(false);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);

  useEffect(() => {
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
  }, [token]);

  async function accept() {
    if (!proposal) return;
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
    return (
      <FullPageState>
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center"><Check size={24} className="text-emerald-700" /></div>
        <h1 className="text-lg font-semibold">Thanks, {proposal.prospect.contact_name.split(' ')[0]}!</h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-md text-center">Your acceptance has been recorded.</p>
        <a href={`/p/${token}/onboarding`} className="text-sm text-white bg-[var(--accent)] px-4 py-2 rounded-md font-semibold">Continue to onboarding form →</a>
        <p className="text-[11px] text-[var(--text-muted)] max-w-md text-center">We've also emailed you a link in case you'd rather complete it later.</p>
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

        {/* Discount */}
        {proposal.discount_amount > 0 && (
          <div className="px-8 py-3 border-b border-gray-100 text-sm flex justify-between bg-emerald-50/40">
            <span>{proposal.discount_label ?? 'Discount'}</span>
            <span className="font-semibold text-emerald-700">− £{Number(proposal.discount_amount).toFixed(2)}</span>
          </div>
        )}

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
              <button onClick={() => setDeclineOpen(true)} className="btn-secondary text-sm">Decline</button>
              <button onClick={() => void accept()} disabled={accepting} className="text-sm inline-flex items-center gap-1.5 text-white px-4 py-2 rounded-md font-semibold disabled:opacity-50" style={{ background: brand.primary_color }}>
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
