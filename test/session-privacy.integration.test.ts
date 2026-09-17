import { describe, it, expect } from 'vitest';
import { betterAuth } from 'better-auth';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auth, authOptions } from '@/lib/auth';
import { session } from '@/lib/db/schema';

/**
 * 세션 행의 **접속 IP·User-Agent 미보관**과 **로그인 레이트 리밋 발동**을 한 파일에서 고정한다
 * (Plan 04 Task 5).
 *
 * ── 왜 둘이 같은 파일에 있는가 ───────────────────────────────────────────────
 * 이 둘은 독립된 요구가 아니라 **서로를 무너뜨릴 수 있는 한 쌍**이다. Better Auth가 세션 행에
 * 평문 IP를 적는 것을 끄는 공식 스위치(`advanced.ipAddress.disableIpTracking`)는 같은 플래그로
 * 레이트 리밋 판정까지 버린다(`api/rate-limiter/index.mjs:240`). 그래서 "IP를 안 적는다"만
 * 단언하는 테스트는 **그 스위치로 갈아타도 초록**이고, 그 순간 가입·로그인 제한이 조용히
 * 사라진다. 두 단언이 같이 있어야 `lib/auth.ts`가 고른 해법(`databaseHooks`)이 지켜진다.
 *
 * ── 왜 `authOptions`를 그대로 쓰는가 ────────────────────────────────────────
 * `rateLimit.enabled`의 기본값은 `isProduction`이라 테스트 환경에서는 **꺼져 있다**. 그래서
 * 이 파일은 `lib/auth.ts`의 설정 객체를 그대로 받아 `enabled: true`만 얹은 인스턴스를 만든다.
 * 설정을 여기서 다시 적으면 그 테스트는 `lib/auth.ts`가 아니라 자기 자신을 검사하게 된다 —
 * 실제로 `disableIpTracking`을 켜는 회귀는 `authOptions`를 거쳐야만 잡힌다.
 */

const PASSWORD = 'password123!';
const UA = 'SessionPrivacyProbe/1.0';

function uniqueEmail(tag: string) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

/** `getIP`가 실제로 읽는 형태 — 항목이 둘 이상이면 코어가 `null`을 돌려준다(단일 값만 신뢰). */
function probeHeaders(ip: string) {
  return new Headers({ 'x-forwarded-for': ip, 'user-agent': UA });
}

async function signUpWith(
  instance: { api: { signUpEmail: typeof auth.api.signUpEmail } },
  email: string,
  ip: string,
) {
  const res = await instance.api.signUpEmail({
    body: { name: '세션검사', email, password: PASSWORD },
    headers: probeHeaders(ip),
    asResponse: true,
  });
  expect(res.status, `가입 실패: ${await res.clone().text()}`).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  return body.user.id;
}

async function latestSessionRow(userId: string) {
  const rows = await db
    .select({ ipAddress: session.ipAddress, userAgent: session.userAgent })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(desc(session.createdAt));
  expect(rows.length, '세션 행이 생기지 않았다 — 이 테스트가 볼 대상이 없다').toBeGreaterThan(0);
  return rows[0]!;
}

describe('세션 행은 접속 IP·User-Agent를 보관하지 않는다', () => {
  it('진짜 가입으로 만들어진 세션 행의 ip_address·user_agent가 비어 있다', async () => {
    const userId = await signUpWith(auth, uniqueEmail('privacy'), '203.0.113.11');

    const row = await latestSessionRow(userId);
    expect(row.ipAddress, 'session.ip_address에 값이 남았다').toBeNull();
    expect(row.userAgent, 'session.user_agent에 값이 남았다').toBeNull();
  });

  /**
   * 위 단언이 **헛돌지 않음**을 증명하는 대조군(규칙 4). 훅을 뺀 인스턴스가 같은 헤더로
   * 가입하면 두 컬럼이 채워진다 — 즉 ① 헤더가 정말 `getIP`까지 도달하고 ② 값을 비우는 주체가
   * `lib/auth.ts`의 `databaseHooks`라는 것이 함께 드러난다. 이 대조군이 없으면 "헤더를 아무도
   * 안 읽어서 비어 있었다"와 구별되지 않는다.
   */
  it('훅을 뺀 설정은 같은 헤더로 두 컬럼을 채운다 — 비우는 주체가 훅임을 구별한다', async () => {
    const withoutHook = betterAuth({ ...authOptions, databaseHooks: {} });
    const userId = await signUpWith(withoutHook, uniqueEmail('nohook'), '203.0.113.12');

    const row = await latestSessionRow(userId);
    expect(row.ipAddress, '훅이 없는데도 ip_address가 비어 있다 — 대조군이 성립하지 않는다').toBe(
      '203.0.113.12',
    );
    expect(row.userAgent, '훅이 없는데도 user_agent가 비어 있다').toBe(UA);
  });
});

