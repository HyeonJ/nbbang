'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '', label: '개요' },
  { href: '/dues', label: '회비' },
  { href: '/expenses', label: '지출' },
  // 정산은 열람이 누구나이므로 필터 없이 전원에게 보인다 — 만들기 권한만 총무로 좁힌다(F4).
  { href: '/settle', label: '정산' },
  { href: '/settings', label: '설정' },
] as const;

/**
 * 확정안 A — 모임 내 이동은 상단 탭. 현재 경로로 활성 탭을 판정한다.
 * 설정 탭은 총무에게만 보인다(Plan 01의 settings-link 가시성 규칙을 탭으로 옮긴 것).
 * 그래서 설정 탭에는 기존 testid `settings-link`를 그대로 부여해 E2E를 깨지 않는다.
 *
 * 활성 표시는 오렌지 밑줄(3px, 비텍스트 요소라 3:1로 충분)과 글자색(muted → ink)을
 * 함께 바꿔 색 하나에만 의존하지 않는다. aria-current로 스크린리더에도 알린다.
 */
export function GroupTabs({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const pathname = usePathname();
  const base = `/groups/${groupId}`;
  return (
    <nav aria-label="모임 메뉴" className="flex gap-5 border-b border-hairline">
      {TABS.filter((t) => isOwner || t.href !== '/settings').map((t) => {
        const href = `${base}${t.href}`;
        const active = t.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={active ? 'page' : undefined}
            data-testid={t.href === '/settings' ? 'settings-link' : `tab-${t.label}`}
            className={`-mb-px border-b-[3px] py-3 text-[13.5px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
