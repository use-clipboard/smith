// Server-side — authenticated HMRC API calls with auto token-refresh.

import { createServiceClient } from '@/lib/supabase-server';
import { HMRC_BASE_URL } from './config';
import { refreshTokens, expiryFromNow } from './client';

export interface HmrcConnection {
  id: string;
  firm_id: string;
  kind: 'agent' | 'business';
  book_id: string | null;
  vrn: string | null;
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
}

type Service = ReturnType<typeof createServiceClient>;

/** Resolve the connection to use for a book: its own business connection if
 *  present, otherwise the firm's agent connection. Null if neither exists. */
export async function getConnectionForBook(service: Service, firmId: string, bookId: string): Promise<HmrcConnection | null> {
  const { data } = await service.from('hmrc_connections').select('*').eq('firm_id', firmId);
  const rows = (data ?? []) as HmrcConnection[];
  return rows.find(c => c.kind === 'business' && c.book_id === bookId)
    ?? rows.find(c => c.kind === 'agent')
    ?? null;
}

async function persistTokens(service: Service, connId: string, t: { access_token: string; refresh_token: string; expires_in: number }) {
  await service.from('hmrc_connections').update({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    token_expiry: expiryFromNow(t.expires_in),
    status: 'connected',
    updated_at: new Date().toISOString(),
  }).eq('id', connId);
}

export interface HmrcResult { status: number; json: unknown; }

/** Call an HMRC endpoint with the connection's token, refreshing if needed. */
export async function hmrcRequest(
  conn: HmrcConnection,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; fraudHeaders?: Record<string, string>; testScenario?: string } = {},
): Promise<HmrcResult> {
  const service = createServiceClient();
  const { method = 'GET', body, fraudHeaders = {}, testScenario } = opts;

  // Proactively refresh if the access token is expired/near-expiry.
  let token = conn.access_token;
  const expMs = conn.token_expiry ? Date.parse(conn.token_expiry) : 0;
  if (!expMs || expMs <= Date.now() + 30_000) {
    const t = await refreshTokens(conn.refresh_token);
    await persistTokens(service, conn.id, t);
    token = t.access_token;
    conn.refresh_token = t.refresh_token;
  }

  const doFetch = (tok: string) => fetch(`${HMRC_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: 'application/vnd.hmrc.1.0+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(testScenario ? { 'Gov-Test-Scenario': testScenario } : {}),
      ...fraudHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let res = await doFetch(token);
  if (res.status === 401) {
    // Token rejected — refresh once and retry.
    const t = await refreshTokens(conn.refresh_token);
    await persistTokens(service, conn.id, t);
    res = await doFetch(t.access_token);
  }

  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json };
}
