/**
 * getBaseUrl — single source of truth for the app's public base URL when
 * server-side code needs to build outbound links (email CTAs, public proposal
 * pages, OAuth callbacks, etc.).
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL — canonical. Set this in production to the
 *      app's real public URL (https://smithforaccountants.co.uk). This is the
 *      ONLY value that works reliably with the custom domain.
 *   2. NEXT_PUBLIC_APP_URL — some integrations (Google OAuth, client-task
 *      links) read this instead; honoured here too so a single value is enough.
 *   3. http://localhost:3000 — local development only (NODE_ENV !== production).
 *   4. VERCEL_URL — preview / staging deployments without explicit config get
 *      their own `*.vercel.app` URL so links still work out of the box. NOT a
 *      production custom-domain solution (Vercel sets it to the vercel.app host
 *      even behind a custom domain), so it sits below the production fallback.
 *   5. https://smithforaccountants.co.uk — production custom-domain fallback,
 *      so reset/email links never degrade to localhost or a vercel.app host even
 *      if the env var is missed on a production deploy.
 *
 * To point everything at a different domain, set NEXT_PUBLIC_SITE_URL on Vercel
 * and redeploy — that always wins.
 */
export function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  return 'https://smithforaccountants.co.uk';
}
