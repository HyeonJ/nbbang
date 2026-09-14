import { describe, it, expect } from 'vitest';
import { isUniqueViolation } from '@/lib/db/errors';

describe('isUniqueViolation', () => {
  it('드라이버 에러가 그대로 올라온 경우를 인식한다', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });
  it('DrizzleQueryError가 cause로 감싼 경우도 인식한다', () => {
    // drizzle-orm 0.45는 드라이버 에러를 DrizzleQueryError로 감싸므로
    // 최상위 code는 undefined이고 원본 code는 cause에 있다.
    const wrapped = Object.assign(new Error('Failed query'), { cause: { code: '23505' } });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });
  it('cause가 있어도 다른 코드면 유니크 위반이 아니다', () => {
    const wrapped = Object.assign(new Error('Failed query'), { cause: { code: '23503' } });
    expect(isUniqueViolation(wrapped)).toBe(false);
  });
  it('무관한 에러는 false다', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
