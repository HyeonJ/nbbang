import { describe, it, expect } from 'vitest';
import {
  balanceOf, signedAmount, reversalAmount, assertReversible, LedgerRuleError,
  type LedgerEntryLike,
} from '@/lib/domain/ledger';

const entry = (o: Partial<LedgerEntryLike>): LedgerEntryLike => ({
  id: 'e1', type: 'EXPENSE', amount: -1000, reversalOf: null, ...o,
});

/** 액션은 LedgerRuleError.code를 그대로 ActionError로 올린다 — 코드 값 자체가 계약이다. */
const thrownCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as LedgerRuleError).code;
  }
  throw new Error('규칙 위반을 던지지 않았다');
};

describe('signedAmount', () => {
  it('회비 납부는 양수, 지출은 음수로 정규화한다', () => {
    expect(signedAmount('DUES_PAYMENT', 20000)).toBe(20000);
    expect(signedAmount('EXPENSE', 20000)).toBe(-20000);
  });
  it('0 이하 입력은 규칙 위반이다', () => {
    expect(() => signedAmount('EXPENSE', 0)).toThrow(LedgerRuleError);
    expect(() => signedAmount('EXPENSE', -1)).toThrow(LedgerRuleError);
  });
  it('정수가 아닌 금액은 규칙 위반이다 — 금액은 정수 원 단위다(ADR-001)', () => {
    expect(() => signedAmount('EXPENSE', 1000.5)).toThrow(LedgerRuleError);
    expect(() => signedAmount('DUES_PAYMENT', 20000.01)).toThrow(LedgerRuleError);
    expect(thrownCode(() => signedAmount('EXPENSE', 1000.5))).toBe('INVALID_AMOUNT');
  });
});

describe('reversalAmount', () => {
  it('수입 엔트리의 역분개는 음수다 — 납부 취소가 잔액을 되돌린다', () => {
    expect(reversalAmount(entry({ type: 'DUES_PAYMENT', amount: 20000 }))).toBe(-20000);
  });
  it('대상과 역분개의 합은 부호와 무관하게 0이다', () => {
    const dues = entry({ type: 'DUES_PAYMENT', amount: 20000 });
    const expense = entry({ amount: -96000 });
    expect(dues.amount + reversalAmount(dues)).toBe(0);
    expect(expense.amount + reversalAmount(expense)).toBe(0);
  });
});

describe('balanceOf', () => {
  it('부호 있는 금액을 그대로 합산한다', () => {
    expect(balanceOf([entry({ amount: 360000 }), entry({ amount: -96000 }), entry({ amount: -52000 })])).toBe(212000);
  });
  it('빈 원장의 잔액은 0이다', () => {
    expect(balanceOf([])).toBe(0);
  });
  it('엔트리와 그 역분개의 합은 0이다', () => {
    const target = entry({ id: 'a', amount: -96000 });
    const rev = entry({ id: 'r', type: 'REVERSAL', amount: reversalAmount(target), reversalOf: 'a' });
    expect(balanceOf([target, rev])).toBe(0);
  });
});

describe('assertReversible', () => {
  it('평범한 엔트리는 역분개할 수 있다', () => {
    expect(() => assertReversible(entry({ id: 'a' }), [])).not.toThrow();
  });
  it('이미 역분개된 엔트리는 다시 역분개할 수 없다', () => {
    const target = entry({ id: 'a' });
    const existing = [entry({ id: 'r', type: 'REVERSAL', amount: 1000, reversalOf: 'a' })];
    expect(() => assertReversible(target, existing)).toThrow(LedgerRuleError);
  });
  it('역분개 엔트리 자체는 역분개 대상이 아니다', () => {
    const rev = entry({ id: 'r', type: 'REVERSAL', reversalOf: 'a' });
    expect(() => assertReversible(rev, [])).toThrow(LedgerRuleError);
  });
  it('다른 엔트리를 가리키는 역분개는 이 엔트리를 막지 않는다', () => {
    const target = entry({ id: 'b' });
    const otherReversal = entry({ id: 'r', type: 'REVERSAL', amount: 1000, reversalOf: 'a' });
    expect(() => assertReversible(target, [entry({ id: 'a' }), otherReversal])).not.toThrow();
  });
  it('두 거절 사유는 서로 다른 코드로 구분된다', () => {
    const target = entry({ id: 'a' });
    const existing = [entry({ id: 'r', type: 'REVERSAL', amount: 1000, reversalOf: 'a' })];
    expect(thrownCode(() => assertReversible(target, existing))).toBe('ALREADY_REVERSED');
    expect(thrownCode(() => assertReversible(entry({ type: 'REVERSAL', reversalOf: 'a' }), []))).toBe('NOT_REVERSIBLE');
  });
});
