// Companies House data types

export interface CHAddress {
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export function formatCHAddress(a: CHAddress): string {
  return [a.addressLine1, a.addressLine2, a.locality, a.region, a.postalCode, a.country]
    .filter(Boolean).join(', ');
}

export interface CHOfficer {
  name: string;
  role: string;
  appointedOn: string;
  resignedOn?: string;
  dateOfBirth?: { month: number; year: number };
  address: CHAddress;
  idvDueDate: string | null;    // computed from ECCTA rules
  idvOverdue: boolean;           // computed — false if idvVerified is true
  idvVerified: boolean;          // true if CH API returned verification data
  idvExempt?: boolean;           // true for secretaries — not subject to ECCTA IDV
}

export interface CHPSC {
  name: string;
  kind: string;
  notifiedOn: string;
  ceasedOn?: string;
  naturesOfControl: string[];
  address: CHAddress;
  dateOfBirth?: { month: number; year: number };
  idvDueDate: string | null;
  idvOverdue: boolean;           // false if idvVerified is true
  idvVerified: boolean;          // true if CH API returned verification data
}

export interface CHCompanyData {
  companyNumber: string;
  companyName: string;
  status: string;
  incorporationDate: string;
  type: string;
  sicCodes: string[];
  registeredOffice: CHAddress;
  // Accounts
  accountsNextDue: string | null;
  accountsOverdue: boolean;
  // Confirmation Statement
  csNextDue: string | null;
  csOverdue: boolean;
  // Officers IDV
  nearestOfficerIdvDue: string | null;
  officersIdvOverdueCount: number;
  // PSC IDV
  nearestPscIdvDue: string | null;
  pscIdvOverdueCount: number;
  // Detail
  activeOfficerCount: number;
  activePscCount: number;
  officers: CHOfficer[];
  pscs: CHPSC[];
  chUrl: string;
  fetchedAt: string;
  error?: string;
}

export type CHSortField =
  | 'companyNumber' | 'companyName' | 'status' | 'incorporationDate'
  | 'accountsNextDue' | 'accountsOverdue'
  | 'csNextDue' | 'csOverdue'
  | 'nearestOfficerIdvDue' | 'officersIdvOverdueCount'
  | 'nearestPscIdvDue' | 'pscIdvOverdueCount';

export interface CHColumnDef {
  key: CHSortField;
  label: string;
  defaultVisible: boolean;
}

export const CH_COLUMNS: CHColumnDef[] = [
  { key: 'companyNumber',           label: 'Company No.',           defaultVisible: true },
  { key: 'companyName',             label: 'Company Name',          defaultVisible: true },
  { key: 'status',                  label: 'Status',                defaultVisible: true },
  { key: 'incorporationDate',       label: 'Incorporated',          defaultVisible: true },
  { key: 'accountsNextDue',         label: 'Accounts Due',          defaultVisible: true },
  { key: 'accountsOverdue',         label: 'Accounts OD?',          defaultVisible: true },
  { key: 'csNextDue',               label: 'CS Due',                defaultVisible: true },
  { key: 'csOverdue',               label: 'CS OD?',                defaultVisible: true },
  { key: 'nearestOfficerIdvDue',    label: 'Officer IDV Due',       defaultVisible: true },
  { key: 'officersIdvOverdueCount', label: 'Officers IDV OD',       defaultVisible: true },
  { key: 'nearestPscIdvDue',        label: 'PSC IDV Due',           defaultVisible: true },
  { key: 'pscIdvOverdueCount',      label: 'PSCs IDV OD',           defaultVisible: true },
];
