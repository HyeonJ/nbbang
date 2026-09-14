export class DuesRuleError extends Error {
  constructor(public code: 'INVALID_PERIOD') {
    super(code);
  }
}

export type MemberLike = { membershipId: string; displayName: string };

/**
 * 회차 기간은 'YYYY-MM' 문자열로만 다룬다 — 월 단위 비교·정렬이 문자열로 끝난다.
 * 기간은 (모임, 기간) 유니크 키의 절반이라 공백 하나만 붙어도 다른 회차가 된다.
 * 그래서 다듬지(trim) 않고 정확히 어긋난 입력은 거절한다 — 총무가 고른 월과 저장된 월이 늘 같아야 한다.
 */
export function parsePeriod(input: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input)) throw new DuesRuleError('INVALID_PERIOD');
  return input;
}

/**
 * 회차에서 납부 기록이 없는 멤버. 명단 순서를 그대로 지킨다 — 미납 복붙 문구(F6)가 매번 같은 순서로 나와야 한다.
 * 명단에 없는 납부 id(탈퇴 멤버의 기록 등)는 조용히 무시한다 — 화면은 떠야 하고, 판단은 호출자 몫이다.
 * 입력 명단은 건드리지 않는다 — 회차 화면이 같은 배열로 전체 명단도 함께 그린다.
 */
export function unpaidMembers(members: readonly MemberLike[], paidIds: readonly string[]): MemberLike[] {
  const paid = new Set(paidIds);
  return members.filter((m) => !paid.has(m.membershipId));
}

/**
 * 회차 3수치. 수납액은 원장 합산이 아니라 '1인 금액 × 납부 인원'이다 — 회차 화면의 수치는 회차 자체로 닫힌다.
 * 납부 인원이 현재 멤버 수를 넘으면 미납액이 음수가 될 수 있다(예: 납부 후 탈퇴). 표기 판단은 화면에 맡긴다.
 */
export function roundTotals(amountPerPerson: number, memberCount: number, paidIds: readonly string[]) {
  const expected = amountPerPerson * memberCount;
  const collected = amountPerPerson * paidIds.length;
  return { expected, collected, outstanding: expected - collected };
}
