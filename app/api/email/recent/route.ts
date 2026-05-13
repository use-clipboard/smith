import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

interface RecentEmail {
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  internalDate: number;
  isUnread: boolean;
}

function parseFrom(raw: string): { name: string; email: string } {
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim() || match[2], email: match[2] };
  return { name: raw.trim(), email: raw.trim() };
}

function getHeader(headers: Array<{ name?: string | null; value?: string | null }> = [], name: string): string {
  const h = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ emails: [] });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ emails: [] });
  }

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) return NextResponse.json({ emails: [] });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const list = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX', 'UNREAD'],
      maxResults: 10,
    });
    const ids = (list.data.messages ?? []).map(m => m.id).filter((x): x is string => !!x);
    if (ids.length === 0) return NextResponse.json({ emails: [] });

    const results = await Promise.allSettled(
      ids.map(id => gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject'],
      }))
    );

    const emails: RecentEmail[] = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof gmail.users.messages.get>>> => r.status === 'fulfilled')
      .map(r => {
        const m = r.value.data;
        const fromRaw = getHeader(m.payload?.headers ?? [], 'From');
        const subject = getHeader(m.payload?.headers ?? [], 'Subject') || '(no subject)';
        const from = parseFrom(fromRaw);
        return {
          id: m.id ?? '',
          threadId: m.threadId ?? '',
          fromName: from.name,
          fromEmail: from.email,
          subject,
          snippet: m.snippet ?? '',
          internalDate: Number(m.internalDate ?? 0),
          isUnread: (m.labelIds ?? []).includes('UNREAD'),
        };
      })
      .sort((a, b) => b.internalDate - a.internalDate);

    return NextResponse.json({ emails });
  } catch (err) {
    console.error('GET /api/email/recent', err);
    return NextResponse.json({ emails: [] });
  }
}
