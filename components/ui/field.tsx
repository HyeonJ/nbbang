import type { ComponentProps, ReactNode } from 'react';

type Props = ComponentProps<'input'> & { label: string; hint?: ReactNode };

/**
 * 라벨 + 입력 한 쌍. 테두리는 하단 괘선 하나뿐 — 상자가 아니라 기입란이다.
 * 포커스는 하단 괘선이 2px 오렌지로 바뀌어 알린다(WCAG 2.4.13: 2px 두께·인접색 대비 3:1 충족).
 */
export function Field({ label, hint, className = '', ...rest }: Props) {
  return (
    <label className="block">
      <span className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">{label}</span>
      <input
        className={`mt-1.5 w-full border-b-2 border-ink bg-transparent py-2.5 text-[15px] outline-none focus:border-accent ${className}`}
        {...rest}
      />
      {hint ? <span className="mt-1 block text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}
