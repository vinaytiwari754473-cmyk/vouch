import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://vouch-settlement-proof.vvtt30691.chatgpt.site'),
  title: 'Vouch — Every paise needs a witness',
  description: 'A deterministic settlement verification agent for Razorpay records, merchant books and bank credits.',
  applicationName: 'Vouch',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Vouch — Every paise needs a witness',
    description: 'AI proposes. The verifier proves. Every paise is explained—or honestly escalated.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Vouch — Every paise needs a witness' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vouch — Every paise needs a witness',
    description: 'Deterministic three-source settlement verification.',
    images: ['/og.png'],
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
