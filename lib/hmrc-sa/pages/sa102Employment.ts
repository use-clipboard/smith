// SA102 — Employment. One <SA102> per employment source (schema allows 0..50).
//
// Validated against HMRC's 2025/26 MTR schema (MTR-v1-2.xsd): the SA102 element
// nests boxes under <Employment> (required), <Benefits> and <Expenses>. Element
// names below are the real schema names, not the earlier provisional guesses.
//
// Required by the schema (must always be present on a rendered SA102):
//   Employment/EmployerPAYEReference  (1..1, max 17 chars)
//   Employment/CompanyDirector        (1..1, yes/no)

import type { EmploymentSource } from '@/components/features/tax-studio/types';
import { clip, el, flag, group, isoDate, moneyDown, moneyUp, yesno } from '../xml';

function oneEmployment(e: EmploymentSource): string {
  // <Employment> — always rendered (carries the two required boxes).
  const employment = group('Employment', [
    el('PayFromEmployment', moneyDown(e.pay)),
    el('TaxTakenOffPay', moneyUp(e.taxDeducted)),
    el('TipsAndOtherPayments', moneyDown(e.tips)),
    // EmployerPAYEReference is required — fall back to a schema-valid placeholder
    // only so the return still validates; real data always carries the ref.
    el('EmployerPAYEReference', clip(e.payeRef, 17) ?? '000/N'),
    el('EmployersName', clip(e.employer, 28)),
    yesno('CompanyDirector', !!e.isDirector),
    el('DateCeasedBeingADirector', isoDate(e.directorCeasedDate)),
    flag('CloseCompany', e.isCloseCompany),
  ]);

  // <Benefits> — P11D benefits (boxes 9–16). Non-negative, non-zero (2dp).
  const benefits = group('Benefits', [
    el('CompanyCarsAndVansBenefit', moneyDown(e.benCar)),
    el('FuelForCarsAndVans', moneyDown(e.benFuel)),
    el('PrivateMedicalDentalInsurance', moneyDown(e.benMedical)),
    el('VouchersCreditCardsExcessMileageAllowance', moneyDown(e.benVouchers)),
    el('GoodsEtcProvidedByEmployer', moneyDown(e.benAssets)),
    el('AccommodationProvidedByEmployer', moneyDown(e.benAccommodation)),
    el('OtherBenefits', moneyDown(e.benOther)),
    el('ExpensesPaymentsReceived', moneyDown(e.benExpPayments)),
  ]);

  // <Expenses> — allowable employment expenses (boxes 17–20). Rounded up.
  const expenses = group('Expenses', [
    el('BusinessTravelAndSubsistence', moneyUp(e.expTravel)),
    el('FixedExpensesDeductions', moneyUp(e.expFixed)),
    el('ProfessionalFeesAndSubscriptions', moneyUp(e.expProfessional)),
    el('OtherExpensesAndCapitalAllowances', moneyUp(e.expOther)),
  ]);

  return group('SA102', [employment, benefits, expenses]);
}

/** Build all SA102 pages (one per employment). Empty when there is no employment. */
export function buildSa102(employments: EmploymentSource[] | undefined): string {
  return (employments ?? []).map(oneEmployment).join('');
}
