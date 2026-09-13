import type { ReactNode } from 'react';

export const metadata = {
  title: 'PFY H5P spike — web',
  description: 'Minimal Next.js host embedding the H5P runtime cross-origin'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          font: '14px/1.6 system-ui, sans-serif',
          margin: 0,
          padding: '24px',
          maxWidth: 1100
        }}
      >
        {children}
      </body>
    </html>
  );
}
