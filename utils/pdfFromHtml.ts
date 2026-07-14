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
/** Performance-report PDF options. When `pageMarginPx` is set (live-editor path
 *  only), the exporter matches the live paginator: the cover becomes its own
 *  full-bleed first page, and body pages use the same margins so the same amount
 *  of content lands on each page. Leaving these unset preserves the original
 *  full-bleed slicing used by working papers / Accounts Review. */
export interface PdfPaginationOptions {
  coverSelector?: string;      // e.g. '[data-cover]' — rendered as its own page
  pageMarginPx?: number;       // per-page top/bottom margin (matches live, e.g. 48)
  avoidSplitSelector?: string; // blocks that must not be cut across a page break
  // ── Accounts-pack layout (string path only; opt-in so other tools are unchanged) ──
  hardPageBreaks?: boolean;    // every `.force-page-start` element begins a fresh page
  pageNumbers?: boolean;       // draw "N of T" bottom-centre on every page except the first (cover)
}

export async function generatePdfBlob(
  htmlContent: string,
  paperRef?: RefObject<HTMLElement | null>,
  opts?: PdfPaginationOptions,
): Promise<Blob> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);

  const A4_W_MM   = 210;
  const A4_H_MM   = 297;
  const SANITY_MAX_PAGES = 100;
  const SCALE = 1.5;
  const CONTENT_W_PX = 794;
  const PX_PER_MM = CONTENT_W_PX / A4_W_MM; // 794px ↔ 210mm

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;';

  let captureTarget: HTMLElement;
  const livePaper = paperRef?.current ?? null;
  // Performance "match the live paginator" mode — only on the live-editor path.
  const perfMode = !!(livePaper && opts?.pageMarginPx);

  // ── Page geometry ──────────────────────────────────────────────────────────
  // perfMode: full page width (the editor's own 48px side padding is the side
  //   margin, already baked into the 794px capture), with top/bottom margins so
  //   each body page holds exactly one live page's worth of content.
  // default: original behaviour (full bleed for live clones, 10mm for strings).
  let imgX: number, imgY: number, imgW: number, imgH: number, PAGE_H_PX: number;
  if (perfMode) {
    const marginMM = opts!.pageMarginPx! / PX_PER_MM; // 48px → ~12.7mm
    imgX = 0; imgY = marginMM; imgW = A4_W_MM; imgH = A4_H_MM - marginMM * 2;
    PAGE_H_PX = Math.round(imgH * PX_PER_MM);          // ≈ 1027px content/page
  } else {
    const MARGIN_MM = livePaper ? 0 : 10;
    imgX = MARGIN_MM; imgY = MARGIN_MM;
    imgW = A4_W_MM - MARGIN_MM * 2; imgH = A4_H_MM - MARGIN_MM * 2;
    PAGE_H_PX = Math.round((imgH * CONTENT_W_PX) / imgW);
  }

  if (livePaper) {
    const clone = livePaper.cloneNode(true) as HTMLDivElement;
    clone.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());

    // PaginationPlus injects page chrome (headers/footers/gap bands) as widgets,
    // plus a global stylesheet keyed off `.rm-with-pagination` that restyles
    // tables. Strip both so the clone is clean, continuous content (the PDF
    // paginates it itself below).
    clone.querySelectorAll(
      '.rm-page-header, .rm-page-footer, .rm-pagination-gap, .rm-page-break, .rm-page-break-blank, [data-rm-pagination]'
    ).forEach(el => el.remove());
    clone.querySelectorAll('[class*="rm-page"], [class*="rm-pagination"]').forEach(el => el.remove());
    if (clone.classList.contains('rm-with-pagination')) clone.classList.remove('rm-with-pagination');
    clone.querySelectorAll('.rm-with-pagination').forEach(el => el.classList.remove('rm-with-pagination'));
    // PaginationPlus sets an inline min-height on the editor to fit its page boxes.
    // The clone must shrink to actual content height — otherwise that padding (and
    // any over-measurement) adds blank trailing pages, or a runaway, to the PDF.
    clone.style.minHeight = '';
    clone.querySelectorAll<HTMLElement>('[style*="min-height"]').forEach(el => { el.style.minHeight = ''; });
    clone.style.overflow   = 'visible';
    clone.style.boxShadow  = 'none';
    clone.style.borderRadius = '0';
    clone.style.margin     = '0';
    clone.style.maxWidth   = '794px';
    clone.style.width      = '794px';
    // Pin the font so the PDF matches the on-screen editor (the report prose is
    // Arial; without this html2canvas can fall back to a different sans).
    clone.style.fontFamily = 'Arial, Helvetica, sans-serif';
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
    wrapper.innerHTML = `<style>${styleContent}</style><div style="padding:40px 40px 0;background:#fff;font-family:Arial,Helvetica,sans-serif;">${bodyContent}</div>`;
    document.body.appendChild(wrapper);
    captureTarget = wrapper;
  }

  try {
    void captureTarget.offsetHeight;

    // A spacer that's valid wherever it's inserted: a <tr> inside a table body
    // (a <div> there is invalid HTML and collapses), a <div> anywhere else.
    const makeSpacer = (before: HTMLElement, height: number): HTMLElement => {
      if (before.tagName === 'TR') {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = Math.max(1, before.children.length);
        td.style.cssText = `height:${height}px;padding:0;border:0;`;
        tr.style.cssText = 'line-height:0;font-size:0;';
        tr.appendChild(td);
        return tr;
      }
      const div = document.createElement('div');
      div.style.cssText = `height:${height}px;line-height:0;font-size:0;`;
      return div;
    };

    // Push any element matching `selector` that straddles a page boundary (and
    // fits within one page) onto the next page, by inserting a spacer before it.
    // Guarded against runaway cascades: spacers can shift everything below and
    // create new straddles, so we cap total injected height to one document's
    // worth and bail if exceeded.
    const avoidSplit = (selector: string, maxPasses: number) => {
      const baseHeight = captureTarget.scrollHeight;
      let injected = 0;
      const injectBudget = baseHeight + PAGE_H_PX * 4; // never more than ~content + a few pages
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
            if (injected + pushBy > injectBudget) return; // runaway guard
            injected += pushBy;
            el.parentNode!.insertBefore(makeSpacer(el, pushBy), el);
            inserted = true;
            break;
          }
        }
        if (!inserted) break;
      }
    };

    // Force every element matching `selector` to begin at the top of a fresh
    // page (hard page break), by padding out the remainder of the current page.
    // Used by the accounts pack so each statement/report starts on its own page.
    const hardBreak = (selector: string, maxPasses: number) => {
      const injectBudget = captureTarget.scrollHeight + PAGE_H_PX * 16;
      let injected = 0;
      for (let pass = 0; pass < maxPasses; pass++) {
        let inserted = false;
        void captureTarget.offsetHeight;
        const originY = captureTarget.getBoundingClientRect().top;
        for (const el of Array.from(captureTarget.querySelectorAll(selector)) as HTMLElement[]) {
          const top = Math.round(el.getBoundingClientRect().top - originY);
          const rem = top % PAGE_H_PX;
          if (top > 2 && rem > 2) {            // not already at a page top
            const pushBy = PAGE_H_PX - rem;
            if (injected + pushBy > injectBudget) return; // runaway guard
            injected += pushBy;
            el.parentNode!.insertBefore(makeSpacer(el, pushBy), el);
            inserted = true;
            break;
          }
        }
        if (!inserted) break;
      }
    };

    // Contents page: write each section's real page number into its matching
    // cell. `[data-toc="key"]` marks a section; `[data-toc-fill="key"]` is the
    // number cell on the contents page. Measured after all breaks are inserted,
    // and writing the number doesn't change layout (the cell is pre-sized).
    const fillTocPageNumbers = () => {
      void captureTarget.offsetHeight;
      const originY = captureTarget.getBoundingClientRect().top;
      for (const el of Array.from(captureTarget.querySelectorAll('[data-toc]')) as HTMLElement[]) {
        const top = Math.round(el.getBoundingClientRect().top - originY);
        const page = Math.floor(top / PAGE_H_PX) + 1; // cover is page 1
        const key = el.getAttribute('data-toc');
        const target = key && captureTarget.querySelector(`[data-toc-fill="${CSS.escape(key)}"]`);
        if (target) target.textContent = String(page);
      }
    };

    // ── Cover (perfMode): capture it as its own full-bleed first page, then
    //    remove it so the body content paginates on its own clean grid. ──
    let coverCanvas: HTMLCanvasElement | null = null;
    if (perfMode && opts?.coverSelector) {
      const coverInner = captureTarget.querySelector(opts.coverSelector);
      const coverWrap = (coverInner?.parentElement ?? coverInner) as HTMLElement | null;
      if (coverWrap) {
        coverCanvas = await html2canvas(coverWrap, {
          scale: SCALE, useCORS: true, logging: false, backgroundColor: '#ffffff', windowWidth: 794,
        });
        coverWrap.remove();
        void captureTarget.offsetHeight;
      }
    }

    if (perfMode) {
      // Keep whole blocks (headings, paragraphs, tables, lists) off page breaks,
      // mirroring the live paginator's whole-block behaviour.
      if (opts?.avoidSplitSelector) avoidSplit(opts.avoidSplitSelector, 80);
    } else if (opts?.hardPageBreaks) {
      // Accounts pack: keep blocks together, then force each section to a fresh
      // page (authoritative), then compute the contents-page numbers.
      avoidSplit('.paper', 140);
      // Optional: stop smaller blocks (e.g. table rows) being sliced in half by a
      // page break. Each pass can shift later sections off their page top, so we
      // re-run the hard breaks and settle over a few iterations.
      if (opts.avoidSplitSelector) {
        for (let pass = 0; pass < 3; pass++) {
          hardBreak('.force-page-start', 200);
          avoidSplit(opts.avoidSplitSelector, 300);
        }
      }
      hardBreak('.force-page-start', 200);
      fillTocPageNumbers();
    } else {
      // Working-papers / Accounts Review behaviour (unchanged).
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
      avoidSplit('.paper, .review-point', 100);
      avoidSplit('.wp-para, pre, .wp-notes, .journal-section', 100);
    }

    const canvas = await html2canvas(captureTarget, {
      scale: SCALE,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 794,
    });

    const pageHeightCanvasPx = PAGE_H_PX * SCALE;
    const numContentPages = Math.max(1, Math.ceil(canvas.height / pageHeightCanvasPx));
    const totalPages = numContentPages + (coverCanvas ? 1 : 0);

    if (totalPages > SANITY_MAX_PAGES) {
      throw new Error(
        `Generated PDF would be ${totalPages} pages — the report's rendered height (${Math.round(canvas.height / SCALE)}px) is far larger than expected. ` +
        `This usually means a layout bug in the editor (e.g. an element with runaway height). ` +
        `Try refreshing the page, removing the most recent section, or contact support.`,
      );
    }

    // Page images are embedded as compressed JPEG rather than lossless PNG:
    // for rasterised text/tables on a white background this is visually
    // identical but ~10-20x smaller, keeping the PDF emailable (the previous
    // PNG output could reach tens of MB and breach the attachment limit).
    // `compress` additionally deflates the PDF object streams.
    const IMG_QUALITY = 0.85;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    let firstPage = true;
    let pageCount = 0;
    const newPage = () => { if (!firstPage) pdf.addPage(); firstPage = false; pageCount++; };
    // "N of T" bottom-centre, skipping the cover (page 1).
    const stampPageNumber = () => {
      if (!opts?.pageNumbers || pageCount <= 1) return;
      pdf.setFontSize(9);
      pdf.setTextColor(130);
      pdf.text(`${pageCount} of ${totalPages}`, A4_W_MM / 2, A4_H_MM - 7, { align: 'center' });
      pdf.setTextColor(0);
    };

    // Cover page (perfMode) — full bleed.
    if (coverCanvas) {
      newPage();
      pdf.addImage(coverCanvas.toDataURL('image/jpeg', IMG_QUALITY), 'JPEG', 0, 0, A4_W_MM, A4_H_MM);
      stampPageNumber();
    }

    // Body pages — one canvas slice per page, placed within the page margins.
    for (let i = 0; i < numContentPages; i++) {
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = pageHeightCanvasPx;
      const ctx = sliceCanvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        canvas,
        0, i * pageHeightCanvasPx,
        canvas.width, pageHeightCanvasPx,
        0, 0,
        canvas.width, pageHeightCanvasPx,
      );

      newPage();
      pdf.addImage(sliceCanvas.toDataURL('image/jpeg', IMG_QUALITY), 'JPEG', imgX, imgY, imgW, imgH);
      stampPageNumber();
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
