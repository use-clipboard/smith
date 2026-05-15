import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/mtd-it/source-doc?quarter_id=...&file_name=...
//
// Returns a short-lived signed URL the editor can hand to the browser to
// view the original document a row was extracted from. Firm-scope is
// enforced by walking quarter → client → firm_id BEFORE we sign anything.
// The bucket itself is private, so signed URLs are the only way to read.

const SIGN_TTL_SECONDS = 60 * 30; // 30 minutes

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const quarterId = url.searchParams.get('quarter_id') ?? '';
  const fileName  = url.searchParams.get('file_name')  ?? '';
  if (!quarterId || !fileName) {
    return NextResponse.json({ error: 'quarter_id and file_name required' }, { status: 400 });
  }

  // Firm-scope check
  const supabase = createClient();
  const { data: q } = await supabase
    .from('mtd_it_quarters')
    .select('id, clients!inner(firm_id)')
    .eq('id', quarterId)
    .maybeSingle();
  const firmId = (q as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id;
  if (!q || firmId !== ctx.firmId) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  // Look up the latest matching document row for this filename within the
  // quarter. Multiple rows can share a filename (replace-and-rescan loops);
  // we pick the most recent one with a non-null file_url.
  const { data: docs } = await supabase
    .from('mtd_it_documents')
    .select('id, file_url, file_name, status, created_at')
    .eq('quarter_id', quarterId)
    .eq('file_name', fileName)
    .order('created_at', { ascending: false });
  const doc = (docs ?? []).find(d => d.file_url);
  if (!doc?.file_url) {
    return NextResponse.json({ error: 'No stored source for this entry' }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: signed, error } = await service.storage
    .from('mtd-it-source-docs')
    .createSignedUrl(doc.file_url, SIGN_TTL_SECONDS);
  if (error || !signed?.signedUrl) {
    console.error('GET /api/mtd-it/source-doc sign', error);
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 });
  }

  return NextResponse.json({
    url: signed.signedUrl,
    file_name: doc.file_name,
    expires_in: SIGN_TTL_SECONDS,
  });
}
