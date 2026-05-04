/**
 * Shared PDF generation for meeting notes.
 * Used by both:
 *   • /api/meeting-notes/download-pdf  (returns binary to browser)
 *   • /api/meeting-notes/save-pdf-to-drive  (generates and uploads to Drive)
 *
 * Design: dark-blue header banner · coloured section bands · card-style list items
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';

export const ActionItemSchema = z.object({
  action:   z.string(),
  owner:    z.string(),
  deadline: z.string(),
});

export const MeetingPDFSchema = z.object({
  title:           z.string().min(1),
  meetingDate:     z.string(),
  meetingTime:     z.string().optional(),
  durationSeconds: z.number().optional(),
  location:        z.string().optional(),
  attendees:       z.array(z.string()).default([]),
  clientName:      z.string().optional(),
  summary:         z.string(),
  keyPoints:       z.array(z.string()).default([]),
  actionItems:     z.array(ActionItemSchema).default([]),
  decisions:       z.array(z.string()).default([]),
  formalMinutes:   z.string().optional(),
  nextMeeting:     z.string().optional(),
});

export type MeetingPDFData = z.infer<typeof MeetingPDFSchema>;

// ── Sanitization ──────────────────────────────────────────────────────────────
// pdf-lib's built-in Helvetica uses WinAnsiEncoding (Windows-1252).
// Convert common Unicode punctuation/symbols to safe ASCII equivalents.
function sanitize(text: string): string {
  return text
    // Smart quotes
    .replace(/[‘’‚‛`]/g, "'")
    .replace(/[“”„‟]/g, '"')
    // Dashes
    .replace(/[—―⸺⸻]/g, '--')   // em-dash, horizontal bar
    .replace(/[–‒‑‐]/g, '-')     // en-dash, figure dash
    .replace(/[−]/g, '-')                        // minus sign
    // Ellipsis & bullets
    .replace(/[…⋯]/g, '...')
    .replace(/[•‣⁃◦∙●▪▫◾‧]/g, '-')
    // Box-drawing / horizontal rule characters (entire Unicode box-drawing block)
    .replace(/[─-╿]/g, '-')
    // Geometric / block elements used as bullets
    .replace(/[■-◿]/g, '-')
    // Arrows
    .replace(/[→⇒⟶➔➙▶►]/g, '->')
    .replace(/[←⇐⟵]/g, '<-')
    // Spaces: non-breaking, em-space, thin-space, etc.
    .replace(/[  -​  　﻿]/g, ' ')
    // Zero-width / invisible chars
    .replace(/[‌‍­�]/g, '')
    // Multiplication sign
    .replace(/[×]/g, 'x')
    // Catch-all: replace remaining non-Latin-1 with nothing (not '?')
    .replace(/[^\x00-\xFF]/g, '');
}

// Lines that consist entirely of decoration characters after sanitization
// (e.g. "-------", "????????", "========") are skipped entirely.
function isGarbageLine(line: string): boolean {
  const t = line.trim();
  return t.length >= 4 && /^[-=_*~+#|?.]{4,}$/.test(t);
}

// ── Text wrapping ─────────────────────────────────────────────────────────────

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Wrap + sanitize + filter garbage — returns only drawable text lines.
function prepLines(text: string, availableW: number, fontSize: number): string[] {
  const charsPerLine = Math.max(20, Math.floor(availableW / (fontSize * 0.56)));
  return wrap(text, charsPerLine)
    .map(l => sanitize(l))
    .filter(l => l.trim() && !isGarbageLine(l));
}

// ── PDF generator ─────────────────────────────────────────────────────────────

export async function generateMeetingPDF(data: MeetingPDFData): Promise<Uint8Array> {
  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  // Page geometry
  const W = 595, H = 842;
  const ML = 44, MR = 44;
  const TW = W - ML - MR;   // usable content width = 507
  const FOOTER_H = 28;

  // Font sizes
  const F_TINY    = 7;
  const F_SMALL   = 8.5;
  const F_BODY    = 9.5;
  const F_SECTION = 8.5;
  const LH        = 14;     // body line-height

  // Colour palette
  const ACCENT     = rgb(0.11, 0.45, 0.82);
  const ACCENT_LT  = rgb(0.55, 0.73, 0.95);
  const WHITE      = rgb(1,    1,    1   );
  const BLACK      = rgb(0.12, 0.12, 0.16);
  const MUTED      = rgb(0.44, 0.44, 0.52);
  const SEP        = rgb(0.87, 0.87, 0.90);
  const HEADER_BG  = rgb(0.07, 0.27, 0.56);

  // Section background colours
  const BG_BLUE    = rgb(0.93, 0.96, 1.00);
  const BG_GREY    = rgb(0.96, 0.96, 0.97);
  const BG_GREY2   = rgb(0.99, 0.99, 1.00);
  const BG_GREEN   = rgb(0.90, 0.97, 0.91);
  const BG_GREEN2  = rgb(0.95, 0.99, 0.96);
  const BG_AMBER   = rgb(1.00, 0.96, 0.87);
  const BG_AMBER2  = rgb(1.00, 0.98, 0.93);
  const BG_PURPLE  = rgb(0.96, 0.93, 1.00);

  const GREEN  = rgb(0.10, 0.50, 0.22);
  const AMBER  = rgb(0.62, 0.36, 0.02);
  const PURPLE = rgb(0.35, 0.18, 0.65);

  // ── Page state ────────────────────────────────────────────────────────────────
  // y = top of the next element to draw; moves downward as content accumulates.

  let page = doc.addPage([W, H]);
  let y = H;

  function newPage() {
    page = doc.addPage([W, H]);
    // Thin accent stripe at the top of continuation pages
    page.drawRectangle({ x: 0, y: H - 4, width: W, height: 4, color: ACCENT });
    y = H - 22;
  }

  function ensureSpace(h: number) {
    if (y - h < FOOTER_H + 16) newPage();
  }

  // fillRect: draws a rectangle. (x, top) = top-left corner; rect extends downward.
  function fillRect(x: number, top: number, w: number, h: number, color: ReturnType<typeof rgb>) {
    page.drawRectangle({ x, y: top - h, width: w, height: h, color });
  }

  // fillRow: full-page-width band (used for header).
  function fillRow(top: number, h: number, color: ReturnType<typeof rgb>) {
    page.drawRectangle({ x: 0, y: top - h, width: W, height: h, color });
  }

  // ── Section header ────────────────────────────────────────────────────────────

  const SECTION_H  = 22;   // band height
  const SECTION_GU = 8;    // gap above band
  const SECTION_GD = 6;    // gap below band

  function sectionHeader(
    label: string,
    bg: ReturnType<typeof rgb>,
    accent: ReturnType<typeof rgb>,
  ) {
    y -= SECTION_GU;
    ensureSpace(SECTION_H + SECTION_GD + 24);
    fillRect(ML, y, TW, SECTION_H, bg);
    fillRect(ML, y, 3, SECTION_H, accent);
    page.drawText(label.toUpperCase(), {
      x: ML + 10,
      y: y - SECTION_H / 2 - F_SECTION / 2 + 1,
      size: F_SECTION, font: bold, color: accent,
    });
    y -= SECTION_H + SECTION_GD;
  }

  // ── Card background helper ────────────────────────────────────────────────────

  function drawCard(
    top: number,
    height: number,
    bg: ReturnType<typeof rgb>,
    accentColor: ReturnType<typeof rgb>,
  ) {
    fillRect(ML, top, TW, height, bg);
    fillRect(ML, top, 3, height, accentColor);
  }

  // ══ HEADER ═══════════════════════════════════════════════════════════════════

  const HEADER_H = 78;
  fillRow(H, HEADER_H, HEADER_BG);
  fillRow(H, 4, ACCENT);           // bright blue accent stripe at very top

  // Sub-label
  page.drawText('MEETING NOTES', {
    x: ML, y: H - 16,
    size: 7.5, font: bold,
    color: rgb(0.55, 0.73, 0.95),
  });

  // Title (up to 2 lines, leaving room for date on the right)
  const titleSanitized = sanitize(data.title);
  const titleMaxW = TW - 148;
  const titleChars = Math.max(20, Math.floor(titleMaxW / (15 * 0.58)));
  const titleLines = wrap(titleSanitized, titleChars).slice(0, 2);
  let headerTY = H - 32;
  for (const line of titleLines) {
    page.drawText(line, { x: ML, y: headerTY, size: 15, font: bold, color: WHITE, maxWidth: titleMaxW });
    headerTY -= 19;
  }

  // Date + client — right side of header
  const RX = W - MR - 132;
  const dateStr = sanitize(data.meetingDate + (data.meetingTime ? '   ' + data.meetingTime : ''));
  page.drawText(dateStr, {
    x: RX, y: H - 30,
    size: F_SMALL, font: regular,
    color: rgb(0.78, 0.89, 1.0), maxWidth: 130,
  });
  if (data.clientName) {
    page.drawText(sanitize(data.clientName), {
      x: RX, y: H - 44,
      size: F_SMALL, font: bold,
      color: rgb(0.88, 0.94, 1.0), maxWidth: 130,
    });
  }

  y = H - HEADER_H - 14;

  // ══ INFO STRIP ════════════════════════════════════════════════════════════════

  const metaRows: Array<[string, string]> = [];
  if (data.location)             metaRows.push(['Location',  data.location]);
  if (data.attendees.length > 0) metaRows.push(['Attendees', data.attendees.join(', ')]);
  if (data.durationSeconds) {
    const m = Math.floor(data.durationSeconds / 60), s = data.durationSeconds % 60;
    metaRows.push(['Duration', `${m}m ${s}s`]);
  }

  if (metaRows.length > 0) {
    const PAD = 8;
    // Pre-calculate height (attendees may wrap)
    let infoH = PAD * 2;
    const renderedRows: Array<[string, string[]]> = metaRows.map(([label, val]) => {
      const vLines = prepLines(val, TW - 90, F_SMALL);
      infoH += vLines.length * (LH + 1);
      return [label, vLines];
    });

    ensureSpace(infoH + 10);
    fillRect(ML, y, TW, infoH, BG_GREY);
    fillRect(ML, y, 3, infoH, ACCENT);

    let iy = y - PAD;
    for (const [label, vLines] of renderedRows) {
      page.drawText(sanitize(label + ':'), {
        x: ML + 10, y: iy,
        size: F_SMALL, font: bold, color: MUTED, maxWidth: 68,
      });
      for (const vl of vLines) {
        page.drawText(vl, { x: ML + 82, y: iy, size: F_SMALL, font: regular, color: BLACK, maxWidth: TW - 86 });
        iy -= LH + 1;
      }
    }
    y -= infoH + 14;
  }

  // ══ SUMMARY ══════════════════════════════════════════════════════════════════

  sectionHeader('Summary', BG_BLUE, ACCENT);

  const sumLines = prepLines(data.summary, TW - 20, F_BODY);
  if (sumLines.length > 0) {
    const PAD = 9;
    const sumH = sumLines.length * LH + PAD * 2;
    ensureSpace(sumH);
    fillRect(ML, y, TW, sumH, BG_BLUE);
    fillRect(ML, y, 2, sumH, ACCENT_LT);   // softer left accent for summary

    let sy = y - PAD;
    for (const line of sumLines) {
      page.drawText(line, { x: ML + 10, y: sy, size: F_BODY, font: regular, color: BLACK, maxWidth: TW - 14 });
      sy -= LH;
    }
    y -= sumH + 8;
  }

  // ══ KEY DISCUSSION POINTS ════════════════════════════════════════════════════

  if (data.keyPoints.length > 0) {
    sectionHeader('Key Discussion Points', BG_BLUE, ACCENT);

    const BADGE_W = 24;
    const INNER_W = TW - BADGE_W - 12;
    const CARD_GAP = 3;

    data.keyPoints.forEach((pt, i) => {
      const lines = prepLines(pt, INNER_W, F_BODY);
      if (lines.length === 0) return;
      const PAD = 7;
      const cardH = lines.length * LH + PAD * 2;
      ensureSpace(cardH + CARD_GAP);

      // Alternating card backgrounds
      fillRect(ML, y, TW, cardH, i % 2 === 0 ? BG_GREY : BG_GREY2);
      // Solid accent badge on the left
      fillRect(ML, y, BADGE_W, cardH, ACCENT);

      // Number centred in badge
      const numStr = String(i + 1);
      page.drawText(numStr, {
        x: ML + BADGE_W / 2 - (numStr.length > 1 ? 5 : 3),
        y: y - cardH / 2 - 3,
        size: F_SMALL, font: bold, color: WHITE,
      });

      let ky = y - PAD;
      for (const line of lines) {
        page.drawText(line, { x: ML + BADGE_W + 8, y: ky, size: F_BODY, font: regular, color: BLACK, maxWidth: INNER_W });
        ky -= LH;
      }
      y -= cardH + CARD_GAP;
    });
    y -= 6;
  }

  // ══ DECISIONS MADE ═══════════════════════════════════════════════════════════

  if (data.decisions.length > 0) {
    sectionHeader('Decisions Made', BG_GREEN, GREEN);

    const CARD_GAP = 3;
    data.decisions.forEach((d, i) => {
      const lines = prepLines(d, TW - 26, F_BODY);
      if (lines.length === 0) return;
      const PAD = 7;
      const cardH = lines.length * LH + PAD * 2;
      ensureSpace(cardH + CARD_GAP);

      drawCard(y, cardH, i % 2 === 0 ? BG_GREEN : BG_GREEN2, GREEN);

      // Arrow bullet
      page.drawText('>', { x: ML + 8, y: y - PAD, size: F_SMALL, font: bold, color: GREEN });

      let dy = y - PAD;
      for (const line of lines) {
        page.drawText(line, { x: ML + 20, y: dy, size: F_BODY, font: regular, color: BLACK, maxWidth: TW - 24 });
        dy -= LH;
      }
      y -= cardH + CARD_GAP;
    });
    y -= 6;
  }

  // ══ ACTION ITEMS ══════════════════════════════════════════════════════════════

  if (data.actionItems.length > 0) {
    sectionHeader('Action Items', BG_AMBER, AMBER);

    const CARD_GAP = 4;
    data.actionItems.forEach((item, i) => {
      const actionLines = prepLines(item.action, TW - 28, F_BODY);
      if (actionLines.length === 0) return;
      const metaStr = sanitize(`Owner: ${item.owner}   |   Deadline: ${item.deadline}`);
      const PAD_T = 7, PAD_B = 8;
      const cardH = actionLines.length * LH + LH + PAD_T + PAD_B;  // action lines + 1 meta line
      ensureSpace(cardH + CARD_GAP);

      drawCard(y, cardH, i % 2 === 0 ? BG_AMBER : BG_AMBER2, AMBER);

      // Number
      page.drawText(`${i + 1}.`, { x: ML + 8, y: y - PAD_T, size: F_SMALL, font: bold, color: AMBER });

      let ay = y - PAD_T;
      for (const line of actionLines) {
        page.drawText(line, { x: ML + 24, y: ay, size: F_BODY, font: bold, color: BLACK, maxWidth: TW - 28 });
        ay -= LH;
      }
      // Owner + deadline meta line
      page.drawText(metaStr, { x: ML + 24, y: ay, size: F_SMALL, font: regular, color: MUTED, maxWidth: TW - 28 });

      y -= cardH + CARD_GAP;
    });
    y -= 6;
  }

  // ══ FORMAL MINUTES ════════════════════════════════════════════════════════════

  if (data.formalMinutes) {
    sectionHeader('Formal Minutes', BG_PURPLE, PURPLE);

    // Process line-by-line to preserve paragraph structure and headings.
    for (const rawLine of data.formalMinutes.split('\n')) {
      const s = sanitize(rawLine);
      const trimmed = s.trim();

      // Blank line → small gap
      if (!trimmed) { y -= LH * 0.4; continue; }

      // Skip decorative separator lines
      if (isGarbageLine(trimmed)) continue;

      // Detect ALL-CAPS heading lines (common in AI-generated minutes)
      const isHeading =
        trimmed.length > 3 &&
        /[A-Z]/.test(trimmed) &&
        trimmed === trimmed.toUpperCase();

      if (isHeading) {
        y -= 3;
        ensureSpace(F_BODY + 8);
        page.drawText(trimmed, { x: ML + 4, y, size: F_BODY, font: bold, color: PURPLE, maxWidth: TW - 8 });
        y -= LH + 2;
      } else {
        const wrappedLines = prepLines(s, TW - 12, F_BODY);
        for (const line of wrappedLines) {
          ensureSpace(F_BODY + 4);
          page.drawText(line, { x: ML + 4, y, size: F_BODY, font: regular, color: BLACK, maxWidth: TW - 8 });
          y -= LH;
        }
      }
    }
    y -= 8;
  }

  // ══ NEXT MEETING ══════════════════════════════════════════════════════════════

  if (data.nextMeeting) {
    sectionHeader('Next Meeting', BG_GREEN, GREEN);

    const lines = prepLines(data.nextMeeting, TW - 14, F_BODY);
    for (const line of lines) {
      ensureSpace(F_BODY + 4);
      page.drawText(line, { x: ML + 8, y, size: F_BODY, font: regular, color: BLACK, maxWidth: TW - 12 });
      y -= LH;
    }
    y -= 8;
  }

  // ══ FOOTER on every page ══════════════════════════════════════════════════════

  const allPages = doc.getPages();
  const pageCount = allPages.length;
  allPages.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: 0, width: W, height: FOOTER_H, color: BG_GREY });
    p.drawLine({ start: { x: 0, y: FOOTER_H }, end: { x: W, y: FOOTER_H }, thickness: 0.5, color: SEP });
    p.drawText(
      `Meeting Notes   |   ${data.meetingDate}   |   Page ${i + 1} of ${pageCount}`,
      { x: ML, y: 8, size: F_TINY, font: regular, color: MUTED },
    );
  });

  return doc.save();
}
