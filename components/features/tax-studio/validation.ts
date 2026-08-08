// Required-field validation for a return — the HMRC-mandatory fields that must
// be completed before filing. Used to gate the Submit stage.

import type { TaxReturn } from './types';

export interface FieldIssue { label: string; }

/** The required fields still blank on this return. Empty = ready to file. */
export function requiredFieldIssues(ret: TaxReturn): FieldIssue[] {
  const out: FieldIssue[] = [];
  ret.income.selfEmployment.forEach((t, i) => {
    const trade = `Trade ${i + 1}`;
    const who = t.name?.trim() ? t.name.trim() : trade;
    if (!t.name?.trim()) out.push({ label: `${trade}: business name` });
    if (!t.description?.trim()) out.push({ label: `${who}: description of business` });
  });
  return out;
}
