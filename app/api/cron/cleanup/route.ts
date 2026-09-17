import { neon } from '@neondatabase/serverless';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';

/**
 * 만료된 레이트 리밋 카운터 정리 — **IP 해시의 보관기간을 지키는 유일한 경로**.
 *
 * ── 왜 이 라우트가 있어야 하는가 ─────────────────────────────────────────────────
 * `rate_limits.bucket`은 접속 IP의 HMAC이다. 개인정보를 저장하는 순간 **보관기간이 생기고**,
 * 보관기간이 있으면 파기가 기능의 일부가 된다. 이 라우트가 없으면 다시 찾아오지 않는 IP의
 * 해시가 영구히 쌓인다(다시 오는 IP의 행은 upsert가 덮어써 갱신된다).
 *
 * ── 보관기간: 처리방침에 적을 숫자는 **"최대 48시간"** 이다 ──────────────────────
 * ⚠️ 플랜은 "24시간"이라고 적었지만 **Vercel Hobby에서 24시간은 보장할 수 없다.**
 * 확인한 플랫폼 제약(`vercel.com/docs/cron-jobs/usage-and-pricing`):
 *   · Hobby는 **1일 1회** 크론만 허용한다 — 더 잦은 표현식은 **배포가 실패한다**
 *     ("Hobby accounts are limited to daily cron jobs").
 *   · 실행 시각 정밀도는 **시간 단위(±59분)** — `0 4 * * *`는 04:00~04:59 사이 아무 때나 돈다.
 *   · 개수 제한은 프로젝트당 100개(모든 플랜) — 1개를 쓰는 지금은 여유가 있다.
 *
 * 그래서 실제 최대 수명은 `임계값 + 다음 실행까지의 간격`이다. 임계값을 **1시간**으로 두면
 * 최악의 경우 1h + (24h + 59m) ≈ **약 26시간**이고, 여기에 한 번의 실행 누락
 * (Vercel 문서: "Cron job delivery is best effort … your function does not execute")까지
 * 감안한 **정직한 상한이 48시간**이다. Task 4의 처리방침은 "24시간"이 아니라
 * **"최대 48시간"** 으로 적어야 한다 — 지킬 수 없는 숫자를 적는 것이 더 나쁘다.
 *
 * 임계값을 1시간으로 잡은 이유: 카운터는 윈도(60초)가 지나면 아무 의미가 없다. 1시간은
 * 시계 오차에 대한 여유일 뿐이고, 살아 있는 버킷을 지울 위험이 없다(혹시 지워도 효과는
 * 카운터 리셋 = fail-open 방향이다).
 *
 * ── 멱등성 ────────────────────────────────────────────────────────────────────
 * Vercel 문서는 크론이 **중복 실행될 수 있다**고 명시한다. 이 작업은 "만료된 것을 지운다"는
 * 수렴 연산이라 두 번 돌아도 결과가 같다 — 증분 연산을 넣지 않는다.
 */

/** 크론 요청은 캐시되면 안 된다 — 캐시된 200은 실행되지 않은 채 성공으로 보인다. */
export const dynamic = 'force-dynamic';

const RETENTION_SECONDS = 60 * 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    // 401 본문에 이유를 적지 않는다 — 시크릿 미설정인지 틀린 값인지 알려줄 필요가 없다.
    return new Response('Unauthorized', { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  // `returning 1`이다 — `returning bucket`으로 하면 **IP 해시 목록이 응답 본문에 실린다.**
  // 지운 개수만 필요하다.
  const deleted = await sql.query(
    `delete from rate_limits
     where window_start < now() - make_interval(secs => $1::float8)
     returning 1 as deleted`,
    [RETENTION_SECONDS],
  );

  console.log('[cron/cleanup] rate_limits 정리 deleted=%d', deleted.length);
  return Response.json({ deleted: deleted.length });
}
