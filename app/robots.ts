import type { MetadataRoute } from 'next';

const SITE_URL = 'https://smithforaccountants.co.uk';

// Let crawlers index the public marketing site; keep them out of the API and the
// authenticated app / auth pages (those redirect to /login anyway, and the auth
// pages are noindex). Sitemap points crawlers at the public URL set.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Note: we deliberately do NOT block all of /_next/ — Google needs the JS
      // and CSS under /_next/static/{chunks,css} to render pages for indexing.
      // Only /_next/static/media (bundled fonts + imported assets) is blocked:
      // those get crawled and reported as "crawled - currently not indexed"
      // noise, and a font/asset can never be a search result anyway.
      disallow: [
        '/api/',
        '/dashboard',
        '/settings',
        '/login',
        '/signup',
        '/forgot-password',
        '/reset-password',
        '/_next/static/media/',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
