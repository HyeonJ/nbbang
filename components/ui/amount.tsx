import { formatAmount } from '@/lib/format';

type Props = {
  value: number;
  size?: 'md' | 'lg' | 'xl';
  /** 원장 행처럼 수입/지출이 섞이는 자리에서 양수에도 +를 붙인다. 잔액 같은 단일 수치는 false. */
  showSign?: boolean;
  /** '원' 단위를 숫자보다 작게 덧붙인다. */
  unit?: boolean;
};

const SIZES = { md: 'text-[15px]', lg: 'text-2xl', xl: 'text-4xl tracking-[-0.03em]' } as const;
const UNIT_SIZES = { md: 'text-[12px]', lg: 'text-[15px]', xl: 'text-xl' } as const;

/**
 * 금액 표기. 언제나 등폭 숫자(.num)로 열을 맞추고, 수입은 오렌지로 구분한다.
 *
 * 색 선택이 방향 문서와 다른 이유(접근성): `--accent`(#ff4d00)는 흰 바탕에서 3.33:1이라
 * 대형 텍스트(3:1)는 통과하지만 소형 텍스트 AA(4.5:1)에는 못 미친다. 그래서 md에는
 * 같은 계열의 짙은 오렌지 `--accent-deep`(4.98:1)을 쓴다 — 의미는 하나(들어온 돈)로 유지된다.
 * 더해서 showSign으로 부호 글리프를 함께 내보내 의미가 색에만 실리지 않게 한다.
 */
export function Amount({ value, size = 'md', showSign = false, unit = false }: Props) {
  const tone = value > 0 ? (size === 'md' ? 'text-accent-deep' : 'text-accent') : 'text-ink';
  const sign = showSign && value > 0 ? '+' : '';
  return (
    <span className={`num ${SIZES[size]} ${tone}`}>
      {sign}
      {formatAmount(value)}
      {unit ? <span className={`${UNIT_SIZES[size]} font-medium`}>원</span> : null}
    </span>
  );
}
