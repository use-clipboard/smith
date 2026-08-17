import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';
import { createClient } from '@/lib/supabase-server';

const Schema = z.object({
  subject:      z.string(),
  body:         z.string(),
  fromEmail:    z.string().optional().default(''),
  fromName:     z.string().optional().default(''),
  /** ISO date the email was received — helps Claude resolve "Thursday" etc. */
  receivedDate: z.string().optional().default(''),
});

interface MeetingSuggestion {
  title: string;
  date: string | null;       // YYYY-MM-DD, or null if none implied
  startTime: string | null;  // "HH:mm" 24h, or null
  endTime: string | null;    // "HH:mm" 24h, or null
  allDay: boolean;
  location: string;
  description: string;
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { subject, body, fromEmail, fromName, receivedDate } = parsed.data;

  // ── Look up client by sender email (so the meeting can be attributed) ────────
  const supabase = await createClient();
  let clientId: string | null = null;
  let clientName: string | null = null;

  if (fromEmail) {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, name')
      .eq('firm_id', ctx.firmId)
      .ilike('contact_email', fromEmail.trim())
      .maybeSingle();

    if (clientRow) {
      clientId   = clientRow.id as string;
      clientName = clientRow.name as string;
    }
  }

  // The sender is the suggested guest — a received email's "from" is the other party.
  const guestEmail = fromEmail.trim();
  const guestName  = fromName.trim() || guestEmail;

  // ── Ask Claude to extract the meeting details ───────────────────────────────
  const anthropic = await getAnthropicForFirm(ctx.firmId);

  const today = new Date().toISOString().split('T')[0];
  const received = receivedDate ? new Date(receivedDate).toISOString().split('T')[0] : today;

  const systemPrompt = `You are an assistant for a UK accountancy firm turning an email into a calendar meeting.
From the email, extract or infer sensible meeting details:
1. A concise meeting title (≤ 8 words). Include the client/company name if obvious.
2. A meeting date if one is proposed or implied (YYYY-MM-DD). Resolve relative dates ("Thursday", "next week", "tomorrow") against the email's received date. Return null if no date is implied.
3. A start time in 24h "HH:mm" if a specific time is proposed, else null.
4. An end time in 24h "HH:mm". If only a start time is given, assume a 30-minute meeting. Return null if no start time.
5. allDay: true only if the email implies a full-day/all-day event with no specific time.
6. A short location if stated (office, "Zoom", "Teams", a phone note, an address), else "".
7. A one or two line agenda/notes summarising the meeting's purpose (≤ 40 words).

The email was received on ${received}. Today is ${today}.
Do NOT invent a specific time or date that isn't supported by the email — prefer null.
Return ONLY valid JSON — no markdown, no explanation — matching exactly:
{"title":"...","date":"YYYY-MM-DD or null","startTime":"HH:mm or null","endTime":"HH:mm or null","allDay":false,"location":"...","description":"..."}`;

  const userPrompt = `Email subject: ${subject}
${fromName ? `From: ${fromName} <${fromEmail}>` : fromEmail ? `From: ${fromEmail}` : ''}

Email body:
${body.slice(0, 3500)}`;

  const fallback = (): MeetingSuggestion => ({
    title: subject || 'Meeting',
    date: null, startTime: null, endTime: null, allDay: false,
    location: '', description: '',
  });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '{}';

    let suggestion = fallback();
    try {
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const p = JSON.parse(clean) as Partial<MeetingSuggestion>;
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      suggestion = {
        title:       typeof p.title === 'string' && p.title.trim() ? p.title.trim() : (subject || 'Meeting'),
        date:        typeof p.date === 'string' && dateRe.test(p.date) ? p.date : null,
        startTime:   typeof p.startTime === 'string' && timeRe.test(p.startTime) ? p.startTime : null,
        endTime:     typeof p.endTime === 'string' && timeRe.test(p.endTime) ? p.endTime : null,
        allDay:      p.allDay === true,
        location:    typeof p.location === 'string' ? p.location.trim() : '',
        description: typeof p.description === 'string' ? p.description.trim() : '',
      };
    } catch {
      // keep fallback
    }

    return NextResponse.json({ ...suggestion, guestEmail, guestName, clientId, clientName });
  } catch (err) {
    console.error('Meeting suggestion error:', err);
    return NextResponse.json({ ...fallback(), guestEmail, guestName, clientId, clientName });
  }
}
