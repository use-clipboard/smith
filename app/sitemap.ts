import type { MetadataRoute } from 'next';

const SITE_URL = 'https://smithforaccountants.co.uk';

// Public, indexable marketing pages only. App and auth routes are excluded
// (private / auth-gated). Add new public marketing pages here as they ship.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/privacy`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
