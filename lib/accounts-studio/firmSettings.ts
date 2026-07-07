// Accounts Studio — firm-wide note defaults (server side).

import type { createClient } from '@/lib/supabase-server';
import type { DisclosureSection } from '@/components/features/accounts-studio/types';

type DB = ReturnType<typeof createClient>;

export interface AccountsStudioFirmSettings {
  accountantsReport: string;
  accountantDetails: string;
  governingBody: string;
}

export const EMPTY_FIRM_SETTINGS: AccountsStudioFirmSettings = {
  accountantsReport: '', accountantDetails: '', governingBody: '',
};

export async function getAccountsStudioFirmSettings(supabase: DB, firmId: string): Promise<AccountsStudioFirmSettings> {
  const { data } = await supabase
    .from('accounts_studio_firm_settings')
    .select('accountants_report, accountant_details, governing_body')
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!data) return EMPTY_FIRM_SETTINGS;
  return {
    accountantsReport: (data.accountants_report as string | null) ?? '',
    accountantDetails: (data.accountant_details as string | null) ?? '',
    governingBody: (data.governing_body as string | null) ?? '',
  };
}

/** Firm-default disclosure notes (only the ones the firm has actually set). */
export function firmDefaultNotes(s: AccountsStudioFirmSettings, at: string): DisclosureSection[] {
  const notes: DisclosureSection[] = [];
  const mk = (id: string, title: string, requirement: string, content: string): DisclosureSection => ({
    id, title, status: 'complete', requirement, content,
    history: [{ id: 'v1', label: 'Firm default', at, content }], included: true,
  });
  // Uses the same id as the auto-generated accountants' report so the firm's
  // house-style overrides the standard template rather than duplicating it.
  if (s.accountantsReport.trim()) notes.push(mk('accountants-report', "Accountants' Report", "Firm default — reporting accountants' report.", s.accountantsReport));
  if (s.accountantDetails.trim()) notes.push(mk('firm-accountant-details', 'Accountant Details', 'Firm default — accountant details.', s.accountantDetails));
  if (s.governingBody.trim()) notes.push(mk('firm-governing-body', 'Governing Body', 'Firm default — governing body statement.', s.governingBody));
  return notes;
}
