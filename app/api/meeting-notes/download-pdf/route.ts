/**
 * POST /api/meeting-notes/download-pdf
 * Generates a meeting notes PDF and returns it as a binary download.
 * No database writes — purely a document generation endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getUserContext } from '@/lib/getUserContext';

const ActionItemSchema = z.object({
  action:   z.string(),
  owner:    z.string(),
  deadline: z.string(),
});

const BodySchema = z.object({
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

// pdf-lib's built-in Helvetica uses WinAnsiEncoding (Windows-1252).
// Any character outside that set throws at draw time, so we normalise
// common Unicode punctuation to safe ASCII/Latin-1 equivalents first.
function sanitize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")   // curly single quotes
    .replace(/[“”„‟]/g, '"')   // curly double quotes
    .replace(/—/g, '--')                       // em dash
    .replace(/–/g, '-')                        // en dash
    .replace(/…/g, '...')                      // ellipsis
    .replace(/•|‣|⁃/g, '-')          // bullet variants
    .replace(/ /g, ' ')                        // non-breaking space
    .replace(/[^\x00-\xFF]/g, '?');                 // anything else outside Latin-1
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (para.trim() === '') { lines.push(''); continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      if ((line ? line + ' ' + word : word).length <= maxChars) {
        line = line ? line + ' ' + word : word;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function generatePDF(data: z.infer<typeof BodySchema>): Promise<Uint8Array> {
  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const W = 595, H = 842, M = 50;
  const TW = W - M * 2;
  const BODY = 10, HEAD = 13, TITLE = 17, LINE = 15;
  const ACCENT = rgb(0.11, 0.45, 0.82);
  const MUTED  = rgb(0.45, 0.45, 0.45);
  const BLACK  = rgb(0.1,  0.1,  0.1);

  let page = doc.addPage([W, H]);
  let y = H - M;

  function ensureSpace(needed: number) {
    if (y - needed < M + 20) { page = doc.addPage([W, H]); y = H - M; }
  }

  function drawText(text: string, opts: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; indent?: number } = {}) {
    const { size = BODY, font = regular, color = BLACK, indent = 0 } = opts;
    ensureSpace(size + 4);
    page.drawText(sanitize(text), { x: M + indent, y, size, font, color, maxWidth: TW - indent });
    y -= LINE;
  }

  function drawSection(title: string) {
    ensureSpace(HEAD + 12);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 10;
    drawText(title.toUpperCase(), { size: HEAD, font: bold, color: ACCENT });
    y -= 4;
  }

  drawText('MEETING NOTES', { size: TITLE, font: bold, color: ACCENT });
  drawText(data.title, { size: HEAD, font: bold });
  y -= 4;
  drawText(`Date: ${data.meetingDate}${data.meetingTime ? '  ·  Time: ' + data.meetingTime : ''}`, { color: MUTED });
  if (data.location)              drawText(`Location: ${data.location}`,            { color: MUTED });
  if (data.clientName)            drawText(`Client: ${data.clientName}`,            { color: MUTED });
  if (data.attendees.length > 0)  drawText(`Attendees: ${data.attendees.join(', ')}`, { color: MUTED });
  if (data.durationSeconds) {
    const m = Math.floor(data.durationSeconds / 60), s = data.durationSeconds % 60;
    drawText(`Duration: ${m}m ${s}s`, { color: MUTED });
  }

  drawSection('Summary');
  for (const line of wrap(data.summary, 90)) drawText(line || ' ');

  if (data.keyPoints.length > 0) {
    drawSection('Key Discussion Points');
    data.keyPoints.forEach((pt, i) => {
      ensureSpace(BODY + 4);
      page.drawText(`${i + 1}.`, { x: M, y, size: BODY, font: regular, color: BLACK });
      for (const line of wrap(pt, 82)) drawText(line || ' ', { indent: 16 });
    });
  }

  if (data.decisions.length > 0) {
    drawSection('Decisions Made');
    data.decisions.forEach(d => {
      ensureSpace(BODY + 4);
      page.drawText('-', { x: M, y, size: BODY, font: regular, color: ACCENT });
      for (const line of wrap(d, 82)) drawText(line || ' ', { indent: 14 });
    });
  }

  if (data.actionItems.length > 0) {
    drawSection('Action Items');
    data.actionItems.forEach((item, i) => {
      const actionLines = wrap(`${i + 1}. ${item.action}`, 82);
      ensureSpace((actionLines.length + 1) * LINE + 10);
      for (const line of actionLines) drawText(line || ' ', { font: bold });
      drawText(`   Owner: ${item.owner}  ·  Deadline: ${item.deadline}`, { color: MUTED });
      y -= 4;
    });
  }

  if (data.formalMinutes) {
    drawSection('Formal Minutes');
    for (const line of wrap(data.formalMinutes, 90)) drawText(line || ' ');
  }

  if (data.nextMeeting) {
    drawSection('Next Meeting');
    drawText(data.nextMeeting);
  }

  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((p, i) => {
    p.drawText(`SMITH Meeting Notes  ·  ${data.meetingDate}  ·  Page ${i + 1} of ${total}`, {
      x: M, y: 25, size: 8, font: regular, color: MUTED,
    });
  });

  return doc.save();
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  try {
    const pdfBytes = await generatePDF(parsed.data);
    const safeName = parsed.data.title.replace(/[^a-zA-Z0-9 ._-]/g, '_');
    const fileName = `Meeting Notes - ${safeName} - ${parsed.data.meetingDate}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error('[meeting-notes/download-pdf] error:', err);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
