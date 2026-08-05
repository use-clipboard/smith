import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { logAudit } from '@/lib/audit/log';

const ActionItemSchema = z.object({ action: z.string(), owner: z.string(), deadline: z.string() });

const SaveSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  meetingTitle: z.string().optional().default(''),
  meetingDate: z.string().optional().default(''),
  meetingTime: z.string().optional().default(''),
  durationSeconds: z.number().nullable().optional(),
  location: z.string().optional().default(''),
  meetingOrigin: z.string().optional().default(''),
  attendees: z.array(z.string()).default([]),
  // Notes content
  summary: z.string().optional().default(''),
  keyPoints: z.array(z.string()).default([]),
  actionItems: z.array(ActionItemSchema).default([]),
  decisions: z.array(z.string()).default([]),
  formalMinutes: z.string().optional().default(''),
  nextMeeting: z.string().optional().default(''),
  // Optional original transcript
  transcript: z.string().optional().default(''),
});

// POST /api/outputs/meeting-notes — save a Meeting Notes run to history.
// Stores all inputs (so re-open hydrates the review screen) plus the full notes
// (so re-download can regenerate the PDF from saved data).
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof SaveSchema>;
  try {
    body = SaveSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 });
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from('outputs')
    .insert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      client_id: body.clientId ?? null,
      client_name: body.clientName ?? null,
      feature: 'meeting_notes',
      // Use target_software to surface meeting type/origin (recorded/virtual/in_person/phone)
      // on list rows without parsing JSONB. Sortable + filterable for free.
      target_software: body.meetingOrigin || null,
      // # action items as a useful column-friendly counter
      transaction_count: body.actionItems.length,
      source_filenames: [],
      result_data: {
        // Inputs (so re-open hydrates the form & review)
        meetingTitle: body.meetingTitle,
        meetingDate: body.meetingDate,
        meetingTime: body.meetingTime,
        durationSeconds: body.durationSeconds ?? null,
        location: body.location,
        meetingOrigin: body.meetingOrigin,
        attendees: body.attendees,
        transcript: body.transcript,
        // Notes content (so PDF regenerates and the review screen rehydrates)
        summary: body.summary,
        keyPoints: body.keyPoints,
        actionItems: body.actionItems,
        decisions: body.decisions,
        formalMinutes: body.formalMinutes,
        nextMeeting: body.nextMeeting,
        // Surface the meeting date under the standard key so the existing list
        // endpoint exposes it as period_from. Since meetings are point-in-time,
        // dateFrom == dateTo == the meeting date.
        dateFrom: body.meetingDate || '',
        dateTo: body.meetingDate || '',
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/meeting-notes]', error);
    return NextResponse.json({ error: 'Failed to save meeting notes' }, { status: 500 });
  }

  await logAudit({
    firmId: ctx.firmId,
    tool: 'meeting_notes',
    action: 'created',
    entityId: data.id,
    entityLabel: body.clientName ?? body.meetingTitle ?? null,
    clientId: body.clientId ?? null,
    actorId: ctx.userId,
    summary: 'Created meeting notes',
  });

  return NextResponse.json({ id: data.id });
}
