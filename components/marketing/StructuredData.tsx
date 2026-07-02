/**
 * JSON-LD structured data for the marketing site — helps Google understand the
 * organisation and the product, and enables richer search results. Emitted once
 * from the marketing layout. Deliberately NO aggregateRating/review markup
 * (we have no real reviews yet — fabricating them is a penalty risk).
 */
const SITE_URL = 'https://smithforaccountants.co.uk';

const GRAPH = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'SMITH',
      legalName: 'SMITH for Accountants Limited',
      url: SITE_URL,
      logo: `${SITE_URL}/logo_full.png`,
      description:
        'SMITH is the all-in-one AI workspace for UK accountancy firms — built by accountants, for accountants.',
      email: 'hello@smithforaccountants.co.uk',
      areaServed: 'GB',
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'SMITH',
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'en-GB',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#software`,
      name: 'SMITH',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Accounting software',
      operatingSystem: 'Web',
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
      description:
        'AI workspace for UK accountancy practices: bookkeeping, MTD & VAT, MTD for Income Tax, accounts review, performance analysis, email triage, tasks, document vault and client-ready outputs.',
      offers: {
        '@type': 'Offer',
        price: '60',
        priceCurrency: 'GBP',
        description: 'Per user, per month (+VAT). Unlimited clients.',
      },
    },
  ],
};

export default function StructuredData() {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inject; no user input involved.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(GRAPH) }}
    />
  );
}
