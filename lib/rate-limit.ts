import { neon } from '@neondatabase/serverless';

/**
 * 고정 윈도 레이트 리밋 — 원자적 upsert 한 문장.
 *
 * ── 왜 실행기를 주입받는가 (외부 리뷰 블로커 2) ─────────────────────────────────
 * 이 모듈의 핵심 정책은 **fail-open**이다: 카운터를 못 쓰면 통과시킨다. 그런데 함수가
 * 자기 커넥션을 직접 만들면 "쓰기가 실패하는 상황"을 테스트에서 만들 수 없어 **정책이
 * 한 번도 검증되지 않는다.** 실행기를 인자로 받으면 던지는 실행기를 주입해 정책 자체를
 * 빨갛게/초록으로 만들 수 있다. 앱은 `checkRateLimit`(기본 실행기 주입본)을 쓴다.
 *
 * ── 엣지 런타임 제약 ────────────────────────────────────────────────────────────
 * 이 코드는 `middleware.ts`에서 불리므로 **엣지 런타임**에서 돈다. `lib/db/index.ts`의
 * `neon-serverless` Pool은 WebSocket(`ws`)에 의존해 여기서 쓸 수 없다. 그래서 fetch 기반
 * `neon()` HTTP 드라이버를 쓴다 — 이 레포가 이미 `scripts/`와 `test/db-guard.ts`에서
 * 쓰는 것과 같다. 트랜잭션이 필요 없으므로(한 문장 upsert다) HTTP로 충분하다.
 */

/** `(query, params) => rows`. neon HTTP의 `sql.query`와 같은 모양이다. */
export type SqlExecutor = (query: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * 카운터 증가와 윈도 리셋을 **한 문장**으로 한다.
 *
 * `select` → 판정 → `update`로 쪼개면 동시 요청이 같은 값을 읽어 한도를 넘겨 새어 나간다.
 * `insert ... on conflict do update`는 충돌 시 행 잠금을 잡고 **갱신된 최신 행**을 기준으로
 * 다시 평가하므로, 이 한 문장이 곧 원자적 증가다.
 * (실측: 한 버킷에 25개 동시 요청 → 돌아온 count가 중복 없이 정확히 1..25.)
 *
 * `Retry-After`를 **SQL 안에서** 계산하는 이유(리뷰 IMPORTANT 7): `window_start`는 DB의
 * `now()`로 찍히는데 남은 시간을 앱의 `Date.now()`로 재면 두 시계의 차이가 그대로 오차가 된다
 * (Neon과 Vercel 함수는 다른 기계다). 음수나 과대값이 `Retry-After`에 실리면 클라이언트가
 * 즉시 재시도하거나 영원히 기다린다.
 *
 * ── `returning`의 `window_start`는 **갱신 후** 값이다 (실측으로 확인) ────────────
 * 플랜은 "갱신 전 값일 수 있으니 확인하고 아니면 `excluded`로 바꾸라"고 경고했다. 실측 결과
 * **갱신 후 값이 맞다** — `window_start`를 10분 전으로 밀어 만료 상태를 만든 뒤 호출하니
 * `retry_after_seconds`가 **60**으로 돌아왔다(갱신 전 값을 봤다면 `greatest(1, 음수)` = 1이
 * 나왔을 것이다). 돌아온 `window_start`도 호출 후 실제 행과 정확히 일치했다.
 * 참고로 플랜이 제시한 대안은 애초에 불가능하다: `returning` 절에서 `excluded`를 참조하면
 * Postgres가 `invalid reference to FROM-clause entry for table "excluded"`로 거부한다.
 *
 * `$2::float8` 캐스트가 필요한 이유: `make_interval(secs => ...)`은 `double precision`을
 * 받는데 드라이버가 파라미터를 타입 없이 보내면 Postgres가 인자 타입을 정하지 못한다.
 */
const UPSERT = `
insert into rate_limits (bucket, count, window_start)
values ($1, 1, now())
on conflict (bucket) do update set
  count = case when rate_limits.window_start < now() - make_interval(secs => $2::float8)
               then 1 else rate_limits.count + 1 end,
  window_start = case when rate_limits.window_start < now() - make_interval(secs => $2::float8)
                      then now() else rate_limits.window_start end
returning count,
  greatest(1, ceil(extract(epoch from
    (rate_limits.window_start + make_interval(secs => $2::float8)) - now())))::int as retry_after_seconds
`;

export function createRateLimiter(exec: SqlExecutor) {
  return async function checkRateLimit(
    bucket: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision> {
    let rows: Record<string, unknown>[];
    try {
      rows = await exec(UPSERT, [bucket, windowSeconds]);
    } catch (error) {
      // fail-open. 장부를 못 보게 하는 것보다 레이트 리밋이 잠깐 없는 게 낫다.
      // 조용히 삼키지는 않는다 — 로그가 없으면 제한이 꺼진 사실을 아무도 모른다.
      console.error('[rate-limit] 카운터 쓰기 실패 — fail-open으로 통과시킨다', error);
      return { allowed: true };
    }

    const count = Number(rows[0]?.count);
    if (!Number.isFinite(count)) {
      console.error('[rate-limit] 카운터 응답을 해석할 수 없다 — fail-open으로 통과시킨다', rows[0]);
      return { allowed: true };
    }
    if (count <= limit) return { allowed: true };

    // SQL이 이미 `greatest(1, ...)`로 하한을 잡지만, 해석 실패 시 윈도 전체로 떨어진다.
    // 상한을 윈도로 자르는 이유: 고정 윈도에서 남은 시간이 윈도를 넘을 수는 없으므로,
    // 넘는 값이 왔다면 그것은 시계·타입 이상이고 그때 Retry-After를 믿으면 안 된다.
    const raw = Number(rows[0]?.retry_after_seconds);
    const retryAfterSeconds = Number.isFinite(raw) && raw >= 1
      ? Math.min(Math.ceil(raw), windowSeconds)
      : windowSeconds;
    return { allowed: false, retryAfterSeconds };
  };
}

/**
 * 기본 실행기. `neon()`을 **호출마다** 만든다 — HTTP 드라이버는 상태가 없어 싸고,
 * 모듈 로드 시점에 만들면 `DATABASE_URL`을 그 시점에 못 읽는 환경에서 조용히 깨진다.
 */
const defaultExec: SqlExecutor = (query, params) => {
  const sql = neon(process.env.DATABASE_URL!);
  return sql.query(query, params) as Promise<Record<string, unknown>[]>;
};

export const checkRateLimit = createRateLimiter(defaultExec);
