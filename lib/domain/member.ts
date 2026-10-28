export class MemberRuleError extends Error {
  constructor(public code: 'INVALID_NAME' | 'RESERVED_NAME') {
    super(code);
  }
}

/**
 * 탈퇴(ADR-004) 시 표시 이름 자리에 들어가는 값. 파기의 표지이므로 살아 있는 사람이 쓰면
 * 공개 장부에서 둘을 구별할 수 없다 — 그래서 이름 입력에서 예약한다.
 * `lib/db/anonymize.ts`가 이 값을 재수출한다(도메인은 DB 모듈을 import하지 않는다).
 */
export const ANONYMOUS_MEMBER_NAME = '탈퇴한 멤버';

const squash = (s: string) => s.replace(/\s+/g, '');

export function parseDisplayName(input: string): string {
  const name = input.trim();
  if (name === '') throw new MemberRuleError('INVALID_NAME');
  // 공백만 바꿔 끼운 변형도 화면에서는 같은 표지로 읽힌다.
  if (squash(name) === squash(ANONYMOUS_MEMBER_NAME)) throw new MemberRuleError('RESERVED_NAME');
  return name;
}

export type LeftReason = 'left' | 'removed' | 'withdrawn';
export type JoinDecision = 'create' | 'already' | 'rejoin' | 'blocked';

/**
 * 초대 링크로 들어온 사람을 어떻게 다룰지 (스펙 D4).
 * 내보내진 사람이 링크로 돌아올 수 있으면 내보내기가 링크 재발급 없이는 의미가 없다.
 */
export function joinDecision(existing: { leftReason: LeftReason | null } | null): JoinDecision {
  if (!existing) return 'create';
  if (existing.leftReason === null) return 'already';
  if (existing.leftReason === 'left') return 'rejoin';
  return 'blocked';
}
