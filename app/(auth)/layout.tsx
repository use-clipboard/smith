import type { Metadata } from 'next';

// Auth pages should never appear in search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-cover bg-center flex items-center justify-center p-4"
      style={{ backgroundImage: "url('/login-background.png')" }}
    >
      {children}
    </div>
  );
}
