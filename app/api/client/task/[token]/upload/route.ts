import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// POST /api/client/task/[token]/upload
// Public — no auth. Accepts a file upload for a client step that has client_can_upload=true.
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createServiceClient();
  const { token } = params;

  // Validate token
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('task_client_tokens')
    .select('id, expires_at, completed_at, task_id, step_id, firm_id, task:tasks(deleted_at), step:task_steps(client_can_upload)')
    .eq('token', token)
    .single();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Task soft-deleted → its client links are revoked.
  if ((tokenRow.task as { deleted_at?: string | null } | null)?.deleted_at) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }
  if (tokenRow.completed_at) {
    return NextResponse.json({ error: 'already_completed' }, { status: 409 });
  }

  const step = tokenRow.step as unknown as { client_can_upload: boolean } | null;
  if (!step?.client_can_upload) {
    return NextResponse.json({ error: 'upload_not_allowed' }, { status: 403 });
  }

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  // Validate file type and size (max 20 MB)
  const ALLOWED_TYPES = [
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
  ];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const path = `client-uploads/${tokenRow.firm_id}/${tokenRow.task_id}/${tokenRow.step_id}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error('Client upload error', uploadError);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }

  // Record in documents table linked to the task
  await supabase.from('documents').insert({
    firm_id: tokenRow.firm_id,
    task_id: tokenRow.task_id,
    file_name: file.name,
    file_path: path,
    document_type: 'client_upload',
    uploaded_by: null, // client — no user id
  }).select().single();

  return NextResponse.json({ success: true, path });
}
