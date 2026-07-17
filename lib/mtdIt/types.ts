// MTD IT — shared editor types.
//
// EditorEntry lives here rather than next to the review component because the
// lib layer (pnl, pnlExport, approvalPdf, amounts) needs it and must not import
// from components/. The review components re-export it for convenience.

import type { MtdItStream } from '@/types';

// EditorEntry mirrors the mtd_it_entries DB row plus a few editor-only fields:
//   - _localId  : stable client-side key
//   - _isNew    : true if this row hasn't been INSERTed yet
//   - _dirty    : true if the row has been edited locally since last save
//   - _deleted  : true if the user marked the row for deletion
//   - _autoFlag : derived flag (out-of-range / duplicate) — see lib/mtdIt/flags
//   - _dateText : what the user has literally typed into the date field, in UK
//                 format. entry_date only gets written once that text parses to
//                 a real day, so a half-typed year can't re-sort or re-flag the
//                 row mid-keystroke.
// Everything prefixed with _ is editor-only and never persisted (the entries
// API validates with a Zod object, which strips unknown keys).
export interface EditorEntry {
  _localId: string;
  _isNew?: boolean;
  _dirty?: boolean;
  _deleted?: boolean;
  _autoFlag?: string | null;
  _dateText?: string;
  flag_dismissed?: boolean;

  id?: string;
  stream: MtdItStream;
  trade_id: string | null;
  property_id: string | null;
  source_file_name: string | null;
  page_number: number | null;
  entry_date: string | null;
  description: string | null;
  supplier: string | null;
  invoice_number: string | null;
  category: string;
  entry_type: 'income' | 'expense';
  gross_amount: number;
  net_amount: number | null;
  vat_amount: number | null;
  currency: string;
  fx_rate: number | null;
  gbp_amount: number | null;
  share_pct: number;
  manual: boolean;
  flagged_reason: string | null;
  drive_link: string | null;
}
