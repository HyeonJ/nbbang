import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * 본문·표 안의 인라인 링크. 색 처리를 한곳에 모아 화면마다 어긋나지 않게 한다.
 *
 * hover가 `accent`가 아니라 `accent-deep`인 이유(접근성): #ff4d00은 흰 바탕에서 3.33:1이라
 * 소형 텍스트 AA(4.5:1)에 못 미친다 — 글자에는 늘 짙은 변형(4.98:1)을 쓴다(globals.css의 규칙 주석).
 * 포커스 링은 비텍스트 요소라 3:1로 충분하므로 원래 오렌지를 쓴다.
 */
export function TextLink({ className = '', ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={`hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
      {...rest}
    />
  );
}
