import { describe, it, expect } from 'vitest';
import { isForeignKeyViolation, isUniqueViolation } from '@/lib/db/errors';

/** drizzle-orm 0.45가 드라이버 에러를 DrizzleQueryError로 감싼 모양. 최상위 code는 없고 cause에 있다. */
const wrapped = (pg: { code: string; constraint?: string }) =>
  Object.assign(new Error('Failed query'), { cause: pg });

describe('isUniqueViolation', () => {
  it('드라이버 에러가 그대로 올라온 경우를 인식한다', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });
  it('DrizzleQueryError가 cause로 감싼 경우도 인식한다', () => {
    expect(isUniqueViolation(wrapped({ code: '23505' }))).toBe(true);
  });
  it('cause가 있어도 다른 코드면 유니크 위반이 아니다', () => {
    expect(isUniqueViolation(wrapped({ code: '23503' }))).toBe(false);
  });
  it('무관한 에러는 false다', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
  it('제약 이름을 넘기면 그 제약의 위반만 참이다', () => {
    const e = wrapped({ code: '23505', constraint: 'ledger_entries_reversal_of_unique' });
    expect(isUniqueViolation(e, 'ledger_entries_reversal_of_unique')).toBe(true);
    expect(isUniqueViolation(e, 'dues_payments_round_membership')).toBe(false);
  });
});

describe('isForeignKeyViolation', () => {
  it('드라이버 에러가 그대로 올라온 경우를 인식한다', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
  });
  it('DrizzleQueryError가 cause로 감싼 경우도 인식한다', () => {
    expect(isForeignKeyViolation(wrapped({ code: '23503' }))).toBe(true);
  });
  it('유니크 위반은 FK 위반이 아니다', () => {
    expect(isForeignKeyViolation(wrapped({ code: '23505' }))).toBe(false);
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
  });
  it('무관한 에러는 false다', () => {
    expect(isForeignKeyViolation(new Error('boom'))).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
  it('제약 이름을 넘기면 그 제약의 위반만 참이다 — 이름이 다르면 다른 불변식이다', () => {
    // 같은 23503을 dues_payments의 복합 FK 세 개가 각각 낸다. 이름을 안 좁히면
    // "회차가 타 모임"과 "멤버십이 타 모임"을 구별하지 못한다.
    const e = wrapped({ code: '23503', constraint: 'dues_payments_membership_fk' });
    expect(isForeignKeyViolation(e, 'dues_payments_membership_fk')).toBe(true);
    expect(isForeignKeyViolation(e, 'dues_payments_round_fk')).toBe(false);
  });
  it('제약 이름을 요구했는데 에러에 이름이 없으면 false다', () => {
    expect(isForeignKeyViolation(wrapped({ code: '23503' }), 'dues_payments_round_fk')).toBe(false);
  });
});
