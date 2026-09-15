/**
 * Postgres 에러 판별. 두 가지 모양을 모두 받아야 한다 —
 * drizzle는 드라이버 에러를 DrizzleQueryError로 감싸고 원본을 `cause`에 두지만,
 * 드라이버 에러가 그대로 올라오는 경로도 있다(neon http 등).
 * catch 블록에서 불리므로 nullish 입력에도 던지지 않아야 한다 — `throw null`도 문법상 가능하다.
 */
type PgErrorLike = { code?: string; constraint?: string };

/** 최상위에 code가 있으면 그것이 드라이버 에러다. 없으면 감싸인 것으로 보고 cause를 본다. */
function pgError(e: unknown): PgErrorLike {
  const top = (e ?? {}) as PgErrorLike & { cause?: PgErrorLike };
  if (top.code !== undefined) return top;
  return top.cause ?? {};
}

/**
 * `constraint`를 넘기면 **그 제약**의 위반만 참이다.
 *
 * 이름을 좁히는 것이 왜 중요한가: 같은 SQLSTATE를 여러 제약이 낸다. `ledger_entries`에는
 * `ledger_entries_reversal_of_unique`(한 엔트리는 한 번만 역분개)와
 * `ledger_entries_reversal_fk`(역분개 대상은 같은 모임의 실재 엔트리)가 함께 걸려 있고,
 * 둘은 **다른 불변식**이다. 코드만 보는 단언은 엉뚱한 제약이 막아도 통과해 버린다.
 */
function violates(e: unknown, code: string, constraint?: string): boolean {
  const err = pgError(e);
  if (err.code !== code) return false;
  return constraint === undefined || err.constraint === constraint;
}

/** 23505 — 유니크 위반. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  return violates(e, '23505', constraint);
}

/** 23503 — 외래키 위반. 복합 FK가 모임 경계를 막았는지 이름으로 확인할 때 constraint를 넘긴다. */
export function isForeignKeyViolation(e: unknown, constraint?: string): boolean {
  return violates(e, '23503', constraint);
}
