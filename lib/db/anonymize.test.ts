import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  ANONYMOUS_MEMBER_NAME,
  anonymizedDuesMemo,
  ERASED_APP_WRITTEN_COLUMNS,
  ERASED_IDENTIFIER_COLUMNS,
} from './anonymize';

/**
 * 회비 납부 메모 파기(ADR-004 결정 2(b-1))의 **DB 없이 검사할 수 있는 절반**.
 *
 * 나머지 절반 — 탈퇴 후 그 메모가 실제로 바뀌는가, 취소된 납부까지 바뀌는가, 동명이인의
 * 메모는 그대로인가 — 은 `test/account-delete.integration.test.ts`의 5c가 실제 DB 왕복으로
 * 본다. 그쪽이 본질이고 이 파일은 그 앞의 싼 그물이다. 여기서 고정하는 것은 **SQL의 모양**이고,
 * 그것이 중요한 이유는 둘이다:
 *  1. **기간이 보존된다**는 주장은 `left(memo, 7)`이라는 한 조각에 달려 있다. 누가 그 조각을
 *     지우고 `'탈퇴한 멤버'`로 통째로 덮으면 통합 테스트가 잡지만, 그때는 이미 DB가 필요하다.
 *  2. **이름을 문자열로 찾지 않는다**는 금지 규칙(동명이인·개명)은 "이 SQL에 표시 이름이
 *     나타나지 않는다"로 기계적으로 확인할 수 있다. 사람의 리뷰에 맡길 필요가 없다.
 */
describe('회비 납부 메모 파기 SQL', () => {
  const { sql, params } = new PgDialect().sqlToQuery(anonymizedDuesMemo);

  it('대상 컬럼은 ledger_entries.memo 하나뿐이다 — 다른 테이블을 조인하지 않는다', () => {
    expect(sql).toContain('"ledger_entries"."memo"');
    // 조인이 들어오면 "지목된 행만 다시 쓴다"는 주장이 흔들린다 — 어느 행이 대상인지를
    // 정하는 것은 `subject_membership_id` 키 하나여야 한다.
    expect(sql).not.toContain('memberships');
    expect(sql).not.toContain('dues_payments');
  });

  it('회차 기간(앞 7자)을 남긴다 — 기간은 사람의 식별자가 아니다', () => {
    expect(sql).toContain('left("ledger_entries"."memo", 7)');
    // 형식 판정은 **앱이 쓴 형식**(YYYY-MM + 공백)을 보는 것이고, 거기에 이름은 없다.
    expect(sql).toContain("'^[0-9]{4}-[0-9]{2} '");
  });

  it('바인딩되는 값은 익명 이름뿐이다 — 표시 이름이 SQL에 들어가지 않는다', () => {
    // 형식이 맞는 경우(기간 + 익명 이름)와 아닌 경우(통째로 익명 이름) 둘.
    expect(params).toEqual([ANONYMOUS_MEMBER_NAME, ANONYMOUS_MEMBER_NAME]);
    // 이름으로 찾는 구현이면 비교·LIKE·치환 어딘가에 이름이 **더** 실린다.
    expect(params).toHaveLength(2);
    expect(sql).not.toContain('like');
    expect(sql).not.toContain('replace');
  });

  it('메모가 null인 행에는 아무것도 적지 않는다', () => {
    expect(sql).toContain('is null then null');
  });

  /**
   * 분류의 **배타성**. `ledger_entries.memo`를 `ERASED_IDENTIFIER_COLUMNS`에 넣는 것이
   * 가장 자연스러운 실수이고(이름이 들어 있으니까), 그러면 컬럼째 덮어써서 **사용자가 직접 적은
   * 지출 메모까지 지운다** — ADR-004 결정 2(b-2)가 범위 밖이라고 적은 바로 그 글이다.
   * 통합 테스트 5b도 같은 것을 보지만 그쪽은 DB가 필요하다.
   */
  it('memo는 키 기반 목록에만 있고 컬럼째 파기 목록에는 없다', () => {
    const key = (l: readonly (readonly [string, string])[]) => l.map(([t, c]) => `${t}.${c}`);
    expect(key(ERASED_APP_WRITTEN_COLUMNS)).toContain('ledger_entries.memo');
    expect(
      key(ERASED_IDENTIFIER_COLUMNS),
      'memo가 컬럼째 파기 목록에 올라갔다 — 사용자가 적은 지출 메모까지 지운다',
    ).not.toContain('ledger_entries.memo');
  });
});
