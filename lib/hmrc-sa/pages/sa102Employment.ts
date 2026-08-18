// SA102 — Employment. One <SA102> per employment source.
//
// This is the reference implementation for a supplementary page: read the Tax
// Studio source model (EmploymentSource, box-mapped in types.ts), emit one
// element per box via ./xml helpers, let empties drop out. The other pages
// (SA103/104/105/106/108/109/110/101/107) follow this exact shape.
//
// ⚠ Element names below mirror HMRC's SA102 box meanings but are PROVISIONAL
// until validated against the 2025/26 SA102 XSD (Phase 0). Corrections land
// here only.

import type { EmploymentSource } from '@/components/features/tax-studio/types';
import { el, flag, group, isoDate, poundsDown, poundsUp } from '../xml';

function oneEmployment(e: EmploymentSource): string {
  return group('SA102', [
    // Employment details (boxes 1–5.5)
    el('EmployerName', e.employer),
    el('PAYEReference', e.payeRef),
    flag('Director', e.isDirector),
    el('DirectorCeasedDate', isoDate(e.directorCeasedDate)),
    flag('CloseCompany', e.isCloseCompany),
    // Employment income (boxes 6–8)
    el('PayFromThisEmployment', poundsDown(e.pay)),
    el('UKTaxTaken', poundsUp(e.taxDeducted)),
    el('TipsAndOtherPayments', poundsDown(e.tips)),
    // Benefits from P11D (boxes 9–16)
    el('CompanyCarsVans', poundsDown(e.benCar)),
    el('FuelForCarsVans', poundsDown(e.benFuel)),
    el('MedicalDentalInsurance', poundsDown(e.benMedical)),
    el('VouchersCreditCards', poundsDown(e.benVouchers)),
    el('GoodsAndAssets', poundsDown(e.benAssets)),
    el('Accommodation', poundsDown(e.benAccommodation)),
    el('OtherBenefits', poundsDown(e.benOther)),
    el('ExpensesPayments', poundsDown(e.benExpPayments)),
    // Allowable expenses (boxes 17–20)
    el('BusinessTravelSubsistence', poundsUp(e.expTravel)),
    el('FixedDeductions', poundsUp(e.expFixed)),
    el('ProfessionalFeesSubscriptions', poundsUp(e.expProfessional)),
    el('OtherExpenses', poundsUp(e.expOther)),
  ]);
}

/** Build all SA102 pages (one per employment). Empty when there is no employment. */
export function buildSa102(employments: EmploymentSource[] | undefined): string {
  return (employments ?? []).map(oneEmployment).join('');
}
