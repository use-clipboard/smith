// MTD IT — firm-settings loader.
//
// The mtd_it_firm_settings table holds per-firm email templates + reminder
// config. On first read we lazily upsert the defaults so admins don't have
// to "initialise" the row — they just open the Settings → MTD IT tab and
// start editing.

import { createServiceClient } from '@/lib/supabase-server';

export interface MtdItFirmSettings {
  firm_id: string;
  approval_email_subject: string;
  approval_email_body:    string;
  preparer_approved_subject: string;
  preparer_approved_body:    string;
  preparer_changes_subject: string;
  preparer_changes_body:    string;
  reminder_enabled: boolean;
  reminder_days:    number;
  reminder_max:     number;
  reminder_subject: string;
  reminder_body:    string;

  // Branding — drives PDF header band + email header band
  brand_primary_color: string;       // "#8B85CF" — 6-digit hex
  brand_logo_path:     string | null; // supabase storage key under mtd-it-branding

  // PDF content toggles — let admins trim the PDF to taste
  pdf_include_kpi_cards:            boolean;
  pdf_include_chart:                boolean;
  pdf_include_category_tables:      boolean;
  pdf_include_breakdown:            boolean;
  pdf_include_transaction_detail:   boolean;
  pdf_include_quarterly_comparison: boolean;

  // Source-document lifecycle — auto-delete the local supabase copies of
  // source documents once the quarter is marked 'complete'. The Save-to-
  // records modal acts as the last-chance archive prompt before deletion
  // fires (see MtdItSaveToRecordsModal + the cleanup endpoint).
  auto_delete_source_on_complete: boolean;

  // Additional firm users to notify (in-app + email) when a client approves /
  // requests changes — on top of whoever sent it for approval.
  notify_user_ids: string[];
}

/**
 * Returns the firm's settings row, creating it with the column defaults on
 * first call. Uses the service client so it works regardless of the caller's
 * RLS context.
 */
export async function ensureMtdItFirmSettings(firmId: string): Promise<MtdItFirmSettings> {
  const service = createServiceClient();

  const { data: existing } = await service
    .from('mtd_it_firm_settings')
    .select('*')
    .eq('firm_id', firmId)
    .maybeSingle();
  if (existing) return existing as MtdItFirmSettings;

  // Insert an empty row — the column DEFAULTs in the migration populate every
  // template + reminder field. Returning the inserted row gives us those
  // defaults without us re-stating them in TypeScript.
  const { data: inserted, error } = await service
    .from('mtd_it_firm_settings')
    .insert({ firm_id: firmId })
    .select('*')
    .single();
  if (error || !inserted) {
    throw new Error(`Failed to initialise MTD IT firm settings: ${error?.message ?? 'unknown'}`);
  }
  return inserted as MtdItFirmSettings;
}
