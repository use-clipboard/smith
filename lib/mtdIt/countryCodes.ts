// Resolve a free-text country (or an alpha-2 / alpha-3 code) to the ISO 3166-1
// alpha-3 code HMRC requires for foreign-property cumulative submissions.
//
// Foreign properties are captured with a free-text "Country" field in the
// properties editor, so a user may type "France", "france", "FR" or "FRA".
// HMRC's foreign-property API keys each entry by countryCode (alpha-3). We
// resolve generously but NEVER guess: an unresolvable value returns null so the
// caller can refuse to file rather than submit a wrong/blank code.

// Common alpha-3 codes, keyed by a normalised lookup token. Covers the alpha-3
// itself, the alpha-2, and the common English name(s) for the countries UK
// taxpayers most often hold property in, plus the major economies. Extend as
// needed — an unknown country simply blocks filing for that one property.
const ALPHA3: Record<string, string> = {};

// [alpha-3, alpha-2, ...names]
const COUNTRIES: string[][] = [
  ['FRA', 'FR', 'France'],
  ['ESP', 'ES', 'Spain'],
  ['PRT', 'PT', 'Portugal'],
  ['ITA', 'IT', 'Italy'],
  ['GRC', 'GR', 'Greece'],
  ['CYP', 'CY', 'Cyprus'],
  ['MLT', 'MT', 'Malta'],
  ['IRL', 'IE', 'Ireland', 'Republic of Ireland'],
  ['DEU', 'DE', 'Germany'],
  ['NLD', 'NL', 'Netherlands', 'Holland', 'The Netherlands'],
  ['BEL', 'BE', 'Belgium'],
  ['CHE', 'CH', 'Switzerland'],
  ['AUT', 'AT', 'Austria'],
  ['SWE', 'SE', 'Sweden'],
  ['NOR', 'NO', 'Norway'],
  ['DNK', 'DK', 'Denmark'],
  ['FIN', 'FI', 'Finland'],
  ['POL', 'PL', 'Poland'],
  ['CZE', 'CZ', 'Czech Republic', 'Czechia'],
  ['HUN', 'HU', 'Hungary'],
  ['HRV', 'HR', 'Croatia'],
  ['BGR', 'BG', 'Bulgaria'],
  ['ROU', 'RO', 'Romania'],
  ['TUR', 'TR', 'Turkey', 'Turkiye'],
  ['USA', 'US', 'United States', 'United States of America', 'America', 'USA', 'US'],
  ['CAN', 'CA', 'Canada'],
  ['MEX', 'MX', 'Mexico'],
  ['BRB', 'BB', 'Barbados'],
  ['JAM', 'JM', 'Jamaica'],
  ['ARE', 'AE', 'United Arab Emirates', 'UAE', 'Dubai', 'Abu Dhabi'],
  ['QAT', 'QA', 'Qatar'],
  ['SAU', 'SA', 'Saudi Arabia'],
  ['ZAF', 'ZA', 'South Africa'],
  ['EGY', 'EG', 'Egypt'],
  ['MAR', 'MA', 'Morocco'],
  ['NGA', 'NG', 'Nigeria'],
  ['KEN', 'KE', 'Kenya'],
  ['IND', 'IN', 'India'],
  ['PAK', 'PK', 'Pakistan'],
  ['BGD', 'BD', 'Bangladesh'],
  ['LKA', 'LK', 'Sri Lanka'],
  ['CHN', 'CN', 'China'],
  ['HKG', 'HK', 'Hong Kong'],
  ['SGP', 'SG', 'Singapore'],
  ['MYS', 'MY', 'Malaysia'],
  ['THA', 'TH', 'Thailand'],
  ['IDN', 'ID', 'Indonesia'],
  ['PHL', 'PH', 'Philippines'],
  ['JPN', 'JP', 'Japan'],
  ['KOR', 'KR', 'South Korea', 'Korea'],
  ['AUS', 'AU', 'Australia'],
  ['NZL', 'NZ', 'New Zealand'],
  ['ATG', 'AG', 'Antigua', 'Antigua and Barbuda'],
  ['GRD', 'GD', 'Grenada'],
  ['LCA', 'LC', 'Saint Lucia', 'St Lucia'],
  ['DMA', 'DM', 'Dominica'],
  ['BHS', 'BS', 'Bahamas', 'The Bahamas'],
  ['MUS', 'MU', 'Mauritius'],
  ['SYC', 'SC', 'Seychelles'],
  ['ISR', 'IL', 'Israel'],
  ['LUX', 'LU', 'Luxembourg'],
  ['ISL', 'IS', 'Iceland'],
  ['SVK', 'SK', 'Slovakia'],
  ['SVN', 'SI', 'Slovenia'],
  ['EST', 'EE', 'Estonia'],
  ['LVA', 'LV', 'Latvia'],
  ['LTU', 'LT', 'Lithuania'],
  ['MCO', 'MC', 'Monaco'],
  ['AND', 'AD', 'Andorra'],
];

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
}

for (const [a3, a2, ...names] of COUNTRIES) {
  ALPHA3[norm(a3)] = a3;
  ALPHA3[norm(a2)] = a3;
  for (const n of names) ALPHA3[norm(n)] = a3;
}

/**
 * Resolve a user-entered country to an ISO 3166-1 alpha-3 code, or null if it
 * can't be confidently resolved. Accepts the alpha-3 itself, the alpha-2, or a
 * common English country name (case/spacing/full-stop insensitive).
 */
export function resolveCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  return ALPHA3[norm(input)] ?? null;
}
