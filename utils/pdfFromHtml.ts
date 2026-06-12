'use client';

import type { RefObject } from 'react';

/**
 * Render an HTML report as a PDF Blob using html2canvas + jsPDF.
 *
 * When `paperRef` is supplied we clone the live editor DOM. This guarantees
 * that exactly the same CSS the browser used to render the editor is also
 * used for the PDF — so page positions match the grey page-break bands the
 * user sees while editing.
 *
 * Fallback: if no ref is supplied, we rebuild from the HTML string.
 *
 * Extracted from SaveReportModal so it can also be used for direct
 * "download from history" flows that don't have a live DOM to clone.
 */
export async function generatePdfBlob(
  htmlContent: string,
  paperRef?: RefObject<HTMLElement | null>,
): Promise<Blob> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);

  const A4_W_MM   = 210;
  const A4_H_MM   = 297;
  // Hard cap to prevent a runaway canvas from generating a 100MB+ PDF.
  // Legitimate performance reports are ~10-40 pages; anything beyond
  // SANITY_MAX_PAGES indicates a layout bug in the source DOM.
  const SANITY_MAX_PAGES = 100;
  const SCALE = 1.5;
  const CONTENT_W_PX = 794;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;';

  let captureTarget: HTMLElement;
  const livePaper = paperRef?.current ?? null;

  // String-HTML reports (no live editor clone) get a clean printed margin on
  // every page so text never runs to the paper edge. The live-editor path
  // keeps a zero PDF margin so the page-break bands the user sees while
  // editing line up exactly with the rendered output.
  const MARGIN_MM  = livePaper ? 0 : 10;
  const PRINT_W_MM = A4_W_MM - MARGIN_MM * 2;
  const PRINT_H_MM = A4_H_MM - MARGIN_MM * 2;
  // One printable page height in px, derived so the captured content keeps the
  // A4 aspect ratio when mapped onto the printable area (no vertical squish).
  // With MARGIN_MM = 0 this is the original 1123px.
  const PAGE_H_PX  = Math.round((PRINT_H_MM * CONTENT_W_PX) / PRINT_W_MM);

  if (livePaper) {
    const clone = livePaper.cloneNode(true) as HTMLDivElement;
    clone.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());
    clone.style.overflow   = 'visible';
    clone.style.boxShadow  = 'none';
    clone.style.borderRadius = '0';
    clone.style.margin     = '0';
    clone.style.maxWidth   = '794px';
    clone.style.width      = '794px';
    clone.querySelectorAll('[contenteditable]').forEach(el => {
      (el as HTMLElement).setAttribute('contenteditable', 'false');
    });
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    captureTarget = clone;
  } else {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const styleContent = Array.from(doc.querySelectorAll('style'))
      .map(s => s.textContent ?? '')
      .join('\n');
    const bodyContent = doc.body.innerHTML;
    wrapper.style.background = '#fff';
    wrapper.innerHTML = `<style>${styleContent}</style><div style="padding:40px 40px 0;background:#fff;">${bodyContent}</div>`;
    document.body.appendChild(wrapper);
    captureTarget = wrapper;
  }

  try {
    void captureTarget.offsetHeight;

    // Phase 1: push .force-page-start elements to the next page boundary
    for (let pass = 0; pass < 20; pass++) {
      let inserted = false;
      void captureTarget.offsetHeight;
      const originY = captureTarget.getBoundingClientRect().top;

      for (const el of Array.from(captureTarget.querySelectorAll('.force-page-start')) as HTMLElement[]) {
        const elTop      = Math.round(el.getBoundingClientRect().top - originY);
        const pageOffset = elTop % PAGE_H_PX;
        if (pageOffset > PAGE_H_PX * 0.65) {
          const spacer = document.createElement('div');
          spacer.style.cssText = `height:${PAGE_H_PX - pageOffset}px;line-height:0;font-size:0;`;
          el.parentNode!.insertBefore(spacer, el);
          inserted = true;
          break;
        }
      }
      if (!inserted) break;
    }

    // Phase 2: keep content off page boundaries. Push any element of the given
    // selector that straddles a page break (and still fits on one page) onto
    // the next page by inserting a spacer before it.
    const avoidSplit = (selector: string, maxPasses: number) => {
      for (let pass = 0; pass < maxPasses; pass++) {
        let inserted = false;
        void captureTarget.offsetHeight;
        const originY = captureTarget.getBoundingClientRect().top;

        for (const el of Array.from(captureTarget.querySelectorAll(selector)) as HTMLElement[]) {
          const rect     = el.getBoundingClientRect();
          const elTop    = Math.round(rect.top  - originY);
          const elBottom = Math.round(rect.bottom - originY);
          const elH      = elBottom - elTop;
          const pageStart = Math.floor(elTop    / PAGE_H_PX);
          const pageEnd   = Math.floor((elBottom - 1) / PAGE_H_PX);
          if (pageStart < pageEnd && elH <= PAGE_H_PX) {
            const pushBy = PAGE_H_PX - (elTop % PAGE_H_PX);
            const spacer = document.createElement('div');
            spacer.style.cssText = `height:${pushBy}px;line-height:0;font-size:0;`;
            el.parentNode!.insertBefore(spacer, el);
            inserted = true;
            break;
          }
        }
        if (!inserted) break;
      }
    };

    // 2a — keep each WHOLE working paper / review point on a single page first,
    // so a section is never split when it fits on one page.
    avoidSplit('.paper, .review-point', 100);
    // 2b — for papers genuinely taller than a page, at least keep their inner
    // text blocks (paragraphs, monospace, notes, journals) from being cut.
    avoidSplit('.wp-para, pre, .wp-notes, .journal-section', 100);

    const canvas = await html2canvas(captureTarget, {
      scale: SCALE,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 794,
    });

    const pageHeightCanvasPx = PAGE_H_PX * SCALE;
    const numPages = Math.max(1, Math.ceil(canvas.height / pageHeightCanvasPx));

    if (numPages > SANITY_MAX_PAGES) {
      throw new Error(
        `Generated PDF would be ${numPages} pages — the report's rendered height (${Math.round(canvas.height / SCALE)}px) is far larger than expected. ` +
        `This usually means a layout bug in the editor (e.g. an element with runaway height). ` +
        `Try refreshing the page, removing the most recent section, or contact support.`,
      );
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Slice the captured canvas into per-page sub-canvases. Each PDF page
    // gets its own (smaller) PNG instead of the whole giant image being
    // embedded once per page — which previously bloated the file (a 1090-
    // page report came out at 106MB because every page held the full image).
    for (let i = 0; i < numPages; i++) {
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = pageHeightCanvasPx;
      const ctx = sliceCanvas.getContext('2d');
      if (!ctx) continue;
      // Fill the slice with white so any "missing" pixels (the last partial
      // page) render as white rather than transparent/black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        canvas,
        0, i * pageHeightCanvasPx,                  // source x, y
        canvas.width, pageHeightCanvasPx,           // source w, h
        0, 0,                                       // dest x, y
        canvas.width, pageHeightCanvasPx,           // dest w, h
      );

      const sliceImgData = sliceCanvas.toDataURL('image/png');
      if (i > 0) pdf.addPage();
      pdf.addImage(sliceImgData, 'PNG', MARGIN_MM, MARGIN_MM, PRINT_W_MM, PRINT_H_MM);
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(wrapper);
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
