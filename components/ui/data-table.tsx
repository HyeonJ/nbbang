import type { ReactNode } from 'react';

/** 카드가 아니라 표. 2px 블랙 상단 괘선이 표의 시작을 긋고, 행은 1px hairline으로 나눈다. */
export function DataTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <table className={`w-full border-collapse border-t-2 border-ink text-[14px] ${className}`}>
      {/* tbody를 명시한다 — <table>의 직계 자식으로 <tr>을 두면 React가 DOM 중첩 경고를 낸다. */}
      <tbody>{children}</tbody>
    </table>
  );
}

export function Row({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <tr className="border-b border-hairline" data-testid={testId}>
      {children}
    </tr>
  );
}

export function Cell({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return <td className={`py-3 ${align === 'right' ? 'text-right' : ''} ${className}`}>{children}</td>;
}
