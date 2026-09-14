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

/** 역분개 가능 여부. 같은 대상에 두 번, 역분개의 역분개는 금지한다. */
export function assertReversible(
  target: LedgerEntryLike,
  groupEntries: readonly LedgerEntryLike[],
): void {
  if (target.type === 'REVERSAL') throw new LedgerRuleError('NOT_REVERSIBLE');
  if (groupEntries.some((e) => e.reversalOf === target.id)) throw new LedgerRuleError('ALREADY_REVERSED');
}
