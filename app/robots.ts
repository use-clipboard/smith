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
      disallow: ['/api/', '/dashboard', '/settings', '/login', '/signup', '/forgot-password', '/reset-password'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
