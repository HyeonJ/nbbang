import type { ComponentProps } from 'react';

type Props = ComponentProps<'button'> & {
  variant?: 'solid' | 'outline';
  size?: 'md' | 'sm';
};

/**
 * 스위스 그리드 버튼 — radius 0, 그림자 0. 블랙 채움(주) / 2px 아웃라인(보조) 2단.
 * md 패딩은 아웃라인의 2px 테두리를 감안해 두 변형의 실측 높이를 44px로 맞춘다(탭 타깃 최소값).
 * sm은 표의 한 칸(지출 금액 열의 '정정')처럼 행 높이를 키울 수 없는 자리에만 쓴다.
 *
 * 크기별 클래스를 skin에 함께 담는 이유: 같은 유틸(px-*, text-*)을 base와 size로 나눠 두면
 * 생성된 CSS 순서에 승자가 달려 예측 불가다. 변형×크기 조합당 한 벌만 내보낸다.
 */
const SKINS = {
  solid: {
    base: 'bg-ink text-paper',
    md: 'px-5 py-3 text-[14px]',
    sm: 'px-3 py-1.5 text-[12px]',
  },
  outline: {
    base: 'border-2 border-ink text-ink',
    md: 'px-[18px] py-[10px] text-[14px]',
    sm: 'px-2.5 py-1 text-[12px]',
  },
} as const;

const BASE =
  'font-bold tracking-[0.04em] disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * 같은 스킨을 `<button>`이 아닌 요소에 입힌다 — 다음 화면으로 **이동**하는 주 동작
 * (정산 목록의 '정산 만들기')은 버튼이 아니라 링크여야 하고, 그렇다고 스킨 문자열을
 * 화면 쪽에 손으로 베끼면 두 벌이 각자 낡는다. 한 벌만 두고 여기서 나눠 준다.
 */
export function buttonClasses(
  variant: NonNullable<Props['variant']> = 'solid',
  size: NonNullable<Props['size']> = 'md',
  className = '',
) {
  const skin = SKINS[variant];
  return `${BASE} ${skin.base} ${skin[size]} ${className}`;
}

export function Button({ variant = 'solid', size = 'md', className = '', ...rest }: Props) {
  return <button className={buttonClasses(variant, size, className)} {...rest} />;
}
