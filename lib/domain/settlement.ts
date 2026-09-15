export class SettlementRuleError extends Error {
  constructor(
    public code:
      | 'INVALID_AMOUNT'
      | 'NO_PARTICIPANTS'
      | 'PAYER_NOT_PARTICIPANT'
      | 'DUPLICATE_PARTICIPANT',
  ) {
    super(code);
  }
}

/** 참여자 한 명의 부담액. 0원일 수 있다(총액 < 인원) — 그래도 참여자로 남는다 (ADR-003 스냅샷). */
export type Share = { membershipId: string; amount: number };

/** "누가 누구에게 얼마" 한 줄. amount는 언제나 양수다. */
export type Transfer = { from: string; to: string; amount: number };

/** 같은 사람이 한 정산에 두 번 들어오면 부담액이 두 줄로 갈라진다 — 저장 단계(정산,멤버십 유니크)가 아니라 여기서 막는다. */
function assertNoDuplicates(memberIds: readonly string[]): void {
  if (new Set(memberIds).size !== memberIds.length) {
    throw new SettlementRuleError('DUPLICATE_PARTICIPANT');
  }
}

/**
 * 총액을 참여자 수로 나눈다. 나누어떨어지지 않는 나머지는 **앞에서부터 1원씩** 더 낸다 —
 * 무작위로 흘리면 같은 입력에 다른 결과가 나오고(두 사람이 같은 정산을 보고 다르게 읽는다),
 * 버리면 합계가 총액과 어긋난다. 분배 합계 = 총액은 이 함수의 불변식이다.
 *
 * 총액은 **안전 정수**여야 한다. Number.isInteger만 보면 2^53을 넘는 값이 통과하는데,
 * 그 범위에서는 base × 인원 자체가 반올림돼 합계 불변식이 조용히 깨진다
 * (2^53+2를 3명에게 나누면 분배 합계가 2원 더 커진다 — 테스트가 이 값을 고정한다).
 * 지킬 수 없는 입력은 받지 않는다.
 *
 * 입력 배열은 건드리지 않는다 — 마법사 화면이 같은 배열로 참여자 명단도 함께 그린다.
 */
export function splitEvenly(total: number, participantIds: readonly string[]): Share[] {
  if (participantIds.length === 0) throw new SettlementRuleError('NO_PARTICIPANTS');
  if (!Number.isSafeInteger(total) || total <= 0) throw new SettlementRuleError('INVALID_AMOUNT');
  assertNoDuplicates(participantIds);

  const base = Math.floor(total / participantIds.length);
  let remainder = total - base * participantIds.length;
  return participantIds.map((membershipId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { membershipId, amount: base + extra };
  });
}

/**
 * 선결제자(payer)가 총액을 이미 냈다는 전제로, 나머지가 payer에게 보낼 이체 목록을 만든다.
 * 한 사람이 냈으므로 채권자는 payer 한 명뿐이라 이체는 최대 n−1건이고, 상계할 것이 없다.
 * (여러 사람이 나눠 낸 정산은 v1 범위 밖 — 그 경우에만 그리디 상계가 필요해진다. ADR-003)
 *
 * 부담액은 호출자가 splitEvenly로 계산해 넘기지만, 이 함수는 그것을 믿지 않고 다시 검사한다 —
 * 한쪽만 다시 계산한 호출자(총액은 새 값, 부담액은 옛 값)가 합계가 어긋난 정산을 만들 수 있다.
 * 음수 부담액을 그냥 받으면 양수만 이체로 바꾸는 필터에 걸려 조용히 사라지고,
 * 이체 합계 = 총액 − 선결제자 부담액이 깨진다. 그래서 0원 이상의 정수만 받는다.
 *
 * 부담액이 0원인 참여자는 이체를 만들지 않는다 — 0원 이체는 보낼 것이 없다.
 * 그 참여자는 이체 목록에서만 빠지고 참여자 스냅샷에는 남는다.
 */
export function minimalTransfers(
  shares: readonly Share[],
  payerId: string,
  total: number,
): Transfer[] {
  if (shares.length === 0) throw new SettlementRuleError('NO_PARTICIPANTS');
  assertNoDuplicates(shares.map((s) => s.membershipId));
  if (!shares.some((s) => s.membershipId === payerId)) {
    throw new SettlementRuleError('PAYER_NOT_PARTICIPANT');
  }
  if (shares.some((s) => !Number.isSafeInteger(s.amount) || s.amount < 0)) {
    throw new SettlementRuleError('INVALID_AMOUNT');
  }
  if (shares.reduce((n, s) => n + s.amount, 0) !== total) {
    throw new SettlementRuleError('INVALID_AMOUNT');
  }

  return shares
    .filter((s) => s.membershipId !== payerId && s.amount > 0)
    .map((s) => ({ from: s.membershipId, to: payerId, amount: s.amount }));
}
