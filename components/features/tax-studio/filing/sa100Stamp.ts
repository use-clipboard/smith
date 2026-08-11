// Stamp a client's figures onto HMRC's official blank SA100 PDF (proof).
// Loads /hmrc-forms/SA100-2026.pdf, fills the four AcroForm identity fields
// exactly, and stamps the TR2 "what makes up your return" tick marks + a couple
// of TR3 income figures at page coordinates (extracted offline with pdf2json).
// Coordinates are first-pass — calibrate against the downloaded PDF.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { TaxReturn } from '../types';
import { computeSa100Full } from '../calc';
import { filingChecklist } from './filingModel';

// PDF page index → HMRC TR page (SA100-2026.pdf: pages 0–1 are cover/notes).
const TR = { TR1: 2, TR2: 3, TR3: 4, TR4: 5, TR5: 6, TR6: 7 };

// TR2 tick positions in pdf-lib coords (origin bottom-left). {yes:[x,y], no:[x,y]}
// — the X is drawn just right of the Yes/No word (its tick box).
const TR2_TICKS: Record<string, { yes: [number, number]; no: [number, number] }> = {
  employment:  { yes: [61.9, 629.7], no: [116.7, 629.7] },
  selfemp:     { yes: [61.9, 473.6], no: [116.7, 473.6] },
  partnership: { yes: [61.9, 397.7], no: [116.7, 397.7] },
  property:    { yes: [61.9, 298.1], no: [116.7, 298.1] },
  foreign:     { yes: [61.9, 147.3], no: [116.7, 147.3] },
  trusts:      { yes: [320.9, 635.2], no: [375.6, 635.2] },
  cgt:         { yes: [320.9, 377.0], no: [375.6, 377.0] },
  residence:   { yes: [320.8, 262.6], no: [375.5, 262.6] },
  additional:  { yes: [320.9, 151.1], no: [375.6, 151.1] },
};

const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

export async function downloadSa100Pdf(ret: TaxReturn): Promise<void> {
  const res = await fetch('/hmrc-forms/SA100-2026.pdf');
  if (!res.ok) throw new Error('Could not load the SA100 template.');
  const doc = await PDFDocument.load(await res.arrayBuffer());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  // Identity fields — filled exactly via the form's AcroForm fields.
  const form = doc.getForm();
  const setF = (name: string, val?: string | null) => { try { if (val) form.getTextField(name).setText(val); } catch { /* field absent */ } };
  setF('Name', ret.clientName);
  setF('UTR', ret.utr || undefined);
  setF('NINO', ret.taxpayer?.nino);

  // TR2 — X in Yes/No for each supplementary page, from which sections have data.
  const tr2 = pages[TR.TR2];
  const has = filingChecklist(ret);
  const drawX = (x: number, y: number) => tr2.drawText('X', { x: x + 16, y: y - 2, size: 11, font, color: rgb(0, 0, 0) });
  for (const [key, pos] of Object.entries(TR2_TICKS)) {
    const t = has[key] ? pos.yes : pos.no;
    drawX(t[0], t[1]);
  }

  // TR3 — a couple of income figures, right-aligned in the £ box (demo/calibration).
  const tr3 = pages[TR.TR3];
  const right = (xRight: number, y: number, n: number) => {
    if (!n) return;
    const txt = money(n);
    tr3.drawText(txt, { x: xRight - font.widthOfTextAtSize(txt, 10), y, size: 10, font });
  };
  right(285, 100, ret.income.savingsInterest || 0);   // box 2 — untaxed UK interest
  right(555, 112, ret.income.dividends || 0);          // box 4 — UK dividends

  // (computeSa100Full is available for the full box map in the next iteration.)
  void computeSa100Full;

  const blob = new Blob([await doc.save()], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ret.clientName || 'SA100'} — SA100 ${ret.taxYear}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
