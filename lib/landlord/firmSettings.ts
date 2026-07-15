// Landlord — firm-settings loader.
//
// landlord_firm_settings holds the per-firm approval email templates + brand
// colour. On first read we lazily insert the row so the column DEFAULTs in the
// migration populate every template — admins just open Settings → Landlord and
// start editing, no "initialise" step.
//
// brand_logo_path is a Landlord-specific logo (bucket `landlord-branding`).
// When it's unset the approval email and PDF fall back to the firm-wide
// branding (/api/firm/branding), which is the common case.

import { createServiceClient } from '@/lib/supabase-server';

export interface LandlordFirmSettings {
  firm_id: string;
  approval_email_subject: string;
  approval_email_body: string;
  preparer_approved_subject: string;
  preparer_approved_body: string;
  preparer_changes_subject: string;
  preparer_changes_body: string;
  reminder_enabled: boolean;
  reminder_days: number;
  reminder_max: number;
  reminder_subject: string;
  reminder_body: string;
  brand_primary_color: string;
  brand_logo_path: string | null;
}

/**
 * The logo to brand a Landlord email with, as a data URL.
 * Prefers the tool's own logo; falls back to the firm-wide one so a firm that
 * never touches Landlord branding still gets a branded email. Never throws —
 * a missing logo is cosmetic.
 */
export async function getLandlordLogoDataUrl(
  firmId: string,
  settings?: LandlordFirmSettings,
): Promise<string | null> {
  const service = createServiceClient();
  const s = settings ?? await ensureLandlordFirmSettings(firmId).catch(() => null);

  if (s?.brand_logo_path) {
    try {
      const { data } = await service.storage.from('landlord-branding').download(s.brand_logo_path);
      if (data) {
        const buf = Buffer.from(await data.arrayBuffer());
        return `data:${data.type || 'image/png'};base64,${buf.toString('base64')}`;
      }
    } catch { /* fall through to firm branding */ }
  }

  try {
    const { data: firm } = await service.from('firms').select('logo_url').eq('id', firmId).maybeSingle();
    return firm?.logo_url ?? null;
  } catch { return null; }
}

export async function ensureLandlordFirmSettings(firmId: string): Promise<LandlordFirmSettings> {
  const service = createServiceClient();

  const { data: existing } = await service
    .from('landlord_firm_settings')
    .select('*')
    .eq('firm_id', firmId)
    .maybeSingle();
  if (existing) return existing as LandlordFirmSettings;

  const { data: inserted, error } = await service
    .from('landlord_firm_settings')
    .insert({ firm_id: firmId })
    .select('*')
    .single();
  if (error || !inserted) {
    throw new Error(`Failed to initialise Landlord firm settings: ${error?.message ?? 'unknown'}`);
  }
  return inserted as LandlordFirmSettings;
}
