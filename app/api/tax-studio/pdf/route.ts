import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';

// Render the tax-return facsimile to a PDF with a real headless-Chrome engine.
// The client sends the exact sheets HTML + the page's stylesheet text (the same
// markup the on-screen preview shows); we rasterise it server-side so the PDF
// matches the preview precisely — correct text position, colours (printBackground)
// and full-bleed A4 — with none of the client-side quirks (html2canvas mis-places
// text; the browser print dialog depends on the user's own settings).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  html: z.string().min(1),
  css: z.string().default(''),
  title: z.string().default('Tax Return'),
});

function safeFileName(t: string): string {
  return (t.replace(/[\\/:*?"<>|]/g, '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Tax Return').slice(0, 180);
}

async function launchBrowser() {
  const puppeteer = (await import('puppeteer-core')).default;
  const onServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.AWS_EXECUTION_ENV;
  if (onServerless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  // Local dev: use an installed Chrome/Edge (set PUPPETEER_EXECUTABLE_PATH to override).
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean) as string[];
  return puppeteer.launch({ executablePath: candidates[0], headless: true, args: ['--no-sandbox'] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try { body = BodySchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>${body.css}</style>
<style>
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .sa-sheets-wrap { zoom: 1 !important; transform: none !important; padding: 0 !important; margin: 0 !important; width: auto !important; height: auto !important; max-height: none !important; overflow: visible !important; display: block !important; background: #fff; }
  .sa-sheet { box-shadow: none !important; margin: 0 auto !important; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
  .sa-sheet:last-child { page-break-after: auto; break-after: auto; }
  /* The app's own print rules (e.g. #sa-filing-preview's "body * {visibility:hidden}")
     get copied in via the stylesheet text — make sure the sheets stay visible. */
  .sa-sheets-wrap, .sa-sheet, .sa-sheet * { visibility: visible !important; }
  @page { size: A4; margin: 0; }
</style></head><body><div class="sa-sheets-wrap">${body.html}</div></body></html>`;

  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(doc, { waitUntil: 'load', timeout: 30000 });
    // Render as SCREEN media: page.pdf() defaults to print media, which would
    // activate the app's copied @media print rules (visibility:hidden, stray
    // @page margins) and blank the pages. Screen media = the on-screen preview.
    // Pagination still works via the .sa-sheet page-break rules.
    await page.emulateMediaType('screen');
    try { await page.evaluateHandle('document.fonts.ready'); } catch { /* fonts are cosmetic */ }
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    await browser.close();
    browser = undefined;
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFileName(body.title)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    try { await browser?.close(); } catch { /* noop */ }
    console.error('[tax-studio pdf] generation failed', err);
    return NextResponse.json({ error: 'Could not generate the PDF. Please try again.' }, { status: 500 });
  }
}
