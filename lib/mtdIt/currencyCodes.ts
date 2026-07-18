// ISO 4217 currency list for the foreign-rental currency picker.
//
// The codes must line up with the ones HMRC publishes in its monthly exchange
// rate file (lib/mtdIt/hmrcFxRates), so an entry's currency can be looked up
// automatically. GBP is offered too (some "foreign" portfolios hold a UK
// property alongside overseas ones) and just means no conversion.
//
// Ordered common-first, then alphabetical — a UK accountant's overseas clients
// are overwhelmingly EUR/USD/AUD/etc., so those shouldn't be buried.

export interface CurrencyOption {
  code: string;   // ISO 4217 alpha
  name: string;
}

const COMMON: CurrencyOption[] = [
  { code: 'GBP', name: 'Pound sterling' },
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'HKD', name: 'Hong Kong dollar' },
];

// Long tail — alphabetical by code. Not exhaustive of every minor currency, but
// covers everywhere a UK client is realistically likely to hold property.
const REST: CurrencyOption[] = [
  { code: 'ALL', name: 'Albanian lek' },
  { code: 'ARS', name: 'Argentine peso' },
  { code: 'BBD', name: 'Barbadian dollar' },
  { code: 'BGN', name: 'Bulgarian lev' },
  { code: 'BHD', name: 'Bahraini dinar' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'BSD', name: 'Bahamian dollar' },
  { code: 'BWP', name: 'Botswana pula' },
  { code: 'CLP', name: 'Chilean peso' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'COP', name: 'Colombian peso' },
  { code: 'CRC', name: 'Costa Rican colón' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'DOP', name: 'Dominican peso' },
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'FJD', name: 'Fijian dollar' },
  { code: 'GHS', name: 'Ghanaian cedi' },
  { code: 'GIP', name: 'Gibraltar pound' },
  { code: 'HRK', name: 'Croatian kuna' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'ILS', name: 'Israeli shekel' },
  { code: 'ISK', name: 'Icelandic króna' },
  { code: 'JMD', name: 'Jamaican dollar' },
  { code: 'JOD', name: 'Jordanian dinar' },
  { code: 'KES', name: 'Kenyan shilling' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'KWD', name: 'Kuwaiti dinar' },
  { code: 'LKR', name: 'Sri Lankan rupee' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'MUR', name: 'Mauritian rupee' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'NGN', name: 'Nigerian naira' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'OMR', name: 'Omani rial' },
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'PKR', name: 'Pakistani rupee' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'QAR', name: 'Qatari riyal' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'RSD', name: 'Serbian dinar' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'SCR', name: 'Seychellois rupee' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'TND', name: 'Tunisian dinar' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'TTD', name: 'Trinidad & Tobago dollar' },
  { code: 'TWD', name: 'Taiwan dollar' },
  { code: 'TZS', name: 'Tanzanian shilling' },
  { code: 'UAH', name: 'Ukrainian hryvnia' },
  { code: 'UGX', name: 'Ugandan shilling' },
  { code: 'VND', name: 'Vietnamese đồng' },
  { code: 'XCD', name: 'East Caribbean dollar' },
];

export const CURRENCY_OPTIONS: CurrencyOption[] = [...COMMON, ...REST];

const CODES = new Set(CURRENCY_OPTIONS.map(c => c.code));

/** Is this a currency we offer in the picker? */
export function isKnownCurrency(code: string | null | undefined): boolean {
  return !!code && CODES.has(code.toUpperCase());
}

/** Options to render, guaranteeing `current` is present even if it's an old or
 *  unusual code not in the curated list — so a select never silently drops a
 *  value already stored on an entry. */
export function currencyOptionsIncluding(current: string | null | undefined): CurrencyOption[] {
  const c = (current ?? '').toUpperCase();
  if (!c || CODES.has(c)) return CURRENCY_OPTIONS;
  return [{ code: c, name: `${c} (not in list)` }, ...CURRENCY_OPTIONS];
}
