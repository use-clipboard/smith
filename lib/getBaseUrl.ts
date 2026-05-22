/**
 * getBaseUrl — single source of truth for the app's public base URL when
 * server-side code needs to build outbound links (email CTAs, public proposal
 * pages, OAuth callbacks, etc.).
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL — canonical. Set this in production to the
 *      app's real public URL (e.g. https://app.example.com). This is the
 *      ONLY value that works with custom domains.
 *   2. VERCEL_URL — Vercel auto-sets this on every deployment to the
 *      `*.vercel.app` URL. Useful so links work out of the box on staging /
 *      preview deployments without manual config. Note: this is NOT a
 *      production custom-domain solution — Vercel sets it to the
 *      project's vercel.app host even when you've added a custom domain.
 *   3. http://localhost:3000 — final fallback for local dev.
 *
 * If you see "localhost:3000" links in production emails, set
 * NEXT_PUBLIC_SITE_URL on Vercel and redeploy.
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  return 'http://localhost:3000';
}
