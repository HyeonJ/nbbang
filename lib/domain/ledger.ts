export type LedgerType = 'DUES_PAYMENT' | 'EXPENSE' | 'REVERSAL';

export type LedgerEntryLike = {
  id: string;
  type: LedgerType;
  /** 부호 있는 정수 원. 수입 +, 지출 −. */
  amount: number;
  reversalOf: string | null;
};

export class LedgerRuleError extends Error {
  constructor(public code: 'INVALID_AMOUNT' | 'ALREADY_REVERSED' | 'NOT_REVERSIBLE') {
    super(code);
  }
}

/** 사용자가 입력한 양수 금액을 종류에 맞는 부호로 정규화한다. */
export function signedAmount(type: 'DUES_PAYMENT' | 'EXPENSE', input: number): number {
  if (!Number.isInteger(input) || input <= 0) throw new LedgerRuleError('INVALID_AMOUNT');
  return type === 'EXPENSE' ? -input : input;
}

/** 잔액은 저장하지 않는다 — 언제나 원장 합산으로만 구한다 (ADR-001). */
export function balanceOf(entries: readonly LedgerEntryLike[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

/** 역분개 엔트리의 금액 = 대상의 정확한 반대. */
export function reversalAmount(target: LedgerEntryLike): number {
  return -target.amount;
}

/**
 * 역분개 가능 여부. 정정 대상은 **지출뿐**이고, 같은 대상에 두 번은 금지한다.
 * 호출자는 target과 같은 모임으로 스코프된 엔트리를 넘겨야 한다 — 그룹 경계는 액션 레이어가 보장한다.
 *
 * 회비 납부를 막는 이유: 납부 엔트리에는 `dues_payments` 행이 짝으로 붙어 있고, 그 둘을 함께
 * 되돌리는 경로는 `unmarkPaid` 하나다. 여기서 엔트리만 역분개하면 원장은 돈이 빠졌는데 회차는
 * "납부"로 남고, 이후 `unmarkPaid`는 reversal_of 유니크에 걸려 롤백되면서 멱등 성공을 돌려준다 —
 * 그 납부는 다시는 취소되지 않는다.
 */
export function assertReversible(
  target: LedgerEntryLike,
  groupEntries: readonly LedgerEntryLike[],
): void {
  if (target.type !== 'EXPENSE') throw new LedgerRuleError('NOT_REVERSIBLE');
  if (groupEntries.some((e) => e.reversalOf === target.id)) throw new LedgerRuleError('ALREADY_REVERSED');
}
