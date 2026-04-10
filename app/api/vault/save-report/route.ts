import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';
import { getDriveCredentials } from '@/lib/vaultHelpers';
import { getDriveClient } from '@/lib/googleDrive';

const AnswerSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  answer: z.string(),
  userComment: z.string(),
});

const BodySchema = z.object({
  client_id: z.string().uuid().nullable().optional(),
  client_name: z.string(),
  client_code: z.string().nullable().optional(),
  prepared_by: z.string(),
  report: z.object({
    overallRiskLevel: z.enum(['Low', 'Medium', 'High']),
    riskJustification: z.string(),
    suggestedControls: z.string(),
    trainingSuggestions: z.string(),
    summaryOfAnswers: z.array(AnswerSchema).optional(),
  }),
});

// Word-wrap text to fit within maxWidth characters per line
function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).trim().length <= maxChars) {
        line = (line + ' ' + word).trim();
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (paragraph === '') lines.push('');
  }
  return lines;
}

async function generateRiskAssessmentPDF(
  clientName: string,
  clientCode: string | null | undefined,
  preparedBy: string,
  report: {
    overallRiskLevel: string;
    riskJustification: string;
    suggestedControls: string;
    trainingSuggestions: string;
    summaryOfAnswers?: { question: string; answer: string; userComment: string }[];
  }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 50;
  const TEXT_W = PAGE_W - MARGIN * 2;
  const FONT_BODY = 10;
  const FONT_HEADING = 13;
  const FONT_TITLE = 18;
  const LINE_H = 16;

  const riskColour = {
    High: rgb(0.86, 0.15, 0.15),
    Medium: rgb(0.85, 0.47, 0.02),
    Low: rgb(0.09, 0.63, 0.24),
  }[report.overallRiskLevel as 'High' | 'Medium' | 'Low'] ?? rgb(0.3, 0.3, 0.3);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) newPage();
  };

  const drawText = (text: string, x: number, size: number, font = fontRegular, colour = rgb(0.1, 0.1, 0.1)) => {
    page.drawText(text, { x, y, size, font, color: colour });
    y -= LINE_H;
  };

  const drawSection = (title: string, body: string) => {
    ensureSpace(40);
    y -= 6;
    // Section heading underline
    page.drawRectangle({ x: MARGIN, y: y - 2, width: TEXT_W, height: 1, color: rgb(0.85, 0.85, 0.85) });
    drawText(title, MARGIN, FONT_HEADING, fontBold, rgb(0.12, 0.12, 0.4));
    y -= 4;
    const lines = wrapText(body, 90);
    for (const line of lines) {
      ensureSpace(LINE_H + 4);
      drawText(line, MARGIN, FONT_BODY);
    }
  };

  // ── Header ──────────────────────────────────────────────
  drawText('AML CLIENT RISK ASSESSMENT', MARGIN, FONT_TITLE, fontBold, rgb(0.12, 0.12, 0.4));
  y -= 4;
  drawText(`Client: ${clientName}${clientCode ? `  (${clientCode})` : ''}`, MARGIN, FONT_BODY, fontBold);
  drawText(`Prepared by: ${preparedBy}`, MARGIN, FONT_BODY);
  drawText(`Date: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, MARGIN, FONT_BODY);
  y -= 12;

  // ── Risk badge ───────────────────────────────────────────
  const BADGE_H = 54;
  const BADGE_W = TEXT_W;
  ensureSpace(BADGE_H + 20);
  page.drawRectangle({ x: MARGIN, y: y - BADGE_H, width: BADGE_W, height: BADGE_H, borderColor: riskColour, borderWidth: 2, color: rgb(1, 1, 1) });
  page.drawText('OVERALL RISK LEVEL', { x: MARGIN + 12, y: y - 18, size: 8, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(report.overallRiskLevel, { x: MARGIN + 12, y: y - 44, size: 28, font: fontBold, color: riskColour });
  y -= BADGE_H + 16;

  // ── Sections ─────────────────────────────────────────────
  drawSection('Risk Justification', report.riskJustification);
  drawSection('Suggested Controls', report.suggestedControls);
  drawSection('Training Suggestions', report.trainingSuggestions);

  // ── Q&A Summary ──────────────────────────────────────────
  if (report.summaryOfAnswers?.length) {
    ensureSpace(40);
    y -= 6;
    page.drawRectangle({ x: MARGIN, y: y - 2, width: TEXT_W, height: 1, color: rgb(0.85, 0.85, 0.85) });
    drawText('Question Summary', MARGIN, FONT_HEADING, fontBold, rgb(0.12, 0.12, 0.4));
    y -= 4;

    for (const qa of report.summaryOfAnswers) {
      ensureSpace(LINE_H * 3 + 8);
      const qLines = wrapText(qa.question, 85);
      for (const l of qLines) drawText(l, MARGIN, FONT_BODY);
      const answerColour = qa.answer === 'Yes' ? rgb(0.7, 0.1, 0.1) : rgb(0.05, 0.5, 0.15);
      drawText(`Answer: ${qa.answer}${qa.userComment ? `  —  ${qa.userComment}` : ''}`, MARGIN + 10, FONT_BODY, fontRegular, answerColour);
      y -= 4;
    }
  }

  // ── Footer on every page ────────────────────────────────
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Confidential  ·  Page ${i + 1} of ${pages.length}  ·  Generated by Agent Smith`, {
      x: MARGIN, y: 28, size: 8, font: fontRegular, color: rgb(0.6, 0.6, 0.6),
    });
  });

  return doc.save();
}

