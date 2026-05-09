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
  const MARGIN_V  = 14;
  const CONTENT_H_MM = A4_H_MM - MARGIN_V * 2;
  const PAGE_H_PX = Math.round(794 * CONTENT_H_MM / A4_W_MM);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;';

  let captureTarget: HTMLElement;
  const livePaper = paperRef?.current ?? null;

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

    // Phase 2: prevent .paper sections from spanning page boundaries
    for (let pass = 0; pass < 30; pass++) {
      let inserted = false;
      void captureTarget.offsetHeight;
      const originY = captureTarget.getBoundingClientRect().top;

      for (const el of Array.from(captureTarget.querySelectorAll('.paper')) as HTMLElement[]) {
        const rect     = el.getBoundingClientRect();
        const elTop    = Math.round(rect.top  - originY);
        const elBottom = Math.round(rect.bottom - originY);
        const elH      = elBottom - elTop;
        const pageStart = Math.floor(elTop    / PAGE_H_PX);
        const pageEnd   = Math.floor((elBottom - 1) / PAGE_H_PX);
        if (pageStart < pageEnd && elH <= PAGE_H_PX) {
          const pageOffset = elTop % PAGE_H_PX;
          const pushBy     = PAGE_H_PX - pageOffset;
          const spacer     = document.createElement('div');
          spacer.style.cssText = `height:${pushBy}px;line-height:0;font-size:0;`;
          el.parentNode!.insertBefore(spacer, el);
          inserted = true;
          break;
        }
      }
      if (!inserted) break;
    }

    const canvas = await html2canvas(captureTarget, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 794,
    });

    const imgData  = canvas.toDataURL('image/png');
    const pdf      = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgW     = A4_W_MM;
    const imgH_MM  = (canvas.height * A4_W_MM) / canvas.width;
    const numPages = Math.max(1, Math.ceil(imgH_MM / CONTENT_H_MM));

    for (let i = 0; i < numPages; i++) {
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, MARGIN_V - i * CONTENT_H_MM, imgW, imgH_MM);
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
