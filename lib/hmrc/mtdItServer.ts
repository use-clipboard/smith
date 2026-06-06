// Server-side helpers shared by the MTD-IT HMRC routes: auth + firm-scoped
// client load + connection resolution. Keeps the per-route handlers small.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { isHmrcConfigured } from './config';
import { getHmrcConnection, type HmrcConnection } from './api';

export interface MtdItClient {
  id: string;
  name: string;
  nino: string;                       // normalised (no spaces, uppercase)
  self_assessment_utr: string | null;
}

export interface MtdItCtx {
  firmId: string;
  userId: string;
  client: MtdItClient;
  conn: HmrcConnection;
  service: ReturnType<typeof createServiceClient>;
}

/** NINO is AA999999A (2 letters, 6 digits, 1 letter). Normalise + validate. */
export function normaliseNino(raw: string | null | undefined): string | null {
  const n = (raw ?? '').replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{2}\d{6}[A-Z]$/.test(n) ? n : null;
}

/**
 * Resolve everything an MTD-IT HMRC route needs, or return a ready NextResponse
 * error. Usage:
 *   const r = await resolveMtdItCtx(clientId);
 *   if (r instanceof NextResponse) return r;
 *   const { client, conn, service } = r;
 */
export async function resolveMtdItCtx(clientId: string): Promise<MtdItCtx | NextResponse> {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!isHmrcConfigured()) return NextResponse.json({ error: 'HMRC is not configured.' }, { status: 400 });

  const service = createServiceClient();
  // NINO/UTR live on the existing client columns national_insurance_number /
  // utr_number (populated by the MTD-IT client editor) — not bespoke fields.
  const { data: row } = await service
    .from('clients').select('id, name, national_insurance_number, utr_number')
    .eq('id', clientId).eq('firm_id', ctx.firmId).single();
  if (!row) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });

  const nino = normaliseNino(row.national_insurance_number as string | null);
  if (!nino) return NextResponse.json({ error: "Set the client's National Insurance number first." }, { status: 400 });

  const conn = await getHmrcConnection(service, 'mtd_it', ctx.firmId, { clientId });
  if (!conn) return NextResponse.json({ error: 'Connect to HMRC (Income Tax) first.' }, { status: 400 });

  return {
    firmId: ctx.firmId,
    userId: ctx.userId,
    client: { id: row.id as string, name: row.name as string, nino, self_assessment_utr: (row.utr_number as string | null) ?? null },
    conn,
    service,
  };
}
