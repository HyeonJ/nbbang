/**
 * 크론 엔드포인트 인가 — **환경변수 존재를 먼저 확인한다** (외부 리뷰 IMPORTANT 8).
 *
 * `auth === \`Bearer ${process.env.CRON_SECRET}\`` 만 쓰면 `CRON_SECRET`이 설정되지 않은
 * 환경에서 문자열이 `'Bearer undefined'`가 되고, 그 값을 헤더에 적어 보내는 **아무나**
 * 통과한다. 즉 시크릿 미설정이 "잠긴 상태"가 아니라 **누구나 아는 비밀번호**가 된다.
 * 그래서 `!cronSecret`을 먼저 본다 — 미설정은 전부 거부다.
 * (Vercel 공식 예제도 같은 순서다: `if (!cronSecret || authHeader !== ...)`)
 *
 * 순수 함수로 떼어낸 이유는 네 가지 경우(**env 없음 / 헤더 없음 / 틀린 값 / 맞는 값**)를
 * DB도 HTTP도 없이 단위 테스트로 고정할 수 있게 하기 위해서다.
 */
export function isAuthorizedCronRequest(
  authHeader: string | null,
  cronSecret: string | undefined,
): boolean {
  if (!cronSecret) return false;
  if (!authHeader) return false;
  return authHeader === `Bearer ${cronSecret}`;
}
