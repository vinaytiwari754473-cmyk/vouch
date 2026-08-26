import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vouch — Every paise needs a witness',
  description: 'A deterministic settlement verification agent for Razorpay records, merchant books and bank credits.',
  applicationName: 'Vouch',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Vouch — Every paise needs a witness',
    description: 'AI proposes. The verifier proves. Every paise is explained—or honestly escalated.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#151713',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
