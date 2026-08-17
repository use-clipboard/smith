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

// ── Rate-limit resilience ────────────────────────────────────────────────────

/** True when a Google/Gmail API error is a rate-limit (429) or quota error. */
export function isGmailRateLimitError(err: unknown): boolean {
  const e = err as {
    code?: number; status?: number;
    response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } };
    errors?: { reason?: string }[];
    message?: string;
  };
  const status = e?.code ?? e?.status ?? e?.response?.status;
  if (status === 429) return true;
  // Google also signals rate limits as 403 with a rateLimitExceeded reason.
  const reasons = (e?.response?.data?.error?.errors ?? e?.errors ?? [])
    .map(x => String(x?.reason ?? ''));
  if (status === 403 && reasons.some(r => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(r))) return true;
  if (typeof e?.message === 'string' && /rate limit|quota exceeded|too many requests/i.test(e.message)) return true;
  return false;
}

/** True for transient 5xx server errors worth retrying. */
function isTransientServerError(err: unknown): boolean {
  const e = err as { code?: number; status?: number; response?: { status?: number } };
  const status = e?.code ?? e?.status ?? e?.response?.status;
  return typeof status === 'number' && status >= 500 && status < 600;
}

/**
 * Retry a Gmail API call on rate-limit / transient errors with exponential
 * back-off + jitter. Non-retryable errors throw immediately.
 */
export async function gmailRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if ((!isGmailRateLimitError(err) && !isTransientServerError(err)) || i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, baseMs * 2 ** i + Math.random() * 200));
    }
  }
  throw lastErr;
}

/**
 * Run an async mapper over `items` with a bounded concurrency so we don't fire
 * (e.g.) 50 Gmail requests at once — a common trigger for per-user rate limits.
 */
export async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, worker));
  return results;
}

export interface EmailAddress {
  name: string;
  email: string;
}

/**
 * Pull the addr-spec out of a recipient entry in either `email` or
 * `Name <email>` / `"Name" <email>` form. Returns null when the entry isn't a
 * single plausible email address — e.g. it carries embedded newlines / raw
 * header text (the "To:…Subject:…" poisoning that produced malformed sends),
 * has no `@`, or has internal whitespace in the address.
 */
export function extractRecipientEmail(entry: string): string | null {
  if (/[\r\n]/.test(entry)) return null;          // no embedded header breaks
  const trimmed = entry.trim();
  if (!trimmed) return null;
  // `Name <addr>` → take the angle-addr; otherwise treat the whole thing as the address.
  const angle = trimmed.match(/<([^<>]*)>\s*$/);
  const addr  = (angle ? angle[1] : trimmed).trim();
  // Conservative addr-spec: one @, no whitespace, a dotted domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return null;
  return addr;
}

/** First entry in the list that isn't a valid recipient, or null if all are OK. */
export function firstInvalidRecipient(list: string[]): string | null {
  for (const r of list) {
    if (!extractRecipientEmail(r)) return r;
  }
  return null;
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
  /** The single Message-ID this message directly answers (In-Reply-To header),
   *  '' for a top-level message. Use this — NOT `references` — to attribute a
   *  reply/forward to the one message it responds to. */
  inReplyTo: string;
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
  /** You've replied in this conversation (a Sent message exists in the thread) —
   *  reflects replies made from ANY client, not just SMITH. List-view marker. */
  isReplied?: boolean;
  /** You've forwarded from this conversation (a Fwd:/FW: Sent message exists). */
  isForwarded?: boolean;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesUnread?: number;
  messagesTotal?: number;
  /** Conversation count — triage categories are per thread, so the Untriaged
   *  maths must subtract from threads, not messages. */
  threadsTotal?: number;
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

/** Escape HTML-special chars so plain-text content can't be parsed as markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Turn a decoded text/plain body into safe display HTML: escape any angle
 * brackets / ampersands (so `<hassan@x.com>` or a raw MIME `boundary="…"`
 * isn't swallowed as a tag) and convert newlines to <br> so the message keeps
 * its line breaks instead of collapsing into one run-on block when injected
 * via dangerouslySetInnerHTML.
 */
function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
}

type DecodedBody = { content: string; isHtml: boolean };

