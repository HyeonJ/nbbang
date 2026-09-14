import type { Metadata } from 'next';
import { Archivo, Noto_Sans_KR } from 'next/font/google';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-archivo',
  display: 'swap',
});

// weight를 지정하지 않으면 next/font가 가변 폰트(wght 축)를 받는다. 고정 weight 4개를 쓰면
// 124개 unicode-range subset × 4 = 496개 @font-face가 방출돼 CSS가 306KB까지 불어난다.
// 가변 폰트는 subset당 1개면 충분하고 400~900을 모두 커버한다.
// preload: false — 한글 폰트를 preload하면 subset 조각 수십 개가 전부 <link rel=preload>로
// 방출돼 LCP가 크게 밀린다. unicode-range 온디맨드 로딩이 훨씬 빠르다.
const notoKr = Noto_Sans_KR({
  subsets: ['latin'],
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
