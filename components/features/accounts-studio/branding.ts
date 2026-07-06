// Accounts Studio — firm branding (name + logo) for the PDF pack. Fetched once
// and cached module-wide so every download uses the firm's letterhead.

export interface FirmBranding { firmName: string | null; logoUrl: string | null }

let cache: FirmBranding | undefined;
let inflight: Promise<FirmBranding> | null = null;

export function getFirmBranding(): Promise<FirmBranding> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('/api/firm/branding')
      .then(r => (r.ok ? r.json() : {}))
      .then((d: { firmName?: string | null; logoUrl?: string | null }) => { cache = { firmName: d.firmName ?? null, logoUrl: d.logoUrl ?? null }; return cache; })
      .catch(() => { cache = { firmName: null, logoUrl: null }; return cache; });
  }
  return inflight;
}
