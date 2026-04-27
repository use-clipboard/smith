/**
 * POST /api/meeting-notes/save
 * Persists meeting notes to Supabase, optionally saves a PDF to Google Drive,
 * and creates a client timeline entry if a client is linked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getUserContext } from '@/lib/getUserContext';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getRefreshedDriveCredentials } from '@/lib/vaultHelpers';
import { uploadFileWithDrive, createFolderWithDrive } from '@/lib/googleDrive';

const ActionItemSchema = z.object({
  action:   z.string(),
  owner:    z.string(),
  deadline: z.string(),
});

const BodySchema = z.object({
  // Meeting metadata
  title:            z.string().min(1),
  meetingDate:      z.string(),
  meetingTime:      z.string().optional(),
  durationSeconds:  z.number().optional(),
  location:         z.string().optional(),
  attendees:        z.array(z.string()).default([]),
  calendarEventId:  z.string().optional(),

  // Client link
  clientId:         z.string().uuid().optional().nullable(),
  clientName:       z.string().optional(),

  // Transcript + AI output
  transcript:       z.string().optional(),
  summary:          z.string(),
  keyPoints:        z.array(z.string()).default([]),
  actionItems:      z.array(ActionItemSchema).default([]),
  decisions:        z.array(z.string()).default([]),
  formalMinutes:    z.string(),
  nextMeeting:      z.string().optional(),

  // How the meeting was held
  meetingOrigin:    z.enum(['recorded', 'virtual', 'in_person', 'phone']).default('recorded'),

  // Screen recording — uploaded directly browser→Drive; we just store the link
  driveVideoUrl:    z.string().url().optional().nullable(),
  driveVideoFileId: z.string().optional().nullable(),

  // Options
  saveToDrive:      z.boolean().default(false),
});

// ── PDF generation ────────────────────────────────────────────────────────────

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

async function generateMeetingNotesPDF(data: z.infer<typeof BodySchema>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const W = 595, H = 842, M = 50;
  const TW = W - M * 2;
  const BODY = 10, HEAD = 13, TITLE = 17, LINE = 15;
  const ACCENT = rgb(0.11, 0.45, 0.82);
  const MUTED  = rgb(0.45, 0.45, 0.45);
  const BLACK  = rgb(0.1, 0.1, 0.1);

  let page = doc.addPage([W, H]);
  let y = H - M;

  function ensureSpace(needed: number) {
    if (y - needed < M + 20) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  }

  function drawText(text: string, { size = BODY, font = regular, color = BLACK, indent = 0 }: {
    size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; indent?: number;
  } = {}) {
    ensureSpace(size + 4);
    page.drawText(text, { x: M + indent, y, size, font, color, maxWidth: TW - indent });
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

  // ── Header ──
  drawText('MEETING NOTES', { size: TITLE, font: bold, color: ACCENT });
  drawText(data.title, { size: HEAD, font: bold });
  y -= 4;
  drawText(`Date: ${data.meetingDate}${data.meetingTime ? '  ·  Time: ' + data.meetingTime : ''}`, { color: MUTED });
  if (data.location) drawText(`Location: ${data.location}`, { color: MUTED });
  if (data.clientName) drawText(`Client: ${data.clientName}`, { color: MUTED });
  if (data.attendees.length > 0) drawText(`Attendees: ${data.attendees.join(', ')}`, { color: MUTED });
  if (data.durationSeconds) {
    const m = Math.floor(data.durationSeconds / 60), s = data.durationSeconds % 60;
    drawText(`Duration: ${m}m ${s}s`, { color: MUTED });
  }

  // ── Summary ──
  drawSection('Summary');
  for (const line of wrap(data.summary, 90)) {
    drawText(line || ' ');
  }

  // ── Key Points ──
  if (data.keyPoints.length > 0) {
    drawSection('Key Discussion Points');
    data.keyPoints.forEach((pt, i) => {
      ensureSpace(BODY + 4);
      page.drawText(`${i + 1}.`, { x: M, y, size: BODY, font: regular, color: BLACK });
      for (const line of wrap(pt, 82)) {
        drawText(line || ' ', { indent: 16 });
      }
    });
  }

  // ── Decisions ──
  if (data.decisions.length > 0) {
    drawSection('Decisions Made');
    data.decisions.forEach(d => {
      ensureSpace(BODY + 4);
      page.drawText('-', { x: M, y, size: BODY, font: regular, color: ACCENT });
      for (const line of wrap(d, 82)) {
        drawText(line || ' ', { indent: 14 });
      }
    });
  }

  // ── Action Items ──
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

  // ── Formal Minutes ──
  if (data.formalMinutes) {
    drawSection('Formal Minutes');
    for (const line of wrap(data.formalMinutes, 90)) {
      drawText(line || ' ');
    }
  }

  // ── Next Meeting ──
  if (data.nextMeeting) {
    drawSection('Next Meeting');
    drawText(data.nextMeeting);
  }

  // ── Footer on each page ──
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((p, i) => {
    p.drawText(`SMITH Meeting Notes  ·  ${data.meetingDate}  ·  Page ${i + 1} of ${total}`, {
      x: M, y: 25, size: 8, font: regular, color: MUTED,
    });
  });

  return doc.save();
}

// ── Route handler ─────────────────────────────────────────────────────────────

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

  const d = parsed.data;
  const supabase    = createClient();
  const svcSupabase = createServiceClient();

  // 1. Insert meeting note into Supabase
  const { data: note, error: insertError } = await svcSupabase
    .from('meeting_notes')
    .insert({
      firm_id:          ctx.firmId,
      user_id:          ctx.userId,
      client_id:        d.clientId ?? null,
      title:            d.title,
      meeting_date:     d.meetingDate,
      meeting_time:     d.meetingTime ?? null,
      duration_seconds: d.durationSeconds ?? null,
      location:         d.location ?? null,
      attendees:        d.attendees,
      meeting_origin:            d.meetingOrigin,
      google_drive_video_url:    d.driveVideoUrl    ?? null,
      google_drive_video_file_id: d.driveVideoFileId ?? null,
      transcript:                d.transcript ?? null,
      summary:          d.summary,
      key_points:       d.keyPoints,
      action_items:     d.actionItems,
      decisions:        d.decisions,
      formal_minutes:   d.formalMinutes,
      next_meeting:     d.nextMeeting ?? null,
      calendar_event_id: d.calendarEventId ?? null,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[meeting-notes/save] insert error:', insertError);
    return NextResponse.json({ error: 'Failed to save meeting notes' }, { status: 500 });
  }

  let driveUrl: string | null = null;
  let driveFileId: string | null = null;

  // 2. Save PDF to Google Drive (if requested and Drive is enabled)
  if (d.saveToDrive) {
    try {
      const creds = await getRefreshedDriveCredentials(ctx.firmId);
      if (creds) {
        const pdfBytes  = await generateMeetingNotesPDF(d);
        const pdfBuffer = Buffer.from(pdfBytes);

        // Determine folder — create "Meeting Notes" subfolder under root if needed
        let folderId = creds.rootFolderId ?? undefined;

        // Try to find or create a "Meeting Notes" folder
        try {
          const { data: folderSearch } = await creds.drive.files.list({
            q: `name='Meeting Notes' and mimeType='application/vnd.google-apps.folder' and trashed=false${folderId ? ` and '${folderId}' in parents` : ''}`,
            fields: 'files(id,name)',
            supportsAllDrives: true,
          });
          if (folderSearch?.files && folderSearch.files.length > 0) {
            folderId = folderSearch.files[0].id ?? folderId;
          } else {
            const newFolder = await createFolderWithDrive(creds.drive, {
              name: 'Meeting Notes',
              parentFolderId: folderId,
            });
            folderId = newFolder.id ?? folderId;
          }
        } catch {
          // Folder handling failed — upload to root folder instead
        }

        const safeName = d.title.replace(/[^a-zA-Z0-9 ._-]/g, '_');
        const fileName = `Meeting Notes - ${safeName} - ${d.meetingDate}.pdf`;

        const uploaded = await uploadFileWithDrive(creds.drive, {
          folderId:  folderId ?? '',
          fileName,
          mimeType:  'application/pdf',
          buffer:    pdfBuffer,
        });

        driveUrl    = uploaded.webViewLink ?? null;
        driveFileId = uploaded.id ?? null;

        // Persist Drive URL back to the record
        await svcSupabase
          .from('meeting_notes')
          .update({ google_drive_url: driveUrl, google_drive_file_id: driveFileId })
          .eq('id', note.id);
      }
    } catch (driveErr) {
      // Drive save failing should not block the rest of the save
      console.warn('[meeting-notes/save] Drive upload failed:', driveErr);
    }
  }

  // 3. Create client timeline note if a client is linked
  if (d.clientId) {
    try {
      const noteContent = [
        `${d.summary}`,
        '',
        d.actionItems.length > 0
          ? `Action Items:\n${d.actionItems.map(a => `• ${a.action} (${a.owner} — ${a.deadline})`).join('\n')}`
          : null,
        driveUrl       ? `\nNotes document: ${driveUrl}` : null,
        d.driveVideoUrl ? `Recording: ${d.driveVideoUrl}` : null,
      ].filter(Boolean).join('\n');

      await supabase
        .from('client_timeline_notes')
        .insert({
          firm_id:    ctx.firmId,
          client_id:  d.clientId,
          user_id:    ctx.userId,
          title:      d.title,
          content:    noteContent,
          note_type:  'meeting',
          note_date:  d.meetingDate,
          is_pinned:  false,
          // Store Drive URL and meeting_note_id in metadata for the timeline link
          meeting_note_id:  note.id,
          google_drive_url: driveUrl ?? null,
        });
    } catch (timelineErr) {
      // Timeline note failing should not block the save
      console.warn('[meeting-notes/save] timeline note failed:', timelineErr);
    }
  }

  return NextResponse.json({
    id:       note.id,
    driveUrl,
    success:  true,
  }, { status: 201 });
}
