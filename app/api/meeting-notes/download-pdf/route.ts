/**
 * POST /api/meeting-notes/download-pdf
 * Generates a meeting notes PDF and returns it as a binary download.
 * No database writes — purely a document generation endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { generateMeetingPDF, MeetingPDFSchema } from '@/lib/meetingPDF';

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = MeetingPDFSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  try {
    const pdfBytes = await generateMeetingPDF(parsed.data);
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
