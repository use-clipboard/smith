/**
 * POST /api/meeting-notes/summarise
 * Sends the meeting transcript to Claude and returns structured meeting notes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { getUserContext } from '@/lib/getUserContext';
import { MEETING_NOTES_SYSTEM_PROMPT, buildMeetingNotesPrompt, type MeetingOrigin } from '@/prompts/meeting-notes';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';
import { createClient } from '@/lib/supabase-server';

const BodySchema = z.object({
  meetingTitle:   z.string().min(1),
  meetingDate:    z.string(),
  meetingTime:    z.string().optional(),
  location:       z.string().optional(),
  attendees:      z.array(z.string()).default([]),
  clientName:     z.string().optional(),
  duration:       z.string().optional(),
  transcript:     z.string(),
  meetingOrigin:  z.enum(['recorded', 'virtual', 'in_person', 'phone']).optional(),
  entryMode:      z.enum(['record', 'manual']).optional(),
});

export interface MeetingNotesResult {
  summary:      string;
  keyPoints:    string[];
  actionItems:  { action: string; owner: string; deadline: string }[];
  decisions:    string[];
  formalMinutes: string;
  nextMeeting:  string;
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

  const d = parsed.data;
  const userContent = buildMeetingNotesPrompt({
    meetingTitle:  d.meetingTitle,
    meetingDate:   d.meetingDate,
    meetingTime:   d.meetingTime,
    location:      d.location,
    attendees:     d.attendees,
    clientName:    d.clientName,
    duration:      d.duration,
    transcript:    d.transcript,
    meetingOrigin: d.meetingOrigin as MeetingOrigin | undefined,
    entryMode:     d.entryMode,
  });

  let anthropic: Anthropic;
  try {
    anthropic = await getAnthropicForFirm(ctx.firmId);
  } catch {
    return NextResponse.json({ error: 'AI service not configured. Please add your API key in Settings.' }, { status: 503 });
  }

  const supabase = createClient();
  const startTime = Date.now();

  try {
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      // 4096 was truncating the JSON mid-`formalMinutes` for longer
      // transcripts — the response would end without a closing brace
      // and JSON.parse would fail. 8192 matches the project's CLAUDE.md
      // guidance for long-form features (working papers, formal minutes).
      max_tokens: 8192,
      system:     MEETING_NOTES_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userContent }],
    });

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI. Please try again.' }, { status: 500 });
    }

    let rawText = textBlock.text.trim();
    // Strip markdown code fences if present
    if (rawText.startsWith('```json')) rawText = rawText.slice(7).trim();
    if (rawText.startsWith('```')) rawText = rawText.slice(3).trim();
    if (rawText.endsWith('```')) rawText = rawText.slice(0, -3).trim();

    let result: MeetingNotesResult;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch?.[0] ?? rawText) as MeetingNotesResult;
    } catch (parseErr) {
      // Log the prefix + suffix of the raw output so persistent parse
      // failures can be diagnosed without storing the whole transcript.
      // The most common failure mode is truncation at max_tokens — the
      // suffix will end mid-string rather than with a closing brace.
      const head = rawText.slice(0, 400);
      const tail = rawText.length > 800 ? `…${rawText.slice(-400)}` : '';
      console.error('[meeting-notes/summarise] JSON parse failed', {
        stopReason:    message.stop_reason,
        outputTokens:  message.usage.output_tokens,
        rawLength:     rawText.length,
        head, tail,
        parseErr:      parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      // Surface a more useful hint to the user when the response was
      // truncated (stop_reason === 'max_tokens') vs malformed for other
      // reasons.
      const truncated = message.stop_reason === 'max_tokens';
      return NextResponse.json({
        error: truncated
          ? 'The meeting transcript was too long — the AI response was cut off. Try summarising a shorter section, or split the meeting into parts.'
          : 'Failed to parse AI response. Please try again.',
      }, { status: 500 });
    }

    // Log AI usage (best-effort)
    try {
      await supabase.from('ai_logs').insert({
        user_id:       ctx.userId,
        feature:       'meeting_notes',
        input_tokens:  message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({ result });

  } catch (err) {
    console.error('[meeting-notes/summarise]', err);
    return NextResponse.json({ error: 'AI summarisation failed. Please try again.' }, { status: 500 });
  }
}
