import { describe, it, expect } from 'vitest';
import {
  ANONYMOUS_MEMBER_NAME,
  joinDecision,
  MemberRuleError,
  parseDisplayName,
} from '@/lib/domain/member';

const thrownCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as MemberRuleError).code;
  }
  throw new Error('던질 것으로 기대했다');
};

describe('parseDisplayName', () => {
  it('앞뒤 공백을 잘라 저장한다', () => {
    expect(parseDisplayName('  철수 ')).toBe('철수');
  });

  it('공백만 있으면 INVALID_NAME', () => {
    expect(thrownCode(() => parseDisplayName('   '))).toBe('INVALID_NAME');
    expect(thrownCode(() => parseDisplayName(''))).toBe('INVALID_NAME');
  });

  it('파기 표지와 같은 이름은 RESERVED_NAME — 공백을 바꿔 끼워도 같다', () => {
    expect(thrownCode(() => parseDisplayName(ANONYMOUS_MEMBER_NAME))).toBe('RESERVED_NAME');
    expect(thrownCode(() => parseDisplayName(' 탈퇴한 멤버 '))).toBe('RESERVED_NAME');
    expect(thrownCode(() => parseDisplayName('탈퇴한멤버'))).toBe('RESERVED_NAME');
    expect(thrownCode(() => parseDisplayName('탈퇴한  멤버'))).toBe('RESERVED_NAME');
  });

  it('보이지 않는 문자만 있으면 INVALID_NAME', () => {
    expect(thrownCode(() => parseDisplayName('\u200B'))).toBe('INVALID_NAME');
    expect(thrownCode(() => parseDisplayName(' \uFEFF\u200D '))).toBe('INVALID_NAME');
  });

  it('보이지 않는 문자를 끼워도 RESERVED_NAME', () => {
    expect(thrownCode(() => parseDisplayName('탈퇴한\u200B멤버'))).toBe('RESERVED_NAME');
    expect(thrownCode(() => parseDisplayName('탈퇴한 멤버\uFEFF'))).toBe('RESERVED_NAME');
  });

  it('앞뒤의 보이지 않는 문자는 저장하지 않는다', () => {
    expect(parseDisplayName('\u200B철수\uFEFF ')).toBe('철수');
  });

  it('비슷하지만 다른 이름은 통과한다', () => {
    expect(parseDisplayName('탈퇴한 멤버2')).toBe('탈퇴한 멤버2');
  });
});

describe('joinDecision', () => {
  it('멤버십이 없으면 새로 만든다', () => {
    expect(joinDecision(null)).toBe('create');
  });
  it('활동 중이면 이미 멤버다', () => {
    expect(joinDecision({ leftReason: null })).toBe('already');
  });
  it('스스로 나간 사람은 같은 멤버십으로 돌아온다', () => {
    expect(joinDecision({ leftReason: 'left' })).toBe('rejoin');
  });
  it('내보내진 사람과 탈퇴자는 링크로 돌아올 수 없다', () => {
    expect(joinDecision({ leftReason: 'removed' })).toBe('blocked');
    expect(joinDecision({ leftReason: 'withdrawn' })).toBe('blocked');
  });
});
