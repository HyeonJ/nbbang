import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/lib/db';

/**
 * 설정을 **값으로 내보내는 이유**는 테스트 하나 때문이다.
 *
 * 이 파일이 지키는 성질 둘(세션 행에 접속 IP를 적지 않는다 · 로그인 레이트 리밋이 실제로
 * 발동한다)은 **서로를 무너뜨릴 수 있는 한 쌍**이다(아래 `databaseHooks` 주석). 그런데
 * `rateLimit.enabled`의 기본값은 `isProduction`이라 테스트 환경에서는 꺼져 있어서, 이
 * 모듈의 `auth`를 그대로 두드려서는 "제한이 아직 살아 있다"를 확인할 수 없다.
 * `test/session-privacy.integration.test.ts`는 **이 객체 그대로** `enabled: true`만 얹은
 * 인스턴스를 만들어 두드린다 — 설정을 테스트가 다시 손으로 적으면 그 테스트는 이 파일이
 * 아니라 자기 자신을 검사하게 된다.
 */
export const authOptions = {
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },

  /**
   * 세션 행에 **접속 IP·User-Agent를 적지 않는다.**
   *
   * ── 무엇을 막는가 (Task 4 실측) ────────────────────────────────────────────
   * Better Auth는 세션을 만들 때 `session` 행에 그 둘을 **평문으로** 적는다
   * (`db/internal-adapter.mjs`: `ipAddress: headers ? getIP(headers, options) || "" : ""`,
   * `userAgent: headers?.get("user-agent") || ""`). 프로덕션에서는 Vercel이
   * `x-forwarded-for`를 실제 IP로 덮어쓰므로 **진짜 접속 IP**가 들어간다. 이 앱에는 그
   * 값을 읽는 코드가 하나도 없다 — 세션 목록·기기 관리 화면이 없기 때문이다. 즉 쓰는
   * 사람도 볼 사람도 없는 개인정보를 모으고 있었다.
   *
   * ── 왜 `advanced.ipAddress.disableIpTracking`이 아닌가 ─────────────────────
   * 그 플래그는 **같은 스위치로 레이트 리밋까지 끈다.** `@better-auth/core`의 `getIP`가
   * 플래그를 보고 **가장 먼저 `null`을 돌려주고**(`utils/ip.mjs`), 그러면
   * `api/rate-limiter/index.mjs:240`의 `if (!ip && disableIpTracking) return null`이
   * **판정 설정 자체를 버린다.** 호출부(`onRequestRateLimit`)는 `null`이면 그대로 반환하므로
   * 아래 `customRules`의 가입·로그인 제한이 **조용히 사라진다.** 개인정보를 줄이려고
   * 미인증 엔드포인트의 유일한 남용 방어를 끄는 것은 교환이 아니라 퇴보다.
   *
   * ── 이 훅이 둘을 동시에 지킨다 ─────────────────────────────────────────────
   * `createSession`은 행을 `createWithHooks(data, 'session', …)`로 쓰고, 그 함수는
   * `create.before`가 돌려준 `{ data }`를 `{ ...actualData, ...result.data }`로 **덮어쓴다**
   * (`db/with-hooks.mjs`). 그래서 여기서 두 값을 비우면 DB에는 남지 않는다. 반면 `getIP`는
   * 건드리지 않았으므로 레이트 리밋은 **그대로 IP별로 판정한다.**
   *
   * `''`가 아니라 `null`을 쓴다 — 두 컬럼 모두 nullable이고(`lib/db/auth-schema.ts`,
   * 코어 스키마도 `z.string().nullish()`), 빈 문자열은 "수집했는데 비어 있었다"로 읽히지만
   * `null`은 "수집하지 않는다"로 읽힌다. 처리방침도 그렇게 적혀 있다.
   *
   * 이 훅을 지우면 `test/session-privacy.integration.test.ts`가 빨개진다. 같은 파일이
   * 반대 방향도 잡는다 — `disableIpTracking`으로 바꿔 끄면 레이트 리밋 테스트가 빨개진다.
   */
  databaseHooks: {
    session: {
      create: {
        before: async () => ({ data: { ipAddress: null, userAgent: null } }),
      },
    },
  },

  /**
   * `user.deleted_at`을 **세션 응답에 실어 보내기 위한 선언**이다 (ADR-004).
   *
   * 어댑터는 `db.select().from(user)`로 행 전체를 읽지만, `parseUserOutput`이 **스키마에
   * 선언된 필드만** 남기고 나머지를 버린다. 그래서 이 선언이 없으면 `getSession`이 돌려주는
   * 사용자 객체에 `deletedAt`이 **조용히 없어지고**, `lib/session.ts`의 탈퇴 차단은
   * `undefined`를 보며 항상 통과한다 — 테스트가 없으면 아무도 모르는 종류의 실패다.
   * (`test/account-delete.integration.test.ts`가 그 상태를 강제로 만들어 확인한다.)
   *
   * 이 방식을 택한 이유: 판정에 **추가 왕복이 없다.** 대안은 세션을 해석할 때마다
   * `select deleted_at from "user"`를 한 번 더 도는 것인데, 인증된 페이지마다 Neon 왕복이
   * 하나씩 붙는다. 어차피 어댑터가 이미 읽어 온 행에 들어 있는 값이다.
   *
   * `input: false` — 가입·프로필 수정 입력으로 이 값을 **설정할 수 없다.** 없으면 클라이언트가
   * 보낸 `deletedAt`이 그대로 저장돼 자기 계정을 탈퇴 상태로 만들거나(자물쇠 아님) 되돌릴 수 있다.
   * 파기의 유일한 쓰기 경로는 `actions/account.ts`의 `deleteAccount`다.
   */
  user: {
    additionalFields: {
      deletedAt: { type: 'date', required: false, input: false },
    },
  },

  /**
   * 레이트리밋 — **끄지 않는다.** 가입·로그인은 미인증 엔드포인트라 남용 방지가 필요하다.
   * 여기서 고치는 건 하나뿐이다: 기본값이 이 제품의 **정상 동선**을 막는다는 것.
   *
   * better-auth 1.7.4는 `/sign-in*`·`/sign-up*`에 **10초 3회**를 기본으로 건다
   * (rate-limiter의 `getDefaultSpecialRules`). 그런데 이 앱의 핵심 온보딩은
   * "총무가 초대 링크 하나를 단체 대화방에 던지고, 멤버 여러 명이 1분 안에 가입"이다.
   * 그 사람들은 같은 사무실·집·카페 와이파이에 앉아 있는 게 보통이라 **공인 IP가 하나**다.
   * 제한 키는 `createRateLimitKey(ip, path)`이므로 IP가 같으면 버킷도 하나 — 기본값 그대로면
   * **4번째 사람부터 429**다. 가설이 아니라 이 제품이 실제로 쓰이는 첫 번째 방식이다.
   *
   * 창이 좁으면 더 나빠지는 이유: 이 제한은 **rolling window**다(`decideConsume`).
   * 카운터는 `now - lastRequest >= window`일 때만 1로 돌아가고 `lastRequest`는 통과한 요청마다
   * 앞으로 밀린다. 즉 요청이 창보다 촘촘히 들어오는 동안은 카운터가 리셋되지 않고, 버킷은
   * "창 하나만큼 조용해진 뒤"에야 풀린다. 10초/3회에선 단체 가입이 시작되는 순간부터 계속
   * 포화 상태로 남는다 — 그래서 좁은 창은 단순히 빡빡한 게 아니라 **누적된다**.
   *
   * 그래서 이 두 경로만 명시 규칙으로 덮는다. `customRules`는 default special rule보다
   * 나중에 적용되어 이긴다(`resolveRateLimitConfig`). 단체 가입 1회분은 통과시키고 자동화된
   * 남용은 계속 막는 크기로 잡았다.
   *
   * IP 해석에 대해: `getIP`는 `x-forwarded-for`만 보고, 못 읽으면 dev/test에서만 localhost로
   * 떨어지며, 프로덕션에서 끝까지 실패하면 키가 `no-trusted-ip|<path>` 하나로 뭉쳐 **서버 전체가
   * 버킷을 공유**한다. 참고로 `next start`는 이 fallback까지 가지 않는다 — Next.js가 소켓 주소로
   * `x-forwarded-for`를 스스로 채우기 때문에 해석은 성공하고, 대신 로컬의 모든 클라이언트가
   * 루프백 한 주소로 수렴해 결과적으로 같은 한 버킷을 쓴다(측정으로 확인). 실배포(Vercel)는 플랫폼이
   * `x-forwarded-for`를 단일 값으로 덮어써 주므로 버킷이 사용자별로 갈린다. `advanced.ipAddress`는
   * 일부러 비워 둔다 — `trustedProxies`를 채우면 better-auth가 전달 체인을 오른쪽부터 걷기
   * 시작하는데, Vercel의 프록시 주소는 고정 공개 목록이 없어 신뢰 범위를 정확히 적을 수 없다.
   * 비워 두면 **단일 값 헤더만** 신뢰하므로(`getIPFromHeader`) 체인 맨 앞을 믿는 전형적 스푸핑
   * 경로가 애초에 열리지 않는다. 그게 이 배포 형태에서 더 안전한 쪽이다.
   */
  rateLimit: {
    // `enabled`는 건드리지 않는다 — 기본값이 `isProduction`(create-context)이라 프로덕션과
    // `next start`에서 켜지고 로컬 dev에선 꺼진다. 아래 규칙은 실제로 도는 곳에서 돈다.
    customRules: {
      // 단체방 온보딩 1회분(10명 안팎)이 1분 안에 들어와도 통과한다.
      '/sign-up/email': { window: 60, max: 10 },
      // 로그인은 조금 더 좁게. 가입은 email 유니크 제약에 막혀 자격증명을 캐낼 수 없지만
      // 로그인은 비밀번호 추측 표면이다. 그래도 같은 와이파이에서 몇 명이 연달아 들어오는
      // 동선은 살려야 하므로 3회가 아니라 8회다.
      '/sign-in/email': { window: 60, max: 8 },
    },
  },
} satisfies BetterAuthOptions;

export const auth = betterAuth(authOptions);
