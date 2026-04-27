/**
 * POST /api/meeting-notes/save-timeline
 * Saves a structured meeting note to a client's timeline.
 * Does NOT depend on the meeting_notes table — stores everything in
 * client_timeline_notes with a JSONB metadata payload.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

const ActionItemSchema = z.object({
  action:   z.string(),
  owner:    z.string(),
  deadline: z.string(),
});

const BodySchema = z.object({
  clientId:        z.string().uuid(),
  title:           z.string().min(1),
  meetingDate:     z.string(),
  meetingTime:     z.string().optional(),
  location:        z.string().optional(),
  attendees:       z.array(z.string()).default([]),
  meetingOrigin:   z.string().optional(),
  summary:         z.string(),
  keyPoints:       z.array(z.string()).default([]),
  actionItems:     z.array(ActionItemSchema).default([]),
  decisions:       z.array(z.string()).default([]),
  formalMinutes:   z.string().optional(),
  nextMeeting:     z.string().optional(),
});

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
  const svc = createServiceClient();

  // Store structured data as JSON in the content field — no extra columns needed.
  // The NoteCard detects note_type === 'meeting_notes' and parses this JSON for the
  // expandable structured view.
  // __smith_meeting_notes__ marker lets the NoteCard detect this is
  // an AI-generated structured note and render the expandable view.
  const content = JSON.stringify({
    __smith_meeting_notes__: true,
    summary:       d.summary,
    keyPoints:     d.keyPoints,
    actionItems:   d.actionItems,
    decisions:     d.decisions,
    formalMinutes: d.formalMinutes ?? '',
    nextMeeting:   d.nextMeeting ?? '',
    attendees:     d.attendees,
    location:      d.location ?? '',
    meetingTime:   d.meetingTime ?? '',
    meetingOrigin: d.meetingOrigin ?? '',
  });

  const { data: note, error } = await svc
    .from('client_timeline_notes')
    .insert({
      firm_id:   ctx.firmId,
      client_id: d.clientId,
      user_id:   ctx.userId,
      title:     d.title,
      content,
      note_type: 'meeting',
      note_date: d.meetingDate,
      is_pinned: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[meeting-notes/save-timeline] insert error:', error);
    return NextResponse.json({ error: 'Failed to save to timeline' }, { status: 500 });
  }

  return NextResponse.json({ id: note.id, success: true }, { status: 201 });
}