function decodeBody(part: {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; size?: number | null } | null;
  parts?: unknown[] | null;
}): DecodedBody {
  if (part.body?.data) {
    const content = Buffer.from(part.body.data, 'base64').toString('utf-8');
    return { content, isHtml: part.mimeType === 'text/html' };
  }
  if (part.parts && Array.isArray(part.parts)) {
    const children = part.parts as typeof part[];
    // Prefer HTML, then plain text — but only when the chosen part actually
    // yields content. An empty text/plain alternative (which Gmail emits as a
    // sibling when the real body is HTML nested inside a multipart/related
    // part, e.g. for inline images) must NOT shadow that populated HTML. So we
    // fall through on an empty result rather than committing to the first match.
    const htmlPart = children.find(p => p.mimeType === 'text/html');
    if (htmlPart) {
      const html = decodeBody(htmlPart);
      if (html.content) return html;
    }
    const textPart = children.find(p => p.mimeType === 'text/plain');
    if (textPart) {
      const text = decodeBody(textPart);
      if (text.content) return text;
    }
    // Recurse into remaining containers (multipart/related, /alternative,
    // /mixed, message/rfc822, …) and take the first child that yields content.
    // Skip attachment parts — decoding an inline image / PDF's base64 here
    // would dump binary garbage into the message body.
    for (const child of children) {
      if (child.filename && child.filename.trim()) continue;
      const result = decodeBody(child);
      if (result.content) return result;
    }
  }
  return { content: '', isHtml: false };
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
  // The immediate parent (In-Reply-To), kept SEPARATE from the full ancestor
  // chain. Reply/forward attribution must use this, not `references` — a reply's
  // References header lists every ancestor, so attributing by References marks
  // the whole thread as replied, not just the one message answered.
  const inReplyTo = (getHeader(headers, 'in-reply-to').match(/<[^>]+>/)?.[0]) ?? '';
  const references = `${getHeader(headers, 'in-reply-to')} ${getHeader(headers, 'references')}`
    .match(/<[^>]+>/g) ?? [];

  const decoded = msg.payload
    ? decodeBody(msg.payload as Parameters<typeof decodeBody>[0])
    : { content: '', isHtml: false };
  // HTML bodies are rendered as-is; plain-text bodies are escaped and have
  // their newlines turned into <br> so they don't render as one run-on block.
  const body = decoded.isHtml ? decoded.content : plainTextToHtml(decoded.content);
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
    inReplyTo,
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
/**
 * Strip CR/LF (and other control chars) from a header value. RFC 2822 headers
 * are single logical lines; an embedded newline in a value injects a premature
 * line — or a blank line that prematurely ends the whole header block, dumping
 * the real headers (Subject, etc.) into the body. That's both a malformed-mail
 * bug (lost subject) and a header-injection vector. Always run header values
 * through this before interpolating them into a raw message.
 */
function stripHeaderBreaks(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\t\x00-\x1F]+/g, ' ').trim();
}

function encodeHeaderValue(value: string): string {
  const clean = stripHeaderBreaks(value);
  // eslint-disable-next-line no-control-regex
  const hasNonAscii = /[^\x00-\x7F]/.test(clean);
  if (!hasNonAscii) return clean;
  const b64 = Buffer.from(clean, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Encode any non-ASCII display name in an address line. Accepts entries
 * in either `local@host` or `"Display Name" <local@host>` / `Name <addr>`
 * form; only the display-name portion needs encoding — the addr-spec must
 * stay 7-bit ASCII per RFC 5321.
 */
function encodeAddressLine(addr: string): string {
  // Strip line breaks first — a recipient value carrying embedded CRLF (e.g.
  // pasted raw headers) would otherwise inject extra header lines / a blank
  // line that breaks the whole message.
  const safe = stripHeaderBreaks(addr);
  // Match an optional display name followed by an angle-addr.
  const m = safe.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (!m) return safe; // bare address
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
  /** Optional Reply-To address (replies go here instead of the From address). */
  replyTo?: string;
  attachments?: Array<{ filename: string; mimeType: string; data: Buffer }>;
  /** 'high' adds Outlook/Gmail high-importance headers. */
  importance?: 'high' | 'normal';
}): string {
  const fromLine = encodeAddressLine(opts.from);
  const replyToLine = opts.replyTo ? `Reply-To: ${encodeAddressLine(opts.replyTo)}\r\n` : '';
  // Omit the To header entirely when there are no recipients (e.g. a draft
  // saved before a recipient is chosen) — an empty `To:` header is invalid.
  const toLine   = opts.to.length   ? `To: ${opts.to.map(encodeAddressLine).join(', ')}\r\n`   : '';
  const ccLine   = opts.cc?.length  ? `Cc: ${opts.cc.map(encodeAddressLine).join(', ')}\r\n`   : '';
  const bccLine  = opts.bcc?.length ? `Bcc: ${opts.bcc.map(encodeAddressLine).join(', ')}\r\n` : '';
  const subjectEncoded = encodeHeaderValue(opts.subject);
  const safeRef = opts.replyToMessageId ? stripHeaderBreaks(opts.replyToMessageId) : '';
  const refLine = safeRef
    ? `In-Reply-To: ${safeRef}\r\nReferences: ${safeRef}\r\n`
    : '';
  // High-importance headers understood by Gmail, Outlook, and most clients.
  const priorityLines = opts.importance === 'high'
    ? `Importance: High\r\nX-Priority: 1 (Highest)\r\nPriority: urgent\r\n`
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
      replyToLine +
      `Subject: ${subjectEncoded}\r\n` +
      refLine +
      priorityLines +
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
    toLine +
    ccLine +
    bccLine +
    replyToLine +
    `Subject: ${subjectEncoded}\r\n` +
    refLine +
    priorityLines +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    parts;

  return Buffer.from(raw).toString('base64url');
}
