import { describe, it, expect } from 'vitest';
import {
  splitEvenly,
  minimalTransfers,
  SettlementRuleError,
  type Share,
  type Transfer,
} from '@/lib/domain/settlement';

/** 액션은 SettlementRuleError.code를 그대로 ActionError로 올린다 — 코드 값 자체가 계약이다. */
const thrownCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as SettlementRuleError).code;
  }
  throw new Error('규칙 위반을 던지지 않았다');
};

const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);
const sumShares = (ss: readonly Share[]) => sum(ss.map((s) => s.amount));
const sumTransfers = (ts: readonly Transfer[]) => sum(ts.map((t) => t.amount));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe('splitEvenly', () => {
  it('나누어떨어지면 균등 분배한다', () => {
    expect(splitEvenly(30000, ['a', 'b', 'c'])).toEqual([
      { membershipId: 'a', amount: 10000 },
      { membershipId: 'b', amount: 10000 },
      { membershipId: 'c', amount: 10000 },
    ]);
  });

  it('나머지는 앞사람부터 1원씩 더 낸다 — 합계는 언제나 총액', () => {
    const shares = splitEvenly(10000, ['a', 'b', 'c']);
    expect(shares.map((s) => s.amount)).toEqual([3334, 3333, 3333]);
    expect(sumShares(shares)).toBe(10000);
  });

  it('나머지가 2원이면 앞 두 사람이 1원씩 더 낸다', () => {
    // 나머지 1원짜리 하나만 보면 "뒤에서부터"와 "앞에서부터"를 구별하지 못하는 경우가 생긴다.
    // 나머지가 2 이상인 사례가 배분 방향을 확정한다.
    expect(splitEvenly(20000, ['a', 'b', 'c']).map((s) => s.amount)).toEqual([6667, 6667, 6666]);
  });

  it('같은 입력은 같은 결과를 낸다', () => {
    expect(splitEvenly(10000, ['a', 'b', 'c'])).toEqual(splitEvenly(10000, ['a', 'b', 'c']));
  });

  it('총액이 인원보다 적으면 뒷사람 부담액은 0원이다 — 합계는 여전히 총액', () => {
    // 1원을 3명이 나누는 극단. 0원 참여자는 정산에서 사라지지 않고(ADR-003 스냅샷)
    // 이체만 생기지 않는다 — 그 규칙을 minimalTransfers 쪽에서 이어서 고정한다.
    const shares = splitEvenly(1, ['a', 'b', 'c']);
    expect(shares.map((s) => s.amount)).toEqual([1, 0, 0]);
    expect(sumShares(shares)).toBe(1);
  });

  it('어떤 총액·인원 조합에서도 분배 합계 = 총액이다 (1원도 생기거나 사라지지 않는다)', () => {
    // 이 스위트의 최상위 불변식. 나머지를 버리거나 두 번 더하는 변형은 전부 여기서 죽는다.
    for (const n of [1, 2, 3, 7, 13, 100]) {
      for (const total of [1, 7, 9999, 10000, 100000, 123457, 100_000_000]) {
        const shares = splitEvenly(total, ids(n));
        expect(shares).toHaveLength(n);
        expect(sumShares(shares)).toBe(total);
        expect(shares.every((s) => s.amount >= 0 && Number.isInteger(s.amount))).toBe(true);
        // 부담액 차이는 최대 1원 — "균등" 분배라는 이름이 뜻하는 바.
        const amounts = shares.map((s) => s.amount);
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('참여자 순서를 그대로 지킨다 — 화면·CSV가 명단 순서로 렌더한다', () => {
    expect(splitEvenly(300, ['c', 'a', 'b']).map((s) => s.membershipId)).toEqual(['c', 'a', 'b']);
  });

  it('참여자가 없으면 규칙 위반이다', () => {
    expect(() => splitEvenly(10000, [])).toThrow(SettlementRuleError);
    expect(thrownCode(() => splitEvenly(10000, []))).toBe('NO_PARTICIPANTS');
  });

  it('금액은 1원 이상의 정수여야 한다', () => {
    for (const bad of [0, -1, -10000, 1000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => splitEvenly(bad, ['a'])).toThrow(SettlementRuleError);
      expect(thrownCode(() => splitEvenly(bad, ['a']))).toBe('INVALID_AMOUNT');
    }
  });

  it('안전 정수 범위를 넘는 총액은 거절한다 — 그 범위 밖에서는 합계 불변식을 지킬 수 없다', () => {
    // Number.isInteger만 보면 2^53+2(=9007199254740994)가 통과하는데, 3명에게 나누면
    // 부동소수 반올림으로 분배 합계가 9007199254740996이 되어 **2원이 생긴다**.
    // 이 함수의 존재 이유가 "1원도 생기지 않는다"이므로, 지킬 수 없는 입력은 받지 않는다.
    expect(thrownCode(() => splitEvenly(2 ** 53 + 2, ['a', 'b', 'c']))).toBe('INVALID_AMOUNT');
    expect(splitEvenly(Number.MAX_SAFE_INTEGER, ['a'])).toEqual([
      { membershipId: 'a', amount: Number.MAX_SAFE_INTEGER },
    ]);
  });

  it('같은 참여자가 두 번 들어오면 규칙 위반이다 — 한 사람은 한 정산에 한 번만 참여한다', () => {
    // 액션은 participantMembershipIds를 중복 제거 없이 넘긴다(Task 6). 그대로 두면
    // 같은 사람 앞으로 Share 두 줄이 나와 settlement_participants 유니크(정산,멤버십)를
    // 23505로 깨뜨린다 — 규칙 위반을 DB 예외가 아니라 도메인 코드로 올린다.
    expect(thrownCode(() => splitEvenly(30000, ['a', 'b', 'a']))).toBe('DUPLICATE_PARTICIPANT');
  });

  it('입력 배열을 변형하지 않는다 — 마법사 화면이 같은 배열로 참여자 명단도 그린다', () => {
    const input = ['a', 'b', 'c'];
    const before = [...input];
    splitEvenly(10000, input);
    expect(input).toEqual(before);
  });
});

describe('minimalTransfers', () => {
  it('선결제자가 받는 쪽이다', () => {
    const shares: Share[] = [
      { membershipId: 'payer', amount: 10000 },
      { membershipId: 'b', amount: 10000 },
      { membershipId: 'c', amount: 10000 },
    ];
    const ts = minimalTransfers(shares, 'payer', 30000);
    expect(ts).toEqual([
      { from: 'b', to: 'payer', amount: 10000 },
      { from: 'c', to: 'payer', amount: 10000 },
    ]);
    expect(sumTransfers(ts)).toBe(20000); // payer 자기 몫은 이체하지 않는다
  });

  it('이체 건수는 인원 미만이고 금액은 모두 양수다', () => {
    const shares: Share[] = [
      { membershipId: 'p', amount: 3334 },
      { membershipId: 'b', amount: 3333 },
      { membershipId: 'c', amount: 3333 },
    ];
    const ts = minimalTransfers(shares, 'p', 10000);
    expect(ts.length).toBeLessThan(shares.length);
    expect(ts.every((t) => t.amount > 0)).toBe(true);
    expect(sumTransfers(ts)).toBe(10000 - 3334);
  });

  it('선결제자가 명단 중간이나 끝에 있어도 자기 자신에게 보내지 않는다', () => {
    // 선결제자 제외를 빼먹은 구현은 첫 번째 사례(맨 앞)만 보면 놓칠 수 있다.
    for (const payer of ['a', 'b', 'c']) {
      const ts = minimalTransfers(splitEvenly(10000, ['a', 'b', 'c']), payer, 10000);
      expect(ts.some((t) => t.from === t.to)).toBe(false);
      expect(ts.some((t) => t.from === payer)).toBe(false);
      expect(ts.every((t) => t.to === payer)).toBe(true);
      expect(ts).toHaveLength(2);
    }
  });

  it('이체 합계 = 총액 − 선결제자 부담액 (나머지가 있는 정산에서도)', () => {
    // 선결제자가 나머지 1원을 더 내는 자리(맨 앞)와 아닌 자리를 모두 지난다.
    for (const n of [1, 2, 3, 7, 13, 100]) {
      for (const total of [1, 7, 10000, 123457, 100_000_000]) {
        const participants = ids(n);
        const shares = splitEvenly(total, participants);
        for (const payer of [participants[0], participants[n - 1]]) {
          const ts = minimalTransfers(shares, payer, total);
          const payerShare = shares.find((s) => s.membershipId === payer)!.amount;
          expect(sumTransfers(ts)).toBe(total - payerShare);
          expect(ts.length).toBeLessThanOrEqual(n - 1);
          expect(ts.every((t) => t.amount > 0 && t.to === payer)).toBe(true);
        }
      }
    }
  });

  it('부담액이 0원인 참여자는 이체를 만들지 않는다 — 0원 이체는 보낼 수 없다', () => {
    // 0원 참여자는 스냅샷(settlement_participants)에는 남고 이체 목록에서만 빠진다.
    const ts = minimalTransfers(
      [
        { membershipId: 'p', amount: 1 },
        { membershipId: 'b', amount: 0 },
        { membershipId: 'c', amount: 0 },
      ],
      'p',
      1,
    );
    expect(ts).toEqual([]);
  });

  it('이체 순서는 참여자 명단 순서를 따른다 — 같은 정산을 두 사람이 봐도 같은 줄 순서다', () => {
    const shares: Share[] = [
      { membershipId: 'c', amount: 100 },
      { membershipId: 'p', amount: 100 },
      { membershipId: 'a', amount: 100 },
    ];
    expect(minimalTransfers(shares, 'p', 300).map((t) => t.from)).toEqual(['c', 'a']);
    expect(minimalTransfers(shares, 'p', 300)).toEqual(minimalTransfers(shares, 'p', 300));
  });

  it('참여자가 1명이면 이체가 없다', () => {
    expect(minimalTransfers([{ membershipId: 'p', amount: 10000 }], 'p', 10000)).toEqual([]);
  });

  it('선결제자가 참여자가 아니면 규칙 위반이다', () => {
    expect(() => minimalTransfers([{ membershipId: 'a', amount: 100 }], 'zzz', 100)).toThrow(
      SettlementRuleError,
    );
    expect(thrownCode(() => minimalTransfers([{ membershipId: 'a', amount: 100 }], 'zzz', 100))).toBe(
      'PAYER_NOT_PARTICIPANT',
    );
  });

  it('참여자가 없으면 규칙 위반이다', () => {
    expect(thrownCode(() => minimalTransfers([], 'p', 100))).toBe('NO_PARTICIPANTS');
  });

  it('부담액 합계가 총액과 다르면 규칙 위반이다 — 호출자가 한쪽만 다시 계산한 경우를 막는다', () => {
    const shares: Share[] = [
      { membershipId: 'p', amount: 5000 },
      { membershipId: 'b', amount: 5000 },
    ];
    expect(thrownCode(() => minimalTransfers(shares, 'p', 10001))).toBe('INVALID_AMOUNT');
    expect(thrownCode(() => minimalTransfers(shares, 'p', 9999))).toBe('INVALID_AMOUNT');
  });

  it('음수 부담액은 규칙 위반이다 — 합계만 맞으면 통과시키면 이체 합계가 조용히 어긋난다', () => {
    // 합계는 10000으로 맞지만 −1000은 이체 목록에서 걸러져(양수만 이체) 사라지고,
    // 이체 합계 = 총액 − 선결제자 부담액이 깨진다. 그 전에 거절한다.
    const shares: Share[] = [
      { membershipId: 'p', amount: 4000 },
      { membershipId: 'b', amount: 7000 },
      { membershipId: 'c', amount: -1000 },
    ];
    expect(thrownCode(() => minimalTransfers(shares, 'p', 10000))).toBe('INVALID_AMOUNT');
  });

  it('부담액이 정수가 아니면 규칙 위반이다', () => {
    const shares: Share[] = [
      { membershipId: 'p', amount: 5000.5 },
      { membershipId: 'b', amount: 4999.5 },
    ];
    expect(thrownCode(() => minimalTransfers(shares, 'p', 10000))).toBe('INVALID_AMOUNT');
  });

  it('같은 참여자가 두 번 들어오면 규칙 위반이다 (선결제자가 두 번인 경우 포함)', () => {
    const dup: Share[] = [
      { membershipId: 'p', amount: 3000 },
      { membershipId: 'b', amount: 3000 },
      { membershipId: 'b', amount: 4000 },
    ];
    expect(thrownCode(() => minimalTransfers(dup, 'p', 10000))).toBe('DUPLICATE_PARTICIPANT');
    const dupPayer: Share[] = [
      { membershipId: 'p', amount: 5000 },
      { membershipId: 'p', amount: 5000 },
    ];
    expect(thrownCode(() => minimalTransfers(dupPayer, 'p', 10000))).toBe('DUPLICATE_PARTICIPANT');
  });

  it('입력 배열을 변형하지 않는다 — 같은 shares로 참여자 스냅샷도 함께 적재한다', () => {
    const shares: Share[] = [
      { membershipId: 'p', amount: 5000 },
      { membershipId: 'b', amount: 5000 },
    ];
    const before = JSON.stringify(shares);
    minimalTransfers(shares, 'p', 10000);
    expect(JSON.stringify(shares)).toBe(before);
  });
});
