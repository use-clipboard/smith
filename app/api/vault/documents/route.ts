import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get('client_id');
    const documentTypes = searchParams.getAll('document_type');
    const taxYear = searchParams.get('tax_year');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const search = searchParams.get('search');
    const taggingStatus = searchParams.get('tagging_status');
    const source = searchParams.get('source');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') ?? '50', 10)));

    const db = createServiceClient();

    let query = db
      .from('vault_documents')
      .select(`
        *,
        clients!vault_documents_client_id_fkey(name, client_ref)
      `, { count: 'exact' })
      .eq('firm_id', userCtx.firmId);

    if (clientId) query = query.eq('client_id', clientId);
    if (documentTypes.length > 0) query = query.in('tag_document_type', documentTypes);
    if (taxYear) query = query.eq('tag_tax_year', taxYear);
    if (dateFrom) query = query.gte('tag_document_date', dateFrom);
    if (dateTo) query = query.lte('tag_document_date', dateTo);
    if (taggingStatus) query = query.eq('tagging_status', taggingStatus);
    if (source) query = query.eq('source', source);

    // Full-text search across file name, summary, and tags_array
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      query = query.or(
        `file_name.ilike.%${term}%,tag_summary.ilike.%${term}%,tag_supplier_name.ilike.%${term}%,tag_client_name.ilike.%${term}%`
      );
    }

    // Pagination
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const { data, error, count } = await query
      .order('drive_modified_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) {
      console.error('[/api/vault/documents GET]', error);
      return NextResponse.json({ error: 'Failed to load documents.' }, { status: 500 });
    }

    // Flatten joined client name
    const documents = (data ?? []).map((doc: Record<string, unknown>) => ({
      ...doc,
      client_name: (doc.clients as { name?: string; client_ref?: string } | null)?.name ?? null,
      client_ref: (doc.clients as { name?: string; client_ref?: string } | null)?.client_ref ?? null,
      clients: undefined,
    }));

    return NextResponse.json({
      documents,
      total: count ?? 0,
      page,
      per_page: perPage,
      total_pages: Math.ceil((count ?? 0) / perPage),
    });
  } catch (err) {
    console.error('[/api/vault/documents]', err);
    return NextResponse.json({ error: 'Failed to load documents.' }, { status: 500 });
  }
}
