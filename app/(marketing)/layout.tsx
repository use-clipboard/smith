import type { Metadata } from 'next';
import MarketingNav from '@/components/marketing/MarketingNav';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import WaitlistProvider from '@/components/marketing/WaitlistProvider';
import StructuredData from '@/components/marketing/StructuredData';

const HOME_DESCRIPTION =
  'SMITH gives UK accountancy firms one secure, intelligent workspace — AI-powered bookkeeping, MTD & VAT, accounts review, email triage, document vault and client-ready outputs. Built by accountants, for accountants.';

export const metadata: Metadata = {
  title: { absolute: 'SMITH — The all-in-one AI workspace for UK accounting firms' },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    title: 'SMITH — The all-in-one AI workspace for UK accounting firms',
    description: HOME_DESCRIPTION,
  },
  twitter: {
    title: 'SMITH — The all-in-one AI workspace for UK accounting firms',
    description: HOME_DESCRIPTION,
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    // Soft-gradient backdrop (the same image as the app login screen), pinned to
    // the viewport so the white bento panels scroll over a steady gradient. The
    // solid fallback colour matches the image's near-white centre for the brief
    // moment before it paints.
    <div
      className="relative min-h-screen overflow-x-clip text-slate-900"
      style={{
        backgroundColor: '#f4f3fb',
        backgroundImage: "url('/login-background.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
      }}
    >
      <StructuredData />
      <WaitlistProvider>
        <MarketingNav />
        <main className="mx-auto w-full max-w-[1900px] space-y-5 px-4 pb-16 pt-[88px] sm:px-6 sm:pt-24 lg:px-10">
          {children}
        </main>
        <MarketingFooter />
      </WaitlistProvider>
    </div>
  );
}
