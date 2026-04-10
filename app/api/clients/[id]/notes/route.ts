import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const NOTE_TYPES = ['phone_call', 'meeting', 'conversation', 'email', 'other'] as const;

const AttachmentInputSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});

const CreateNoteSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().optional(),
  note_type: z.enum(NOTE_TYPES).optional().default('other'),
  note_date: z.string().optional(),
  is_pinned: z.boolean().optional().default(false),
  attachments: z.array(AttachmentInputSchema).optional().default([]),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data: notes, error } = await supabase
    .from('client_timeline_notes')
    .select('*, users(full_name)')
    .eq('client_id', params.id)
    .eq('firm_id', ctx.firmId)
    .order('is_pinned', { ascending: false })
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('GET /api/clients/[id]/notes', error);
    return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 });
  }

  return NextResponse.json({ notes: notes ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateNoteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  // Create the note first
  const { data: note, error } = await supabase
    .from('client_timeline_notes')
    .insert({
      firm_id: ctx.firmId,
      client_id: params.id,
      user_id: ctx.userId,
      title: parsed.data.title,
      content: parsed.data.content ?? null,
      note_type: parsed.data.note_type,
      note_date: parsed.data.note_date ?? new Date().toISOString().split('T')[0],
      is_pinned: parsed.data.is_pinned ?? false,
    })
    .select('*, users(full_name)')
    .single();

  if (error) {
    console.error('POST /api/clients/[id]/notes', error);
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 });
  }

  // Upload attachments to Supabase Storage if any
  const attachmentInputs = parsed.data.attachments ?? [];
  if (attachmentInputs.length > 0) {
    try {
      const serviceClient = createServiceClient();
      const uploaded: { name: string; url: string; mimeType: string }[] = [];

      for (const file of attachmentInputs) {
        const buffer = Buffer.from(file.base64, 'base64');
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `note-attachments/${ctx.firmId}/${params.id}/${note.id}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await serviceClient.storage
          .from('documents')
          .upload(path, buffer, { contentType: file.mimeType, upsert: true });

        if (!uploadError) {
          const { data: { publicUrl } } = serviceClient.storage.from('documents').getPublicUrl(path);
          uploaded.push({ name: file.name, url: publicUrl, mimeType: file.mimeType });
        } else {
          console.warn('[notes/route] attachment upload failed:', uploadError.message);
        }
      }

      if (uploaded.length > 0) {
        await serviceClient
          .from('client_timeline_notes')
          .update({ attachments: uploaded })
          .eq('id', note.id);
        note.attachments = uploaded;
      }
    } catch (attachErr) {
      console.warn('[notes/route] attachment processing failed:', attachErr);
      // Note was still created — attachments are best-effort
    }
  }

  return NextResponse.json({ note }, { status: 201 });
}