async function findOrCreateFolder(
  drive: Awaited<ReturnType<typeof getDriveClient>>,
  name: string,
  parentId?: string | null
): Promise<string> {
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentId ? ` and '${parentId}' in parents` : ''}`;
  const existing = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
  if (existing.data.files?.[0]?.id) return existing.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) },
    fields: 'id',
  });
  return created.data.id!;
}

export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });

    const { client_id, client_name, client_code, prepared_by, report } = parsed.data;
    const today = new Date().toISOString().split('T')[0];
    const fileName = `Risk Assessment — ${client_name}${client_code ? ` (${client_code})` : ''} — ${today}.pdf`;

    // Generate PDF
    const pdfBytes = await generateRiskAssessmentPDF(client_name, client_code, prepared_by, report);

    // Try Drive upload
    let driveFileId: string | null = null;
    let driveUrl: string | null = null;

    const creds = await getDriveCredentials(userCtx.firmId);
    if (creds) {
      try {
        const drive = await getDriveClient(creds.accessToken, creds.refreshToken);
        const vaultFolderId = await findOrCreateFolder(drive, 'Agent Smith Vault', creds.rootFolderId);
        const riskFolderId = await findOrCreateFolder(drive, 'Risk Assessments', vaultFolderId);

        const { Readable } = await import('stream');
        const stream = Readable.from(Buffer.from(pdfBytes));

        const uploaded = await drive.files.create({
          requestBody: {
            name: fileName,
            mimeType: 'application/pdf',
            parents: [riskFolderId],
          },
          media: { mimeType: 'application/pdf', body: stream },
          fields: 'id,webViewLink',
        });

        driveFileId = uploaded.data.id ?? null;
        driveUrl = uploaded.data.webViewLink ?? null;
      } catch (err) {
        console.error('[save-report] Drive upload failed:', err);
        // Continue — still save to vault without Drive link
      }
    }

    // Save vault_documents row
    const db = createServiceClient();
    const { data, error } = await db
      .from('vault_documents')
      .insert({
        firm_id: userCtx.firmId,
        user_id: userCtx.userId,
        client_id: client_id ?? null,
        file_name: fileName,
        file_mime_type: 'application/pdf',
        file_size_bytes: pdfBytes.byteLength,
        google_drive_file_id: driveFileId,
        google_drive_url: driveUrl,
        tag_document_type: 'risk_assessment',
        tag_document_date: today,
        tag_client_name: client_name,
        tag_client_code: client_code ?? null,
        tag_summary: `AML Risk Assessment — Overall Risk: ${report.overallRiskLevel}. ${report.riskJustification?.slice(0, 200) ?? ''}`,
        tagging_status: 'tagged',
        source: 'agent_smith_tool',
        source_tool: 'risk_assessment',
        indexed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[/api/vault/save-report]', error);
      return NextResponse.json({ error: 'Failed to save to vault.' }, { status: 500 });
    }

    return NextResponse.json({ ...data, drive_uploaded: !!driveFileId });
  } catch (err) {
    console.error('[/api/vault/save-report]', err);
    return NextResponse.json({ error: 'Failed to save to vault.' }, { status: 500 });
  }
}
