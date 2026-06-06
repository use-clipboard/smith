import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { exchangeCodeForTokens, expiryFromNow } from '@/lib/hmrc/client';
import type { HmrcService } from '@/lib/hmrc/config';

// ── GET /api/hmrc/callback?code&state ────────────────────────────────────────
// HMRC redirects here after the user logs in + consents. We verify the state
// against the cookie, exchange the code for tokens, and persist the connection
// (service role — tokens never touch the client). Then redirect back to the
// area the connection was started from (bookkeeping for VAT, MTD-IT otherwise).
interface OAuthStash {
  state: string;
  service?: HmrcService;
  kind: 'agent' | 'business' | 'individual';
  bookId: string;
  clientId?: string;
  firmId: string;
  redirectUri?: string;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  // Recover the context we stashed before redirecting out.
  let stash: OAuthStash | null = null;
  try { const raw = req.cookies.get('hmrc_oauth')?.value; if (raw) stash = JSON.parse(raw); } catch { stash = null; }

  const svc: HmrcService = stash?.service === 'mtd_it' ? 'mtd_it' : 'vat';
  const bookId = stash?.bookId ?? '';
  const clientId = stash?.clientId ?? '';
  const back = (status: string) => {
    // VAT returns to the book; MTD-IT returns to the income-tax area.
    const path = svc === 'mtd_it'
      ? '/mtd-it'
      : (bookId ? `/bookkeeping/${bookId}` : '/bookkeeping');
    const dest = new URL(path, req.url);
    dest.searchParams.set('hmrc', status);
    const r = NextResponse.redirect(dest);
    r.cookies.set('hmrc_oauth', '', { path: '/', maxAge: 0 });
    return r;
  };

  if (errorParam) return back('denied');
  if (!code || !stateParam || !stash) return back('error');
  if (stateParam !== stash.state) return back('state_mismatch');

  // Confirm the logged-in user still belongs to the firm that started this.
  const ctx = await getUserContext();
  if (!ctx || ctx.firmId !== stash.firmId) return back('error');

  let tokens;
  try {
    // Use the SAME redirect URI the connect step sent to HMRC.
    tokens = await exchangeCodeForTokens(code, stash.redirectUri ?? new URL('/api/hmrc/callback', req.url).toString());
  } catch (e) {
    console.error('[hmrc] token exchange failed', e);
    return back('error');
  }

  const service = createServiceClient();

  // For a (VAT) business connection, capture the book's VRN so we know which
  // entity these tokens file for.
  let vrn: string | null = null;
  if (stash.kind === 'business' && bookId) {
    const { data: book } = await service
      .from('bookkeeping_books').select('vat_number').eq('id', bookId).eq('firm_id', ctx.firmId).single();
    vrn = (book?.vat_number as string | null) ?? null;
  }

  const row = {
    firm_id: ctx.firmId,
    service: svc,
    kind: stash.kind,
    book_id: stash.kind === 'business' ? bookId : null,
    client_id: stash.kind === 'individual' ? (clientId || null) : null,
    vrn,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expiry: expiryFromNow(tokens.expires_in),
    scopes: tokens.scope ?? null,
    status: 'connected' as const,
    connected_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };

  // Replace any existing connection of the same (firm, service, kind, target).
  // Partial unique indexes make upsert fiddly, so delete-then-insert.
  let del = service.from('hmrc_connections').delete().eq('firm_id', ctx.firmId).eq('service', svc).eq('kind', stash.kind);
  if (stash.kind === 'business') del = del.eq('book_id', bookId);
  else if (stash.kind === 'individual') del = del.eq('client_id', clientId);
  await del;

  const { error: insErr } = await service.from('hmrc_connections').insert(row);
  if (insErr) {
    console.error('[hmrc] connection insert failed', insErr);
    return back('error');
  }

  return back('connected');
}
