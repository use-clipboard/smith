// Landlord — firm-settings loader.
//
// landlord_firm_settings holds the per-firm approval email templates + brand
// colour. On first read we lazily insert the row so the column DEFAULTs in the
// migration populate every template — admins just open Settings → Landlord and
// start editing, no "initialise" step.
//
// The logo isn't stored here: the approval email and the PDF both use the
// firm-wide branding (/api/firm/branding), so they stay consistent.

import { createServiceClient } from '@/lib/supabase-server';

export interface LandlordFirmSettings {
  firm_id: string;
  approval_email_subject: string;
  approval_email_body: string;
  preparer_approved_subject: string;
  preparer_approved_body: string;
  preparer_changes_subject: string;
  preparer_changes_body: string;
  brand_primary_color: string;
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
