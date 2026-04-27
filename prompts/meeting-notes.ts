/**
 * System prompt and schema for the AI Meeting Notes tool.
 * Produces UK accountancy-compliant minutes and summaries.
 */

export const MEETING_NOTES_SYSTEM_PROMPT = `You are SMITH, an AI assistant for a UK accountancy firm. You have been given a raw transcript of a meeting. Your job is to produce professional, structured meeting notes and formal minutes that meet the standard expected in UK accountancy practice.

You must return a single valid JSON object — no markdown, no extra commentary, no code blocks — matching exactly the schema below.

Guidelines:
- Keep the summary concise but complete (3–6 sentences)
- Key points should be distinct, actionable or factual statements
- Action items must include an owner and deadline where mentioned; if not explicit, use "TBC"
- Decisions must be clearly-stated, firm conclusions reached during the meeting
- Formal minutes must be in the style of UK professional practice notes:
  - Written in the third person, past tense
  - Numbered sections where appropriate
  - Attendees listed at the top
  - Any resolutions or decisions formally stated
  - Compliant with professional standards (ICAEW / ACCA guidance)
- If transcript content is minimal or unclear, produce the best output possible from what is available
- Do not invent facts not present in the transcript

JSON schema:
{
  "summary": "string — executive summary of the meeting",
  "keyPoints": ["string", ...],
  "actionItems": [
    { "action": "string", "owner": "string", "deadline": "string" }
  ],
  "decisions": ["string", ...],
  "formalMinutes": "string — full formal minutes in plain text (use \\n for line breaks), UK professional style",
  "nextMeeting": "string — details of any next meeting mentioned, or empty string if none"
}`;

export type MeetingOrigin = 'recorded' | 'virtual' | 'in_person' | 'phone';

const ORIGIN_LABELS: Record<MeetingOrigin, string> = {
  recorded:  'Recorded (microphone)',
  virtual:   'Virtual (video call)',
  in_person: 'In Person',
  phone:     'Phone Call',
};

export const buildMeetingNotesPrompt = (params: {
  meetingTitle:  string;
  meetingDate:   string;
  meetingTime?:  string;
  location?:     string;
  attendees:     string[];
  clientName?:   string;
  duration?:     string;
  transcript:    string;
  meetingOrigin?: MeetingOrigin;
  entryMode?:    'record' | 'manual';
}): string => {
  const parts: string[] = [];

  parts.push('MEETING DETAILS');
  parts.push(`Title: ${params.meetingTitle}`);
  parts.push(`Date: ${params.meetingDate}`);
  if (params.meetingTime) parts.push(`Time: ${params.meetingTime}`);
  if (params.location)    parts.push(`Location: ${params.location}`);
  if (params.clientName)  parts.push(`Client: ${params.clientName}`);
  if (params.duration)    parts.push(`Duration: ${params.duration}`);
  if (params.meetingOrigin) parts.push(`Meeting type: ${ORIGIN_LABELS[params.meetingOrigin]}`);
  if (params.attendees.length > 0) {
    parts.push(`Attendees: ${params.attendees.join(', ')}`);
  }

  parts.push('');

  if (params.entryMode === 'manual') {
    parts.push('MEETING DESCRIPTION (manually entered by staff member)');
    parts.push('Note: The following is a written description of the meeting, not a verbatim transcript. Use it to produce professional minutes and a structured summary.');
  } else {
    parts.push('TRANSCRIPT');
  }

  parts.push(
    params.transcript.trim() ||
    '[No content was provided — produce a skeleton template the user can complete]'
  );

  return parts.join('\n');
};
