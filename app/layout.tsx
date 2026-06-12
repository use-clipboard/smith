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

export const metadata: Metadata = {
  title: 'SMITH',
  description: 'AI-powered accounting workflow tools',
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
