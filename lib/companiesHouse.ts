// Minimal Companies House REST helper (server-side only).
//
// The CH Secretarial module has its own richer fetcher inside its route; this is
// a small shared helper for the lighter "look up a company profile + officers"
// need in Accounts Studio. Same public API, same Basic-auth-with-API-key scheme.

const CH_BASE = 'https://api.company-information.service.gov.uk';

export class ChRateLimitError extends Error { constructor() { super('RATE_LIMITED'); } }
export class ChBadKeyError extends Error { constructor() { super('BAD_KEY'); } }

/** GET a CH path with Basic auth. Returns null on 404; throws on auth/rate errors. */
export async function chGet<T>(path: string, apiKey: string): Promise<T | null> {
  const creds = Buffer.from(`${apiKey.trim()}:`).toString('base64');
  const r = await fetch(`${CH_BASE}${path}`, { headers: { Authorization: `Basic ${creds}` } });
  if (r.status === 404) return null;
  if (r.status === 429) throw new ChRateLimitError();
  if (r.status === 401 || r.status === 403) throw new ChBadKeyError();
  if (!r.ok) throw new Error(`Companies House returned ${r.status}`);
  return (await r.json()) as T;
}

/** Normalise a company number the way CH expects (8 chars, upper, zero-padded). */
export function normaliseCompanyNumber(n: string): string {
  return n.trim().toUpperCase().padStart(8, '0');
}
