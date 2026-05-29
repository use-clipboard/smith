/**
 * printReport — opens the contents of a `.bk-print-root` element in a
 * brand-new browser window, copies the host page's stylesheets across so
 * Tailwind classes resolve, and triggers the browser's print dialog.
 *
 * Why a separate window?
 *   • The Next.js app wraps the page in nested containers (#__next, layout
 *     padding, sidebar grids, etc). Anchoring a printable region in-place
 *     while hiding the rest with @media print fights those layouts and
 *     ends up either blank, centred on the page, or non-paginated when
 *     position:absolute is used.
 *   • A fresh window has a flat DOM (just <body><our content></body>) so
 *     the browser paginates long reports naturally and respects @page rules.
 *   • The original app keeps its React state — we don't mutate the live DOM
 *     at all.
 *
 * Caller passes the *root* element (the `.bk-print-root` div). We grab its
 * outerHTML, drop it into the new window inside a full HTML shell, and
 * call print() once stylesheets have loaded.
 */
export interface PrintReportOptions {
  /** Page orientation in the print dialog. Defaults to portrait — which
   *  suits the 3-column TB / P&L / BS reports. Use 'landscape' for wider
   *  tables (the 8-column recent-transactions modal needs it). */
  orientation?: 'portrait' | 'landscape';
}

export function printReport(
  rootElement: HTMLElement | null,
  documentTitle: string,
  options: PrintReportOptions = {},
): void {
  if (!rootElement) return;
  const orientation = options.orientation ?? 'portrait';

  // Capture every stylesheet + inline <style> from the host document so the
  // popup picks up Tailwind utilities, the bookkeeping print rules, etc.
  // Using outerHTML on <link> tags preserves the absolute URLs the browser
  // already resolved, which avoids broken-stylesheet 404s in the popup.
  const styleHtml = Array.from(
    document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style'),
  ).map(el => el.outerHTML).join('\n');

  const popup = window.open('', '_blank', 'width=900,height=1100');
  if (!popup) {
    // Pop-up blocked. Fall back to native window.print() — at least the
    // user gets *something* even if the layout's worse.
    window.print();
    return;
  }

  // Build a complete, isolated HTML document. We add `bk-printing` on
  // <html> + body so the @media print rules in globals.css know to apply
  // the printable-area formatting even outside a real print event (some
  // browsers only fire @media print AFTER the dialog opens, which can
  // cause a brief flash).
  popup.document.write(`<!DOCTYPE html>
<html lang="en" class="bk-printing">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(documentTitle)}</title>
    ${styleHtml}
    <style>
      /* Pop-up-only overrides — keep the print area visible on screen too,
         in case the user wants to inspect the layout before printing. */
      html, body { margin: 0; padding: 0; background: white; color: black; }
      body { padding: 14mm 16mm; }
      .bk-print-only { display: block !important; }
      .print-hidden { display: none !important; }
      /* Strip on-screen card chrome — the report is the whole document. */
      .bk-print-area {
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        background: white !important;
        overflow: visible !important;
        max-width: 100% !important;
        /* Some report roots carry a viewport-height min-height for the
           on-screen layout — reset it so a short schedule doesn't push a
           blank trailing page. */
        min-height: 0 !important;
        height: auto !important;
      }
      .bk-print-root { position: static !important; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      thead th { padding: 4pt 6pt; font-weight: 700; }
      tbody td { padding: 2pt 6pt; }
      /* Page break rules — try to keep rows together but allow tables to
         span pages. */
      tr { page-break-inside: avoid; }
      tbody { page-break-inside: auto; }
      /* Orientation set by the caller. Landscape gives wide tables (8+
         columns) room to breathe; portrait suits the standard 3-column
         accountant reports. */
      @page { size: A4 ${orientation}; margin: 12mm; }
      @media print {
        body { padding: 0; }  /* @page handles the margins */
      }
    </style>
  </head>
  <body>${rootElement.outerHTML}</body>
</html>`);
  popup.document.close();

  // Wait for stylesheets to load before firing print, otherwise the print
  // dialog shows an unstyled flash. Most browsers fire `load` on the popup
  // window once <link rel="stylesheet"> resources resolve.
  function fire() {
    popup.focus();
    popup.print();
    // Close after a short delay so Chrome's print preview has time to read
    // from the window. Some browsers auto-close when the dialog dismisses,
    // others keep the window — the timeout covers both.
    setTimeout(() => { try { popup.close(); } catch { /* user closed it */ } }, 500);
  }
  if (popup.document.readyState === 'complete') {
    // Already loaded (no external sheets, or cached).
    setTimeout(fire, 100);
  } else {
    popup.addEventListener('load', fire);
    // Safety net — if load never fires (cached cross-origin sheet etc.),
    // print anyway after 1s.
    setTimeout(fire, 1000);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
