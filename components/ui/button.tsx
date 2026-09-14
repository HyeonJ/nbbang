import type { ComponentProps } from 'react';

type Props = ComponentProps<'button'> & { variant?: 'solid' | 'outline' };

/**
 * 스위스 그리드 버튼 — radius 0, 그림자 0. 블랙 채움(주) / 2px 아웃라인(보조) 2단.
 * 패딩은 아웃라인의 2px 테두리를 감안해 두 변형의 실측 높이를 44px로 맞춘다(탭 타깃 최소값).
 */
export function Button({ variant = 'solid', className = '', ...rest }: Props) {
  const base =
    'text-[14px] font-bold tracking-[0.04em] disabled:opacity-40 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
  const skin =
    variant === 'solid'
      ? 'bg-ink text-paper px-5 py-3'
      : 'border-2 border-ink text-ink px-[18px] py-[10px]';
  return <button className={`${base} ${skin} ${className}`} {...rest} />;
}
