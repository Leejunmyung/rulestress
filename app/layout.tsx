import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RuleStress',
  description: 'Break your promotion before users do.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
