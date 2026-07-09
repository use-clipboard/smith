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

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** Build the accountant block HTML from structured name + address, else fall
 *  back to the free-text details field. Name bold, one line per address line. */
function composeAccountantDetails(name: string, address: string, details: string): string | null {
  const n = name.trim();
  const addrLines = address.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (n || addrLines.length) {
    return (n ? `<p style="margin:0;font-weight:600">${esc(n)}</p>` : '')
      + addrLines.map(l => `<p style="margin:0">${esc(l)}</p>`).join('');
  }
  return details.trim() || null;
}

export function getFirmBranding(): Promise<FirmBranding> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = Promise.all([
      fetch('/api/firm/branding').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('/api/accounts-studio/firm-settings').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch('/api/accounts-studio/firm-settings/logo').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    ])
      .then(([brand, settings, logo]: [{ firmName?: string | null; logoUrl?: string | null }, { settings?: { accountantDetails?: string; accountantsReport?: string; accountantName?: string; accountantAddress?: string } }, { logo?: string | null }]) => {
        const s = settings?.settings ?? {};
        cache = {
          firmName: brand.firmName ?? null,
          // Prefer the dedicated Accounts Studio logo, else the firm-wide logo.
          logoUrl: logo?.logo ?? brand.logoUrl ?? null,
          accountantDetails: composeAccountantDetails(s.accountantName ?? '', s.accountantAddress ?? '', s.accountantDetails ?? ''),
          accountantsReport: s.accountantsReport ?? null,
        };
        return cache;
      })
      .catch(() => { cache = { firmName: null, logoUrl: null, accountantDetails: null, accountantsReport: null }; return cache; });
  }
  return inflight;
}
