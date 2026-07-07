// Accounts Studio — firm branding (name + logo) and house-style defaults for
// the PDF pack. Fetched once and cached module-wide so every download uses the
// firm's letterhead and standard wording.

export interface FirmBranding {
  firmName: string | null;
  logoUrl: string | null;
  /** House-style defaults (Settings → Accounts Studio), as HTML. */
  accountantDetails: string | null;
  accountantsReport: string | null;
}

let cache: FirmBranding | undefined;
let inflight: Promise<FirmBranding> | null = null;

export function getFirmBranding(): Promise<FirmBranding> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = Promise.all([
      fetch('/api/firm/branding').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('/api/accounts-studio/firm-settings').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    ])
      .then(([brand, settings]: [{ firmName?: string | null; logoUrl?: string | null }, { settings?: { accountantDetails?: string; accountantsReport?: string } }]) => {
        const s = settings?.settings ?? {};
        cache = {
          firmName: brand.firmName ?? null,
          logoUrl: brand.logoUrl ?? null,
          accountantDetails: s.accountantDetails ?? null,
          accountantsReport: s.accountantsReport ?? null,
        };
        return cache;
      })
      .catch(() => { cache = { firmName: null, logoUrl: null, accountantDetails: null, accountantsReport: null }; return cache; });
  }
  return inflight;
}
