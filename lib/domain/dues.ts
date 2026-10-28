export class DuesRuleError extends Error {
  constructor(public code: 'INVALID_PERIOD') {
    super(code);
  }
}

export type MemberLike = { membershipId: string; displayName: string };

/** 회차 명단의 한 사람. `left`는 **지금** 모임을 떠났는지다 — 명단에 있었던 사실은 그대로다(스펙 D3). */
export type RosterMember = MemberLike & { left: boolean };

/** 단톡방에 붙는 미납 문구에 넣을 이름. 나간 사람은 그 방에 없다 — 미납은 화면에만 남는다. */
export function noticeNames(unpaid: readonly RosterMember[]): string[] {
  return unpaid.filter((m) => !m.left).map((m) => m.displayName);
}

export function rosterLabel(m: RosterMember): string {
  return m.left ? `${m.displayName} (나감)` : m.displayName;
}

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
 * 입력 명단은 건드리지 않는다 — 회차 화면이 같은 배열로 전체 명단도 함께 그린다.
 */
export function unpaidMembers<T extends MemberLike>(members: readonly T[], paidIds: readonly string[]): T[] {
  const paid = new Set(paidIds);
  return members.filter((m) => !paid.has(m.membershipId));
}

/**
 * 회차 3수치. 수납액은 원장 합산이 아니라 '1인 금액 × 납부 인원'이다 — 회차 화면의 수치는 회차 자체로 닫힌다.
 * `rosterSize`는 **회차 명단** 인원이다. 납부는 명단 안에서만 존재하므로(dues_payments_roster_fk)
 * 미납액은 음수가 될 수 없다.
 */
export function roundTotals(amountPerPerson: number, rosterSize: number, paidIds: readonly string[]) {
  const expected = amountPerPerson * rosterSize;
  const collected = amountPerPerson * paidIds.length;
  return { expected, collected, outstanding: expected - collected };
}
