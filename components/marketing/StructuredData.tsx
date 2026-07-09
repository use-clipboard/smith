/**
 * JSON-LD structured data for the marketing site — helps Google understand the
 * organisation and the product, and enables richer search results. Emitted once
 * from the marketing layout. Deliberately NO aggregateRating/review markup
 * (we have no real reviews yet — fabricating them is a penalty risk).
 *
 * The address, company number and Companies House sameAs link below are the
 * verified public register values for SMITH FOR ACCOUNTANTS LIMITED (company
 * no. 17263270). Add verified social profile URLs (LinkedIn, X, …) to `sameAs`
 * as they go live — never invent them.
 *
 * FAQPage markup is intentionally NOT here — it lives in Faq.tsx, driven by the
 * same on-page FAQS array so the structured data always matches visible content
 * (a Google requirement). Keep the two files' concerns separate.
 *
 * Pricing below mirrors PricingCalculator.tsx (Compliance £60, Practice Suite
 * £80, per user / month, ex-VAT) — keep the two in sync if prices change.
 */
const SITE_URL = 'https://smithforaccountants.co.uk';

// One Offer per public plan. UnitPriceSpecification pins down the "per user /
// month, VAT-exclusive" billing that a bare `price` can't express.
function planOffer(name: string, price: string, blurb: string) {
  return {
    '@type': 'Offer',
    name,
    price,
    priceCurrency: 'GBP',
    category: 'subscription',
    description: `${blurb} £${price} per user, per month (+VAT). Unlimited clients.`,
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price,
      priceCurrency: 'GBP',
      unitText: 'user / month',
      valueAddedTaxIncluded: false,
    },
  };
}

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
      slogan: 'Built by accountants, for accountants.',
      description:
        'SMITH is the all-in-one AI workspace for UK accountancy firms — built by accountants, for accountants.',
      email: 'hello@smithforaccountants.co.uk',
      areaServed: 'GB',
      foundingDate: '2026-06-05',
      // Companies House registered number, exposed as a typed identifier so
      // Google can tie this entity to the UK register.
      identifier: {
        '@type': 'PropertyValue',
        propertyID: 'Companies House',
        value: '17263270',
      },
      // Registered office (Companies House public register).
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'First Floor, Hagley Court, 40 Vicarage Road',
        addressLocality: 'Birmingham',
        postalCode: 'B15 3EZ',
        addressCountry: 'GB',
      },
      // Verified corporate-identity links. The Companies House profile confirms
      // the legal entity; append social profile URLs here as they go live.
      sameAs: ['https://find-and-update.company-information.service.gov.uk/company/17263270'],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'hello@smithforaccountants.co.uk',
        areaServed: 'GB',
        availableLanguage: 'English',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'SMITH',
      description:
        'The all-in-one AI workspace for UK accountancy firms — bookkeeping, MTD & VAT, accounts review, email triage, document vault and client-ready outputs.',
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
      screenshot: `${SITE_URL}/marketing/dashboard.png`,
      publisher: { '@id': `${SITE_URL}/#organization` },
      description:
        'AI workspace for UK accountancy practices: bookkeeping, MTD & VAT, MTD for Income Tax, accounts review, performance analysis, email triage, tasks, document vault and client-ready outputs.',
      featureList: [
        'AI bookkeeping',
        'Bank statement to CSV',
        'Invoice & receipt capture',
        'Accounts review',
        'Performance analysis',
        'MTD for VAT',
        'MTD for Income Tax',
        'Companies House secretarial',
        'AML risk assessment',
        'Email triage',
        'Tasks & workflows',
        'Document vault',
        'Client proposals',
      ],
      offers: [
        planOffer('Compliance', '60', 'Everything you need for your clients’ compliance work —'),
        planOffer('Practice Suite', '80', 'Everything in Compliance plus tools to run your whole firm —'),
      ],
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
