// Server-side — authenticated HMRC API calls with auto token-refresh.

import { createServiceClient } from '@/lib/supabase-server';
import { HMRC_BASE_URL, type HmrcService } from './config';
import { refreshTokens, expiryFromNow } from './client';

export interface HmrcConnection {
  id: string;
  firm_id: string;
  kind: 'agent' | 'business' | 'individual';
  /** 'vat' | 'mtd_it' — which HMRC service these tokens are scoped for. */
  service: HmrcService;
  book_id: string | null;
  /** For 'individual' MTD-IT connections — the client these tokens file for. */
  client_id: string | null;
  vrn: string | null;
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
}

type Service = ReturnType<typeof createServiceClient>;

/**
 * Resolve the HMRC connection to use for a given service. Prefers the most
 * specific connection (business-by-book or individual-by-client) and falls back
 * to the firm's agent connection. Null if none exists.
 */
export async function getHmrcConnection(
  supa: Service,
  hmrcService: HmrcService,
  firmId: string,
  opts: { bookId?: string; clientId?: string } = {},
): Promise<HmrcConnection | null> {
  const { data } = await supa
    .from('hmrc_connections').select('*')
    .eq('firm_id', firmId).eq('service', hmrcService);
  const rows = (data ?? []) as HmrcConnection[];
  if (opts.bookId) {
    const biz = rows.find(c => c.kind === 'business' && c.book_id === opts.bookId);
    if (biz) return biz;
  }
  if (opts.clientId) {
    const ind = rows.find(c => c.kind === 'individual' && c.client_id === opts.clientId);
    if (ind) return ind;
  }
  return rows.find(c => c.kind === 'agent') ?? null;
}

/** VAT convenience wrapper — business connection for the book, else firm agent. */
export async function getConnectionForBook(service: Service, firmId: string, bookId: string): Promise<HmrcConnection | null> {
  return getHmrcConnection(service, 'vat', firmId, { bookId });
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

/** Best-effort human message from an HMRC error body. */
export function hmrcErrorMessage(json: unknown): string {
  const j = json as { message?: string; errors?: { message?: string }[] } | null;
  if (j?.errors?.length) return j.errors.map(e => e.message).filter(Boolean).join('; ') || 'HMRC rejected the request.';
  return j?.message || 'HMRC rejected the request.';
}

/** Call an HMRC endpoint with the connection's token, refreshing if needed. */
export async function hmrcRequest(
  conn: HmrcConnection,
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT';
    body?: unknown;
    fraudHeaders?: Record<string, string>;
    testScenario?: string;
    /** HMRC pins the API version per-API in the Accept header. VAT = '1.0';
     *  MTD-IT uses 2.0 (Business Details), 3.0 (Obligations), 5.0 (Self-
     *  Employment), 6.0 (Property). Defaults to '1.0' for back-compat. */
    version?: string;
  } = {},
): Promise<HmrcResult> {
  const service = createServiceClient();
  const { method = 'GET', body, fraudHeaders = {}, testScenario, version = '1.0' } = opts;

  // Proactively refresh if the access token is expired/near-expiry. Mutate the
  // passed conn in place (token + expiry) so a bulk sweep that shares one agent
  // connection across many sequential calls doesn't keep re-refreshing (HMRC
  // refresh tokens are single-use — a second refresh would invalidate the new
  // token).
  let token = conn.access_token;
  const expMs = conn.token_expiry ? Date.parse(conn.token_expiry) : 0;
  if (!expMs || expMs <= Date.now() + 30_000) {
    const t = await refreshTokens(conn.refresh_token);
    await persistTokens(service, conn.id, t);
    token = t.access_token;
    conn.access_token = t.access_token;
    conn.refresh_token = t.refresh_token;
    conn.token_expiry = expiryFromNow(t.expires_in);
  }

  const doFetch = (tok: string) => fetch(`${HMRC_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: `application/vnd.hmrc.${version}+json`,
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
    conn.access_token = t.access_token;
    conn.refresh_token = t.refresh_token;
    conn.token_expiry = expiryFromNow(t.expires_in);
    res = await doFetch(t.access_token);
  }

  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json };
}
