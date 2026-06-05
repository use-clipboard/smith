import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { exchangeCodeForTokens, expiryFromNow } from '@/lib/hmrc/client';

// ── GET /api/hmrc/callback?code&state ────────────────────────────────────────
// HMRC redirects here after the user logs in + consents. We verify the state
// against the cookie, exchange the code for tokens, and persist the connection
// (service role — tokens never touch the client). Then redirect back to the
// book the connection was started from.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  // Recover the context we stashed before redirecting out.
  let stash: { state: string; kind: 'agent' | 'business'; bookId: string; firmId: string; redirectUri?: string } | null = null;
  try { const raw = req.cookies.get('hmrc_oauth')?.value; if (raw) stash = JSON.parse(raw); } catch { stash = null; }

  const bookId = stash?.bookId ?? '';
  const back = (status: string) => {
    const dest = new URL(bookId ? `/bookkeeping/${bookId}` : '/bookkeeping', req.url);
    dest.searchParams.set('hmrc', status);
    const r = NextResponse.redirect(dest);
    r.cookies.set('hmrc_oauth', '', { path: '/', maxAge: 0 });
    return r;
  };

  if (errorParam) return back('denied');
  if (!code || !stateParam || !stash) return back('error');
  if (stateParam !== stash.state) return back('state_mismatch');

  // Confirm the logged-in user still belongs to the firm that started this.
  const ctx = await getBookkeepingContext();
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

  // For a business connection, capture the book's VRN so we know which entity
  // these tokens file for.
  let vrn: string | null = null;
  if (stash.kind === 'business' && bookId) {
    const { data: book } = await service
      .from('bookkeeping_books').select('vat_number').eq('id', bookId).eq('firm_id', ctx.firmId).single();
    vrn = (book?.vat_number as string | null) ?? null;
  }

  const row = {
    firm_id: ctx.firmId,
    kind: stash.kind,
    book_id: stash.kind === 'business' ? bookId : null,
    vrn,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expiry: expiryFromNow(tokens.expires_in),
    scopes: tokens.scope ?? null,
    status: 'connected' as const,
    connected_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };

  // Replace any existing connection of the same scope (one agent per firm, one
  // business per book). Partial unique indexes make upsert fiddly, so delete-
  // then-insert.
  if (stash.kind === 'agent') {
    await service.from('hmrc_connections').delete().eq('firm_id', ctx.firmId).eq('kind', 'agent');
  } else {
    await service.from('hmrc_connections').delete().eq('book_id', bookId).eq('kind', 'business');
  }
  const { error: insErr } = await service.from('hmrc_connections').insert(row);
  if (insErr) {
    console.error('[hmrc] connection insert failed', insErr);
    return back('error');
  }

  return back('connected');
}
