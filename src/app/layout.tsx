import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tuya Home Energy & Climate — Monitoring Électrique & Confort',
  description:
    'Agrégateur Tuya de puissance électrique, coûts énergétiques multi-tarifs et métriques température/humidité par pièce.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 font-sans antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}
