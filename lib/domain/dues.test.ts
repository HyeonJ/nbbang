import { describe, it, expect } from 'vitest';
import { unpaidMembers, roundTotals, parsePeriod, DuesRuleError } from '@/lib/domain/dues';

const members = [
  { membershipId: 'm1', displayName: '민지' },
  { membershipId: 'm2', displayName: '철수' },
  { membershipId: 'm3', displayName: '영희' },
];

/** 액션은 DuesRuleError.code를 그대로 ActionError로 올린다 — 코드 값 자체가 계약이다. */
const thrownCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as DuesRuleError).code;
  }
  throw new Error('규칙 위반을 던지지 않았다');
};

describe('unpaidMembers', () => {
  it('납부 기록이 없는 멤버만 골라낸다', () => {
    expect(unpaidMembers(members, ['m2'])).toEqual([
      { membershipId: 'm1', displayName: '민지' },
      { membershipId: 'm3', displayName: '영희' },
    ]);
  });
  it('전원 납부면 빈 배열이다', () => {
    expect(unpaidMembers(members, ['m1', 'm2', 'm3'])).toEqual([]);
  });
  it('명단 순서를 그대로 지킨다 — 미납 복붙 문구(F6)가 매번 같은 순서로 나와야 한다', () => {
    const shuffled = [
      { membershipId: 'm3', displayName: '철수' },
      { membershipId: 'm1', displayName: '민지' },
      { membershipId: 'm2', displayName: '영희' },
    ];
    expect(unpaidMembers(shuffled, []).map((m) => m.membershipId)).toEqual(['m3', 'm1', 'm2']);
  });
  it('명단에 없는 납부 id는 무시한다 — 탈퇴한 멤버의 납부 기록이 남아 있어도 화면은 떠야 한다', () => {
    expect(unpaidMembers(members, ['m2', 'm9-탈퇴']).map((m) => m.membershipId)).toEqual(['m1', 'm3']);
  });
  it('입력 명단을 변형하지 않는다 — 회차 화면은 같은 배열로 전체 명단도 함께 그린다', () => {
    const input = [...members];
    const result = unpaidMembers(input, ['m2']);
    expect(input).toHaveLength(3);
    expect(result).not.toBe(input);
  });
});

describe('roundTotals', () => {
  it('예상 총액·수납액·미납액을 계산한다', () => {
    expect(roundTotals(20000, 3, ['m1', 'm2'])).toEqual({ expected: 60000, collected: 40000, outstanding: 20000 });
  });
});

describe('parsePeriod', () => {
  it('YYYY-MM을 받아 그대로 돌려준다', () => {
    expect(parsePeriod('2026-01')).toBe('2026-01');
  });
  it('형식이 어긋나면 규칙 위반이다', () => {
    expect(() => parsePeriod('2026-1')).toThrow(DuesRuleError);
    expect(() => parsePeriod('2026-13')).toThrow(DuesRuleError);
  });
  it('0월도 13월과 같이 막는다 — 월은 01~12뿐이다', () => {
    expect(() => parsePeriod('2026-00')).toThrow(DuesRuleError);
    expect(parsePeriod('2026-12')).toBe('2026-12');
  });
  it('앞뒤에 뭐가 붙으면 규칙 위반이다 — 기간은 유니크 키라 공백조차 다른 회차가 된다', () => {
    // 날짜 입력(YYYY-MM-DD)이나 붙여넣기 공백이 그대로 넘어오는 경로를 막는다.
    // 다듬어(trim) 통과시키지 않고 거절한다 — 총무가 만든 기간과 저장된 기간이 늘 같아야 한다.
    for (const bad of ['2026-01-01', '26-01', ' 2026-01', '2026-01 ', '', '2026-0a']) {
      expect(() => parsePeriod(bad)).toThrow(DuesRuleError);
    }
  });
  it('거절 사유는 INVALID_PERIOD 코드로 올라간다', () => {
    expect(thrownCode(() => parsePeriod('2026-13'))).toBe('INVALID_PERIOD');
  });
});
