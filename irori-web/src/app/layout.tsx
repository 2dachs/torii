import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Irori Web',
  description: 'Irori web AI chat MVP',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
