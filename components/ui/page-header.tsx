import Link from 'next/link';
import type { ReactNode } from 'react';

type Props = {
  back?: string;
  title: string;
  right?: ReactNode;
  /** E2E가 기존 testid(group-title 등)에 의존하는 화면에서 교체한다. */
  titleTestId?: string;
};

/** 화면 머리 — 2px 블랙 괘선 아래로 제목, 오른쪽에 보조 정보(역할 뱃지·합계 등). */
export function PageHeader({ back, title, right, titleTestId = 'page-title' }: Props) {
  return (
    <header className="flex items-center justify-between border-b-2 border-ink py-4">
      <div className="flex items-baseline gap-3">
        {back ? (
          <Link
            href={back}
            aria-label="뒤로"
            className="font-display -mx-2 px-2 py-2 text-[13px] text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ←
          </Link>
        ) : null}
        <h1 className="text-xl font-black tracking-tight" data-testid={titleTestId}>
          {title}
        </h1>
      </div>
      {right}
    </header>
  );
}

/** 역할 뱃지 — 잉크 채움 + 흰 글자. 시안 헤더 오른쪽의 '총무' 표기. */
export function RoleBadge({ role }: { role: 'owner' | 'member' }) {
  return (
    <span className="font-display bg-ink px-2 py-1 text-[10px] font-bold tracking-[0.14em] text-paper">
      {role === 'owner' ? '총무' : '멤버'}
    </span>
  );
}