describe('로그인 레이트 리밋은 여전히 IP별로 발동한다', () => {
  /**
   * `lib/auth.ts`의 `customRules['/sign-in/email']`과 같은 값이어야 한다. 손으로 적지 않고
   * 설정에서 읽어 온다 — 값이 바뀌면 이 테스트가 따라간다.
   */
  const rule = authOptions.rateLimit.customRules['/sign-in/email'];

  /** 존재하지 않는 계정으로 두드린다 — 판정은 핸들러보다 **앞**에서 일어나므로 401도 카운트된다. */
  async function signInAttempt(
    instance: { handler: typeof auth.handler },
    ip: string,
  ): Promise<number> {
    const res = await instance.handler(
      new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
          'user-agent': UA,
        },
        body: JSON.stringify({ email: uniqueEmail('absent'), password: PASSWORD }),
      }),
    );
    if (res.status === 429) {
      expect(res.headers.get('x-retry-after'), '429에 재시도 안내가 없다').toBeTruthy();
    }
    return res.status;
  }

  it(`같은 IP로 ${rule.max}회까지 통과하고 ${rule.max + 1}회째가 429다`, async () => {
    const limited = betterAuth({
      ...authOptions,
      rateLimit: { ...authOptions.rateLimit, enabled: true },
    });
    // 버킷 키는 `<ip>|<path>`다 — 테스트마다 다른 IP를 써야 앞 테스트의 카운터를 물려받지 않는다.
    const ip = '203.0.113.21';

    const statuses: number[] = [];
    for (let i = 0; i < rule.max + 1; i += 1) {
      statuses.push(await signInAttempt(limited, ip));
    }

    expect(
      statuses.slice(0, rule.max),
      `한도 안의 ${rule.max}회 중 429가 있다: ${statuses.join(',')}`,
    ).not.toContain(429);
    expect(statuses[rule.max], `${rule.max + 1}회째가 막히지 않았다: ${statuses.join(',')}`).toBe(
      429,
    );
  });

  /**
   * **이 단언이 `disableIpTracking` 회귀를 잡는 자리다.** 그 플래그를 켜면 `getIP`가 `null`을
   * 돌려주고 `resolveRateLimitConfig`가 판정 설정을 버리므로 위 테스트의 429가 애초에 나오지
   * 않는다. 그런데 "판정이 IP를 못 읽은" 또 다른 모양(버킷이 `no-trusted-ip` 하나로 뭉치는 것)은
   * 위 테스트를 **통과시킨다** — 그래서 다른 IP가 앞 IP의 카운터에 걸리지 않는 것을 따로 본다.
   */
  it('앞 IP가 한도를 채워도 다른 IP는 막히지 않는다 — 버킷이 뭉치지 않았다', async () => {
    const limited = betterAuth({
      ...authOptions,
      rateLimit: { ...authOptions.rateLimit, enabled: true },
    });
    const saturated = '203.0.113.31';
    const fresh = '203.0.113.32';

    for (let i = 0; i < rule.max + 1; i += 1) {
      await signInAttempt(limited, saturated);
    }
    expect(await signInAttempt(limited, saturated), '포화시킨 IP가 429가 아니다').toBe(429);

    expect(await signInAttempt(limited, fresh), '다른 IP가 앞 IP의 버킷에 걸렸다').not.toBe(429);
  });
});
