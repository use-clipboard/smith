'use client';

// Renders the real invoice document (lib/billing/invoicePdf → buildInvoiceHtml)
// into a sandboxed iframe, scaled down to fit. Two uses:
//   • <InvoicePreview> — the full A4 page, live-following the branding form.
//   • <InvoiceThumbnail> — the top band only, as the template picker's swatch.
//
// The iframe is inert (no scripts, no pointer events, not tabbable): it's a
// picture of a document, not a thing to interact with.

import { useMemo } from 'react';
import { buildInvoiceHtml, type InvoiceLetterhead } from '@/lib/billing/invoicePdf';
import { buildSampleInvoice } from '@/lib/billing/sampleInvoice';

// A4 portrait at 96dpi — matches the @page size in the document itself.
const A4_W = 794;
const A4_H = 1123;

interface Props {
  letterhead: InvoiceLetterhead;
  /** Rendered width in px; the page is scaled to it. */
  width: number;
  /** Crop the page to this height (px, after scaling) — used for thumbnails. */
  cropHeight?: number;
  invoiceNumber?: string;
  vatRate?: number;
}

function useInvoiceHtml(letterhead: InvoiceLetterhead, invoiceNumber?: string, vatRate?: number) {
  // Serialise the inputs so a same-shaped letterhead object doesn't rebuild the
  // document (and flash the iframe) on every parent render.
  const key = JSON.stringify({ letterhead, invoiceNumber, vatRate });
  return useMemo(() => {
    const { letterhead: lh, invoiceNumber: num, vatRate: rate } = JSON.parse(key) as {
      letterhead: InvoiceLetterhead; invoiceNumber?: string; vatRate?: number;
    };
    return buildInvoiceHtml(buildSampleInvoice({ number: num, vatRate: rate }), lh);
  }, [key]);
}

export default function InvoicePreview({ letterhead, width, cropHeight, invoiceNumber, vatRate }: Props) {
  const html = useInvoiceHtml(letterhead, invoiceNumber, vatRate);
  const scale = width / A4_W;
  const height = cropHeight ?? A4_H * scale;

  return (
    <div
      className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm"
      style={{ width, height }}
    >
      <iframe
        srcDoc={html}
        title="Invoice preview"
        aria-hidden
        tabIndex={-1}
        sandbox=""
        scrolling="no"
        style={{
          width: A4_W,
          height: A4_H,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/** The top band of the page — enough to show the template's shape and colour. */
export function InvoiceThumbnail({ letterhead, width, height = 116 }: { letterhead: InvoiceLetterhead; width: number; height?: number }) {
  return <InvoicePreview letterhead={letterhead} width={width} cropHeight={height} />;
}
