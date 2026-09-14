/**
 * drizzle는 드라이버 에러를 DrizzleQueryError로 감싸고 원본을 cause에 둔다.
 * 최상위 code(드라이버 에러가 그대로 온 경우)와 cause.code(감싸인 경우)를 모두 본다.
 * catch 블록에서 불리므로 nullish 입력에도 던지지 않아야 한다 — `throw null`도 문법상 가능하다.
 */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}
