import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/lib/db';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },

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
});
