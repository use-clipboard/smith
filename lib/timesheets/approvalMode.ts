// Timesheets — firm-level approval routing mode.
//
//   'manager' (default) — a submitted week goes only to the submitter's manager;
//                         a user with no manager is auto-approved.
//   'admins'            — any firm admin may approve anyone's weeks.
//
// Stored on firms.timesheet_settings (JSONB) alongside the other timesheet
// settings. Read defensively — anything unset/unreadable falls back to 'manager'.

export type ApprovalMode = 'manager' | 'admins';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getApprovalMode(supabase: any, firmId: string): Promise<ApprovalMode> {
  try {
    const { data } = await supabase.from('firms').select('timesheet_settings').eq('id', firmId).single();
    const m = (data?.timesheet_settings as { approvalMode?: string } | null)?.approvalMode;
    return m === 'admins' ? 'admins' : 'manager';
  } catch {
    return 'manager';
  }
}
