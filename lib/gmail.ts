import { google } from 'googleapis';

export function getGmailOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL}/auth/email/callback`
  );
}

export function getGmailAuthUrl(state?: string) {
  const client = getGmailOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.settings.basic',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    ...(state ? { state } : {}),
  });
}

export async function getRefreshedGmailClient(refreshToken: string): Promise<{
  gmail: ReturnType<typeof google.gmail>;
  accessToken: string;
}> {
  const client = getGmailOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) throw new Error('Gmail token refresh failed');
  return {
    gmail: google.gmail({ version: 'v1', auth: client }),
    accessToken: credentials.access_token,
  };
}

export interface EmailAddress {
  name: string;
  email: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string;
  body: string;         // HTML body, or text fallback
  isRead: boolean;
  /** RFC 2822 Message-ID header (`<...>`), '' when not loaded (metadata fetches). */
  messageId: string;
  /** Message-IDs this message replies to / descends from (In-Reply-To + References).
   *  Used to reconstruct the true reply chain — Gmail's visual threading can merge
   *  unrelated same-subject emails, but these headers reflect actual replies. */
  references: string[];
  attachments: { filename: string; mimeType: string; size: number; attachmentId: string; messageId: string }[];
  /** True when mimeType indicates attachments even if parts weren't loaded (metadata format) */
  hasAttachments: boolean;
}

export interface EmailThread {
  id: string;
  /** The actual Gmail thread ID — differs from id only in non-threaded view (where id is the message ID). */
  gmailThreadId?: string;
  subject: string;
  snippet: string;
  from: EmailAddress;
  date: string;
  messageCount: number;
  isRead: boolean;
  labelIds: string[];
  messages: EmailMessage[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesUnread?: number;
  messagesTotal?: number;
}

function parseAddress(raw: string): EmailAddress {
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
  return { name: '', email: raw.trim() };
}

function parseAddressList(raw: string): EmailAddress[] {
  if (!raw) return [];
  // Split on comma but not commas inside quotes
  const parts = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  return parts.map(p => parseAddress(p.trim())).filter(a => a.email);
}

function getHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function decodeBody(part: {
  mimeType?: string | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: unknown[] | null;
}): string {
  if (part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf-8');
  }
  if (part.parts && Array.isArray(part.parts)) {
    // Prefer HTML part
    const htmlPart = (part.parts as typeof part[]).find(p => p.mimeType === 'text/html');
    if (htmlPart) return decodeBody(htmlPart);
    const textPart = (part.parts as typeof part[]).find(p => p.mimeType === 'text/plain');
    if (textPart) return decodeBody(textPart);
    // Try multipart/alternative children
    for (const child of part.parts as typeof part[]) {
      const result = decodeBody(child);
      if (result) return result;
    }
  }
  return '';
}

type GmailMessagePayload = {
  headers?: { name: string; value: string }[];
  mimeType?: string | null;
  body?: { data?: string | null; size?: number | null; attachmentId?: string | null } | null;
  parts?: GmailMessagePayload[] | null;
  filename?: string | null;
};

function extractAttachments(
  payload: GmailMessagePayload,
  messageId: string
): { filename: string; mimeType: string; size: number; attachmentId: string; messageId: string }[] {
  const attachments: { filename: string; mimeType: string; size: number; attachmentId: string; messageId: string }[] = [];
  function walk(p: GmailMessagePayload) {
    // Use filename presence as the attachment indicator — body.size is absent in metadata format
    if (p.filename && p.filename.trim().length > 0) {
      attachments.push({
        filename: p.filename,
        mimeType: p.mimeType ?? 'application/octet-stream',
        size: p.body?.size ?? 0,
        attachmentId: p.body?.attachmentId ?? '',
        messageId,
      });
    }
    if (p.parts) p.parts.forEach(walk);
  }
  walk(payload);
  return attachments;
}

export function parseGmailMessage(
  msg: { id?: string | null; threadId?: string | null; labelIds?: string[] | null; snippet?: string | null; payload?: GmailMessagePayload | null; internalDate?: string | null }
): EmailMessage {
  const headers = msg.payload?.headers ?? [];
  const subject = getHeader(headers, 'subject') || '(no subject)';
  const fromRaw = getHeader(headers, 'from');
  const toRaw = getHeader(headers, 'to');
  const ccRaw = getHeader(headers, 'cc');
  const dateRaw = getHeader(headers, 'date');

  const messageId = (getHeader(headers, 'message-id').match(/<[^>]+>/)?.[0]) ?? '';
  const references = `${getHeader(headers, 'in-reply-to')} ${getHeader(headers, 'references')}`
    .match(/<[^>]+>/g) ?? [];

  const body = msg.payload ? decodeBody(msg.payload as Parameters<typeof decodeBody>[0]) : '';
  const attachments = msg.payload ? extractAttachments(msg.payload, msg.id ?? '') : [];
  const labelIds = msg.labelIds ?? [];
  // multipart/mixed reliably indicates attachments; used as fallback when parts aren't loaded (metadata format)
  const mimeType = msg.payload?.mimeType ?? '';
  const hasAttachments = attachments.length > 0 || mimeType === 'multipart/mixed';

  return {
    id: msg.id ?? '',
    threadId: msg.threadId ?? '',
    labelIds,
    snippet: msg.snippet ?? '',
    subject,
    from: parseAddress(fromRaw),
    to: parseAddressList(toRaw),
    cc: parseAddressList(ccRaw),
    date: dateRaw || (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : ''),
    body,
    isRead: !labelIds.includes('UNREAD'),
    messageId,
    references: Array.from(new Set(references.map(r => r.trim()))),
    attachments,
    hasAttachments,
  };
}

/**
 * RFC 2047 "encoded-word" for non-ASCII header values. RFC 2822 headers are
 * 7-bit ASCII; raw 8-bit characters get reinterpreted as Latin-1 by many
 * mail servers, which is how subjects like `Re: foo '25-'26` (smart quotes)
 * morph into mojibake (`ÃƒÂ¢Ã¢â€š¬Ã¢â€žÂ¢`) and keep growing on every reply.
 *
 * We base64-encode the entire value if it contains any non-ASCII byte —
 * pure ASCII subjects pass through untouched so the simple case is normal
 * to read on the wire.
 */
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  const hasNonAscii = /[^\x00-\x7F]/.test(value);
  if (!hasNonAscii) return value;
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Encode any non-ASCII display name in an address line. Accepts entries
 * in either `local@host` or `"Display Name" <local@host>` / `Name <addr>`
 * form; only the display-name portion needs encoding — the addr-spec must
 * stay 7-bit ASCII per RFC 5321.
 */
function encodeAddressLine(addr: string): string {
  // Match an optional display name followed by an angle-addr.
  const m = addr.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (!m) return addr; // bare address — already ASCII-safe
  const rawName = m[1].trim().replace(/^"|"$/g, '');
  const email   = m[2].trim();
  return `${encodeHeaderValue(rawName)} <${email}>`;
}

/** Build a raw RFC 2822 email message as base64url, with optional MIME attachments */
export function buildRawMessage(opts: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  replyToMessageId?: string;
  threadId?: string;
  attachments?: Array<{ filename: string; mimeType: string; data: Buffer }>;
}): string {
  const fromLine = encodeAddressLine(opts.from);
  // Omit the To header entirely when there are no recipients (e.g. a draft
  // saved before a recipient is chosen) — an empty `To:` header is invalid.
  const toLine   = opts.to.length   ? `To: ${opts.to.map(encodeAddressLine).join(', ')}\r\n`   : '';
  const ccLine   = opts.cc?.length  ? `Cc: ${opts.cc.map(encodeAddressLine).join(', ')}\r\n`   : '';
  const bccLine  = opts.bcc?.length ? `Bcc: ${opts.bcc.map(encodeAddressLine).join(', ')}\r\n` : '';
  const subjectEncoded = encodeHeaderValue(opts.subject);
  const refLine = opts.replyToMessageId
    ? `In-Reply-To: ${opts.replyToMessageId}\r\nReferences: ${opts.replyToMessageId}\r\n`
    : '';

  function fold76(b64: string): string {
    return b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
  }

  if (!opts.attachments?.length) {
    const raw =
      `From: ${fromLine}\r\n` +
      toLine +
      ccLine +
      bccLine +
      `Subject: ${subjectEncoded}\r\n` +
      refLine +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/html; charset=UTF-8\r\n` +
      `\r\n` +
      opts.htmlBody;
    return Buffer.from(raw).toString('base64url');
  }

  // Multipart/mixed for attachments
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  let parts =
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    fold76(Buffer.from(opts.htmlBody).toString('base64')) +
    `\r\n\r\n`;

  for (const att of opts.attachments) {
    const safe = att.filename.replace(/"/g, '\\"');
    parts +=
      `--${boundary}\r\n` +
      `Content-Type: ${att.mimeType}; name="${safe}"\r\n` +
      `Content-Disposition: attachment; filename="${safe}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      fold76(att.data.toString('base64')) +
      `\r\n\r\n`;
  }

  parts += `--${boundary}--`;

  const raw =
    `From: ${fromLine}\r\n` +
    `To: ${toLine}\r\n` +
    ccLine +
    bccLine +
    `Subject: ${subjectEncoded}\r\n` +
    refLine +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    parts;

  return Buffer.from(raw).toString('base64url');
}
