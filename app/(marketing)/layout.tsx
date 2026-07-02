import type { Metadata } from 'next';
import MarketingNav from '@/components/marketing/MarketingNav';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import WaitlistProvider from '@/components/marketing/WaitlistProvider';

export const metadata: Metadata = {
  title: 'SMITH — The all-in-one AI workspace for accounting firms',
  description:
    'SMITH gives accounting firms one secure, intelligent workspace. AI-powered email triage, accounts review, MTD & VAT, document vault and client-ready outputs — built by accountants, for accountants.',
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
