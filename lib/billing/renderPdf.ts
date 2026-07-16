'use client';

// Billing module — turn a self-contained A4 HTML document into a PDF, in the browser.
//
// The browser is the only renderer we have (no puppeteer server-side), so the
// client rasterises and posts pdf_base64 to the send route, which attaches it —
// the pattern Accounts Studio and Landlord already use.
//
// Unlike utils/pdfFromHtml.ts (which rebuilds a report into the host page and so
// loses the document's own `body` CSS), this loads the document into an offscreen
// iframe. It keeps its own page geometry — 794px is 210mm at 96dpi — so the PDF
// matches the on-screen preview exactly.

import { blobToBase64 } from '@/utils/pdfFromHtml';

const A4_W_PX = 794;
const A4_H_PX = 1123;
const A4_W_MM = 210;
const A4_H_MM = 297;
const SCALE = 2;            // 2× for legible text at A4
const JPEG_QUALITY = 0.92;
const MAX_PAGES = 20;       // sanity guard — these documents are never this long

/** Wait for the frame's document, fonts and images (the logo is a data URL). */
async function settle(iframe: HTMLIFrameElement, doc: Document): Promise<void> {
  if (doc.readyState !== 'complete') {
    await new Promise<void>(resolve => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      setTimeout(resolve, 2000); // never hang a send on a frame that won't fire
    });
  }
  try { await (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* fonts are cosmetic */ }
  await Promise.all(Array.from(doc.images).map(img => (
    img.complete ? Promise.resolve() : new Promise<void>(resolve => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    })
  )));
}

export async function renderHtmlPdfBlob(html: string): Promise<Blob> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  // Offscreen rather than display:none — a hidden frame has no layout to capture.
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_W_PX}px;height:${A4_H_PX}px;border:0;`;
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Could not open a frame to render the document.');
    doc.open();
    doc.write(html);
    doc.close();
    await settle(iframe, doc);

    const canvas = await html2canvas(doc.body, {
      scale: SCALE,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      width: A4_W_PX,
      windowWidth: A4_W_PX,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageHpx = A4_H_PX * SCALE;
    const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(canvas.height / pageHpx)));

    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage();
      const sliceH = Math.min(pageHpx, canvas.height - i * pageHpx);
      if (sliceH <= 0) break;
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceH;
      const ctx = slice.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, i * pageHpx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      // A short last page must keep its scale, not stretch to fill A4.
      const hMM = (sliceH / pageHpx) * A4_H_MM;
      pdf.addImage(slice.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, A4_W_MM, hMM);
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(iframe);
  }
}

export async function renderHtmlPdfBase64(html: string): Promise<string> {
  return blobToBase64(await renderHtmlPdfBlob(html));
}
