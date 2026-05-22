'use client';

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import ProposalPublicView from '@/app/p/[token]/ProposalPublicView';

/**
 * Live preview that renders the exact `ProposalPublicView` the prospect
 * will see — same brand, same colours, same layout, same fonts — but driven
 * by the in-memory form state instead of by a public token. Accept and
 * decline buttons are visible but disabled; a "preview mode" banner makes
 * the difference clear.
 *
 * Brand info is fetched once from /api/proposals/brand (the same data the
 * public endpoint uses).
 */

type Frequency = 'one_off' | 'monthly' | 'quarterly' | 'annual';

interface PreviewProposal {
  id?:             string;
  title:           string;
  intro:           string | null;
  terms:           string | null;
  vat_mode:        'inclusive' | 'exclusive';
  vat_rate:        number;
  discount_amount: number;
  discount_type:   'amount' | 'percent';
  discount_label:  string | null;
  status:          'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  sent_at:         string | null;
  expires_at:      string | null;
  /** Optional — preview reads through to the public view's new totals modes
   *  + post-acceptance gating. Null/undefined falls back to the defaults. */
  totals_display?: 'first_year' | 'monthly' | null;
  post_acceptance_action?: 'none' | 'send_onboarding' | 'auto_create_client' | null;
  prospect:        { contact_name: string; company_name: string | null; email: string };
}

interface PreviewPackage {
  id:           string;
  name:         string;
  description:  string | null;
  display_order?: number;
}

interface PreviewLineItem {
  id:                 string;
  offered_package_id: string | null;
  service_name:       string;
  description:        string | null;
  tier_label:         string | null;
  frequency:          Frequency;
  unit_price:         number;
  quantity:           number;
  vat_treatment:      'inclusive' | 'exclusive' | 'exempt';
  display_order?:     number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  proposal: PreviewProposal;
  packages: PreviewPackage[];
  items: PreviewLineItem[];
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

function totalsFor(items: PreviewLineItem[]): { one_off: number; monthly: number; annual: number } {
  let one_off = 0, monthly = 0, annual = 0;
  for (const li of items) {
    const sub = (Number(li.unit_price) || 0) * (Number(li.quantity) || 1);
    if (li.frequency === 'one_off')        one_off += sub;
    else if (li.frequency === 'monthly')   monthly += sub;
    else if (li.frequency === 'quarterly') monthly += sub / 3;
    else if (li.frequency === 'annual')    annual  += sub;
  }
  return { one_off, monthly, annual };
}

export default function ProposalPreviewModal({ open, onClose, proposal, packages, items }: Props) {
  const [brand, setBrand]       = useState<BrandPayload | null>(null);
  const [firmName, setFirmName] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Fetch brand once when the modal first opens. Cache afterwards so
  // reopening the modal mid-session is instant.
  useEffect(() => {
    if (!open || brand) return;
    setLoading(true);
    setError(null);
    fetch('/api/proposals/brand')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then(j => { setBrand(j.brand); setFirmName(j.firm_name); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, brand]);

  if (!open) return null;

  // Build the PublicProposal-shaped object the public view expects. Totals
  // are recomputed from current line items so the preview shows what the
  // prospect would see after the next save, not what's on disk.
  const grandTotals = totalsFor(items);
  const grandedPackages = packages.map(pkg => {
    const t = totalsFor(items.filter(li => li.offered_package_id === pkg.id));
    return {
      ...pkg,
      display_order: pkg.display_order ?? 0,
      total_one_off: t.one_off,
      total_monthly: t.monthly,
      total_annual:  t.annual,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const previewData: any = {
    id:               proposal.id ?? 'preview',
    title:            proposal.title || 'Untitled proposal',
    intro:            proposal.intro,
    terms:            proposal.terms,
    vat_mode:         proposal.vat_mode,
    vat_rate:         proposal.vat_rate,
    discount_amount:  proposal.discount_amount,
    discount_type:    proposal.discount_type,
    discount_label:   proposal.discount_label,
    // Pass through the new builder settings so the preview reflects what the
    // prospect will actually see — including the Totals headline mode and
    // the post-acceptance gating on the thank-you screen.
    totals_display:        proposal.totals_display ?? 'first_year',
    post_acceptance_action: proposal.post_acceptance_action ?? 'send_onboarding',
    // Always render the editable / not-yet-decided layout so the preparer
    // sees the accept/decline panel exactly as the prospect would.
    status:           'sent',
    sent_at:          proposal.sent_at,
    expires_at:       proposal.expires_at,
    total_one_off:    grandTotals.one_off,
    total_monthly:    grandTotals.monthly,
    total_annual:     grandTotals.annual,
    firm_name:        firmName,
    brand:            brand ?? {
      logo_url: null, header_image_url: null, primary_color: '#0EA5E9', accent_color: '#0284C7',
      font_family: 'system', footer_text: null, show_firm_name: true,
    },
    prospect:         proposal.prospect,
    offered_packages: grandedPackages,
    line_items:       items.map((li, idx) => ({
      ...li,
      display_order: li.display_order ?? idx,
    })),
    required_signers: [],
    signatures:       [],
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-stretch justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-6 mx-4 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button (proposal view has its own print button) */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg text-white/90 hover:bg-black/15 transition-colors print:hidden"
          aria-label="Close preview"
        >
          <X size={16} />
        </button>

        <div className="overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-20 gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" /> Loading preview…
            </div>
          )}
          {error && !loading && (
            <div className="px-6 py-10 text-sm text-red-600">{error}</div>
          )}
          {!loading && !error && (
            <ProposalPublicView previewData={previewData} />
          )}
        </div>
      </div>
    </div>
  );
}
