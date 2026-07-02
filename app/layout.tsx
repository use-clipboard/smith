import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Fraunces, Caveat } from 'next/font/google';
import './globals.css';

// Primary UI typeface — geometric grotesque, close to the shapes app body font.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

// Display serif — used for large headings (e.g. the dashboard greeting),
// echoing the shapes hero typography.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
});

// Handwriting accent — retained for whiteboard sticky notes.
const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-caveat',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const SITE_URL = 'https://smithforaccountants.co.uk';
const SITE_DESCRIPTION =
  'The all-in-one AI workspace for UK accountancy firms — bookkeeping, MTD & VAT, accounts review, email triage, document vault and client-ready outputs. Built by accountants, for accountants.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'SMITH — The AI workspace for UK accounting firms',
    template: '%s — SMITH',
  },
  description: SITE_DESCRIPTION,
  applicationName: 'SMITH',
  keywords: [
    'accounting software UK',
    'AI accounting software',
    'accountancy practice software',
    'practice management software for accountants',
    'Making Tax Digital software',
    'MTD software',
    'MTD VAT software',
    'MTD for Income Tax software',
    'bookkeeping software UK',
    'accountancy firm software',
    'AI for accountants',
    'accounts production software',
  ],
  authors: [{ name: 'SMITH for Accountants' }],
  creator: 'SMITH for Accountants Limited',
  publisher: 'SMITH for Accountants Limited',
  category: 'business',
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    siteName: 'SMITH',
    url: SITE_URL,
    locale: 'en_GB',
    title: 'SMITH — The AI workspace for UK accounting firms',
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SMITH — The AI workspace for UK accounting firms',
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: '/icon.png',
    shortcut: '/favicon.ico',
    apple: '/icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${fraunces.variable} ${caveat.variable}`}>
      <body className={jakarta.className}>
        {children}
      </body>
    </html>
  );
}
