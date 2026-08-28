import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { encryptSecret, isSecretBoxConfigured } from '@/lib/crypto/secretBox';
import { getCtFilingStatus } from '@/lib/hmrc-ct/getCtCredsForFirm';

// Per-firm HMRC CT600 (GovTalk) filing credentials.
// GET is readable by any firm member (returns a boolean status only, never the
// password) so the Tax Studio filing card can show setup state to preparers.
// PATCH/DELETE are admin-only. The password is stored AES-256-GCM encrypted.

async function getFirmUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorised', firmId: null, isAdmin: false };
  const { data: profile } = await supabase.from('users').select('role, firm_id').eq('id', user.id).single();
  if (!profile?.firm_id) return { error: 'No firm found', firmId: null, isAdmin: false };
  return { error: null, firmId: profile.firm_id as string, isAdmin: profile.role === 'admin' };
}

/** GET: filing-credential status for the firm (any member). Never returns the password. */
export async function GET() {
  const { error, firmId, isAdmin } = await getFirmUser();
  if (error) return NextResponse.json({ error }, { status: 401 });

  const status = await getCtFilingStatus(firmId!);
  return NextResponse.json({
    hasCredentials: status.credentialsStored,
    ready: status.ready,
    source: status.source,
    vendorIdConfigured: status.vendorIdConfigured,
    senderId: isAdmin ? status.senderId : null,
  });
}

const patchSchema = z.object({
  senderId: z.string().trim().min(1, 'Gateway User ID is required').max(64),
  password: z.string().min(1, 'Gateway password is required').max(256),
});

/** PATCH: save the firm's HMRC Gateway credentials (admin only). */
export async function PATCH(request: NextRequest) {
  const { error, firmId, isAdmin } = await getFirmUser();
  if (error) return NextResponse.json({ error }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isSecretBoxConfigured()) {
    return NextResponse.json({ error: 'The server encryption key (SA_CRED_ENCRYPTION_KEY) is not configured, so credentials cannot be stored securely. Please contact support.' }, { status: 500 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { error: updateError } = await service.from('firms').update({
    ct_gateway_sender_id: parsed.data.senderId,
    ct_gateway_password_enc: encryptSecret(parsed.data.password),
  }).eq('id', firmId!);
  if (updateError) {
    console.error('PATCH /api/firms/ct-filing', updateError);
    return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/** DELETE: remove the firm's stored credentials (admin only). */
export async function DELETE() {
  const { error, firmId, isAdmin } = await getFirmUser();
  if (error) return NextResponse.json({ error }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const { error: updateError } = await service.from('firms').update({
    ct_gateway_sender_id: null,
    ct_gateway_password_enc: null,
  }).eq('id', firmId!);
  if (updateError) {
    console.error('DELETE /api/firms/ct-filing', updateError);
    return NextResponse.json({ error: 'Failed to remove credentials' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
