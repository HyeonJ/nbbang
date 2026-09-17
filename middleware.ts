import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, hashIp, rateLimitSalt } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * 공개 장부(`/g/:token`) 레이트 리밋 — 판정과 응답을 **여기서** 한다.
 *
 * ── 왜 페이지가 아니라 미들웨어인가 (외부 리뷰 블로커 1) ─────────────────────────
 * App Router의 `page.tsx`는 서버 컴포넌트라 **임의 상태 코드·헤더를 낼 수 없다.**
 * 플랜 초안은 "429 + `Retry-After` + 한국어 안내"를 페이지에 넣으라고 했는데, 그대로 하면
 * 화면은 그려지지만 응답은 200이고 `Retry-After`도 없다 — 즉 **화면만 있고 제한은 없다.**
 * 판정과 응답을 함께 낼 수 있는 유일한 지점이 미들웨어다.
 *
 * ── 왜 IP당인가 ─────────────────────────────────────────────────────────────────
 * 토큰당으로 걸면 20명짜리 모임이 링크를 동시에 열 때 정상 사용자가 막힌다. 토큰은 128비트라
 * 열거가 불가능하므로 실제 위험은 "유출된 링크의 반복 긁기와 그로 인한 함수 호출 비용"이고,
 * 그건 IP당으로 걸어야 잡힌다.
 *
 * ── 인증 앱 경로는 매처에 넣지 않는다 ────────────────────────────────────────────
 * `/groups/*`는 로그인이 곧 제한이고, 가입·로그인은 better-auth가 이미 경로별로 제한한다
 * (`lib/auth.ts`). 미인증으로 데이터가 나가는 경로는 `/g/`뿐이다.
 *
 * ── `SALT`를 모듈 최상단에서 읽는 이유 ───────────────────────────────────────────
 * `RATE_LIMIT_SALT`가 없으면 여기서 던져 **미들웨어 자체가 실패**한다(= `/g/`가 500).
 * 이것은 의도다: 설정 누락이 "조용히 제한 없음"이 되면 아무도 알아채지 못한다.
 * 매처가 `/g/`로 한정돼 있으므로 이 실패의 영향 범위도 `/g/`로 한정된다.
 * ⚠️ 카운터 **쓰기** 실패는 반대로 fail-open이다(`lib/rate-limit.ts`) — 설정 오류와
 * 런타임 장애를 일부러 다르게 다룬다.
 */

/**
 * 60회/분. 사람이 장부 한 장을 보는 데 필요한 요청은 한 자릿수이므로 정상 사용에는 닿지 않고,
 * 자동화된 반복 긁기는 잡힌다. (고정 윈도라 경계에서 최대 2배 버스트가 가능하다 —
 * 그 한계는 `lib/db/schema.ts`의 `rateLimits` 주석에 적혀 있다.)
 */
const LIMIT = 60;
const WINDOW_SECONDS = 60;

const SALT = rateLimitSalt();

/**
 * 429 응답.
 *
 * ── 세 헤더를 **명시적으로** 붙이는 이유 ────────────────────────────────────────
 * 실측(2026-09-17): `next.config.ts`의 `headers()`가 **미들웨어 단축 응답에도 적용된다** —
 * 명시하지 않아도 429에 세 헤더가 다 붙었다(Next 15.5.25). 그래도 여기서 다시 적는다:
 * 그 동작은 `next.config.ts`의 `source: '/g/:token*'`와 이 파일의 `matcher: '/g/:path*'`가
 * **각각 따로 수정될 수 있는 두 패턴**이라는 사실에 의존한다. 한쪽만 좁혀지면 429가 조용히
 * `Referrer-Policy: no-referrer`를 잃고, 그 순간 이 응답을 받은 브라우저가 다음 요청에
 * `Referer: …/g/<publicToken>`을 실어 **토큰을 흘린다**(Plan 03 Task 8이 변이로 증명한 버그).
 * 중복이 아니라 그 결합을 끊는 것이다. `e2e/rate-limit.spec.ts`가 세 헤더를 단언한다.
 *
 * 본문에 **링크를 두지 않는다** — 이 화면을 받은 사람이 누를 링크가 없으면 리퍼러로 토큰이
 * 나갈 표면 자체가 없다. 외부 리소스(폰트·이미지)도 없다.
 */
function tooManyRequests(retryAfterSeconds: number): NextResponse {
  const html = `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>잠시 후 다시 시도해 주세요 — 엔빵</title>
<style>
  body { margin: 0; background: #ffffff; color: #0a0a0a;
         font-family: ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 48rem; margin: 0 auto; padding: 0 1.25rem 5rem; }
  header { display: flex; align-items: baseline; justify-content: space-between;
           border-bottom: 2px solid #0a0a0a; padding: 1rem 0; }
  .brand { font-size: 1.125rem; font-weight: 700; letter-spacing: -0.01em; }
  .kicker { font-size: 11px; font-weight: 500; letter-spacing: 0.18em;
            text-transform: uppercase; color: #666666; }
  p { padding: 2.5rem 0 0; margin: 0; font-size: 14px; line-height: 1.85; color: #666666; }
</style>
<main>
  <header><span class="brand">엔빵</span><span class="kicker">Group Dues Ledger</span></header>
  <p>요청이 너무 많습니다. ${retryAfterSeconds}초 후에 다시 시도해 주세요.</p>
</main>
</html>`;
  return new NextResponse(html, {
    status: 429,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'retry-after': String(retryAfterSeconds),
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    },
  });
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp(req.headers);
  /**
   * IP를 못 읽으면 **제한하지 않는다.** `'unknown'` 같은 상수로 뭉뚱그리면 IP를 못 읽은 모든
   * 요청이 한 버킷에 들어가고, 한 사람이 그 버킷을 채워 나머지 전체를 잠근다.
   * (프로덕션에서는 Vercel이 `x-forwarded-for`를 항상 채우므로 이 분기는 사실상 오지 않는다 —
   *  `lib/client-ip.ts`의 실측 기록 참고.)
   */
  if (ip === null) return NextResponse.next();

  const bucket = `g:${await hashIp(ip, SALT)}`;
  const decision = await checkRateLimit(bucket, LIMIT, WINDOW_SECONDS);
  if (decision.allowed) return NextResponse.next();
  return tooManyRequests(decision.retryAfterSeconds);
}

export const config = { matcher: ['/g/:path*'] };
