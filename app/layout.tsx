import type { Metadata } from 'next';
import { Archivo, Noto_Sans_KR } from 'next/font/google';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-archivo',
  display: 'swap',
});

// preload: false — 한글 폰트를 preload하면 subset 조각 수십 개가 전부 <link rel=preload>로
// 방출돼 LCP가 크게 밀린다. unicode-range 온디맨드 로딩이 훨씬 빠르다.
const notoKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-noto-kr',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: { default: '엔빵 — 모임 회비 장부', template: '%s · 엔빵' },
  description: '동호회·스터디 총무를 위한 회비 장부. 걷고, 쓰고, 나누고, 투명하게 공개한다.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${archivo.variable} ${notoKr.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
