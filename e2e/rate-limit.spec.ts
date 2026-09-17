import { test, expect, type APIRequestContext } from '@playwright/test';
import { createGroup, newClientContext, signUp, testEmail } from './helpers';

/**
 * 공개 장부 레이트 리밋(Plan 04 Task 1) — **한도를 실제로 넘겨서** 본다.
 *
 * ── 왜 별도 파일인가 ────────────────────────────────────────────────────────────
 * 이 스펙은 1분 안에 60회 넘게 `/g/`를 두드린다. `public-ledger.spec.ts`에 붙이면
 * ① 그 파일은 `mode: 'serial'`이라 여기서 실패하면 **유출 검사와 재발급 검사가 스킵**되고
 * ② 이 레포에서 가장 중요한 보안 스펙의 실행 시간에 60회 왕복이 얹힌다.
 * 분리하면 이 스펙이 빨개져도 그 스펙은 자기 판정을 그대로 낸다.
 *
 * ── ⚠️ IP 격리: 이 파일이 자기 자신과 다른 스펙을 막지 않게 하는 방식 ────────────
 * 미들웨어는 **IP당** 60회/분으로 센다. 그래서 스펙·워커마다 IP가 갈려 있지 않으면
 * "자기 테스트가 자기를 막는" 실패가 CI에서만 터진다(가장 그럴듯한 파괴 경로다).
 *
 *  · 브라우저 컨텍스트: `newClientContext`가 **TEST-NET-1**(192.0.2.0/24)에서
 *    `192.0.2.<워커*16 + 순번>`을 준다. 다른 스펙들이 쓰는 대역이다.
 *  · 이 파일의 한도 초과 프로브: **198.18.0.0/15**(RFC 2544 벤치마크 예약 대역)에서
 *    `198.18.<워커>.<프로브>`를 쓴다 — `newClientContext`가 절대 발급하지 않는 대역이므로
 *    브라우저 컨텍스트와 **구조적으로 겹칠 수 없다.** 게다가 프로브마다 **자기 IP**를 쓰므로
 *    이 파일 안의 테스트끼리도 서로를 막지 않는다.
 *
 * ⚠️ 워커·프로브를 **다른 옥텟**에 넣는 이유: 처음에는 한 /24 안에서 `워커*64 + 프로브`로
 * 갈랐는데, 이 레포의 개발 기계가 워커를 5개 이상 띄워 **인덱스 4에서 배정이 넘쳤다**
 * (가드가 실제로 빨개졌다). 워커 수는 CPU에 따라 변하는 값이라 한 옥텟에 접어 넣으면
 * 기계마다 다른 지점에서 깨진다. 옥텟을 나누면 워커 256개 × 프로브 254개까지 겹치지 않는다.
 */

const ORIGIN = 'http://localhost:3000';
const LIMIT = 60;

const WORKER_INDEX = Number(process.env.TEST_PARALLEL_INDEX ?? 0);

/**
 * 이 스펙 전용 IP. **세 번째 옥텟에 워커 인덱스**, 네 번째에 프로브 번호를 넣어
 * 워커가 몇 개든, 프로브가 몇 개든 한 번도 겹치지 않는다.
 */
let probeSeq = 0;
function probeIp(): string {
  probeSeq += 1;
  expect(probeSeq, '한 워커의 프로브가 254개를 넘었다 — 네 번째 옥텟이 넘친다').toBeLessThan(255);
  expect(WORKER_INDEX, '워커 인덱스가 255를 넘었다 — 세 번째 옥텟이 넘친다').toBeLessThan(256);
  return `198.18.${WORKER_INDEX}.${probeSeq}`;
}

/** 한 IP로 `/g/` 를 n번 두드리고 상태 코드 목록을 돌려준다. */
async function hammer(
  request: APIRequestContext,
  url: string,
  ip: string,
  times: number,
): Promise<number[]> {
  const codes: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const res = await request.get(url, { headers: { 'x-forwarded-for': ip } });
    codes.push(res.status());
  }
  return codes;
}

test.describe.configure({ mode: 'serial' });

test.describe('공개 장부 레이트 리밋', () => {
  /** 실재하는 공개 링크 — "다른 IP는 여전히 **200**"을 말하려면 진짜 장부가 필요하다. */
  const fx = { publicUrl: '', publicToken: '' };
  /** 존재하지 않는 토큰. 한도 프로브는 이걸 쓴다 — 장부 렌더 비용 없이 미들웨어만 때린다. */
  const DEAD_URL = `${ORIGIN}/g/${'Qq'.repeat(11)}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await newClientContext(browser);
    const page = await ctx.newPage();
    await page.goto('/login');
    await signUp(page, { name: '한도', email: testEmail('ratelimit', 'owner') });
    await expect(page).toHaveURL(/\/groups$/);
    const groupId = await createGroup(page, '한도모임', '한도');

    await page.goto(`/groups/${groupId}/settings`);
    const link = page.getByTestId('public-link');
    await expect(link).toContainText(`${ORIGIN}/g/`);
    fx.publicUrl = (await link.innerText()).trim();
    fx.publicToken = fx.publicUrl.split('/g/')[1]!;
    expect(fx.publicToken).toHaveLength(22);
    await ctx.close();
  });

  test('한도를 넘기면 429 + Retry-After가 온다', async ({ request }) => {
    const ip = probeIp();
    // 한도까지는 통과한다 — 존재하지 않는 토큰이므로 404가 정상이다.
    // (404여도 미들웨어를 지나왔다는 뜻이고, 그게 이 프로브가 세는 대상이다.)
    const codes = await hammer(request, DEAD_URL, ip, LIMIT);
    expect(
      codes.filter((c) => c === 429),
      `한도(${LIMIT}) 안에서 벌써 막혔다 — 정상 사용자가 막힌다: ${codes.join(',')}`,
    ).toHaveLength(0);
    expect(new Set(codes), `한도 안 응답이 404가 아니다: ${[...new Set(codes)].join(',')}`).toEqual(
      new Set([404]),
    );

    const blocked = await request.get(DEAD_URL, { headers: { 'x-forwarded-for': ip } });
    expect(blocked.status(), `${LIMIT + 1}번째 요청이 막히지 않았다 — 제한이 동작하지 않는다`).toBe(429);

    const retryAfter = blocked.headers()['retry-after'];
    expect(retryAfter, 'Retry-After 헤더가 없다').toBeTruthy();
    const seconds = Number(retryAfter);
    expect(Number.isInteger(seconds), `Retry-After가 정수가 아니다: ${retryAfter}`).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(60);

    // 한국어 안내가 실제로 실린다 — 상태 코드만 맞고 화면이 비어 있으면 안 된다.
    const body = await blocked.text();
    expect(body).toContain('요청이 너무 많습니다');
    // 토큰을 되돌려주지 않는다.
    expect(body, '429 본문에 요청한 토큰이 실렸다').not.toContain('Qq'.repeat(11));
  });

  /**
   * ⚠️ 이 단언이 없으면 **"전부 막기"** 라는 구현이 위 테스트를 통과한다.
   * 그리고 200을 요구하는 것이 핵심이다 — 404만 봐도 "미들웨어를 지났다"는 알 수 있지만,
   * 장부가 정말 **열리는지**는 200과 모임 이름으로만 확인된다.
   */
  test('한 IP가 막혀도 다른 IP는 여전히 200으로 장부를 본다', async ({ request }) => {
    const blockedIp = probeIp();
    const freshIp = probeIp();

    await hammer(request, DEAD_URL, blockedIp, LIMIT + 1);
    const stillBlocked = await request.get(DEAD_URL, { headers: { 'x-forwarded-for': blockedIp } });
    expect(stillBlocked.status(), '준비가 잘못됐다 — 막힌 IP가 막혀 있지 않다').toBe(429);

    const ok = await request.get(fx.publicUrl, { headers: { 'x-forwarded-for': freshIp } });
    expect(ok.status(), '다른 IP까지 막혔다 — 한 사람이 서비스 전체를 잠글 수 있다').toBe(200);
    expect(await ok.text()).toContain('한도모임');
  });

  /**
   * 429가 **세 헤더를 잃지 않는지**. `next.config.ts`가 `/g/:token*`에 붙이는 것이지만
   * 미들웨어 단축 응답은 페이지 렌더를 지나지 않는 **다른 경로**다 — 실측으로는 붙었고
   * 미들웨어가 명시적으로도 붙이지만, 그 둘 중 어느 쪽이 사라져도 여기서 빨개지게 둔다.
   * `Referrer-Policy`가 빠지면 이 응답을 받은 브라우저가 다음 요청에 `/g/<token>`을
   * 리퍼러로 실어 보낸다 — Plan 03 Task 8이 변이로 증명한 바로 그 유출이다.
   */
  test('429도 캐시·리퍼러·색인을 모두 막는다', async ({ request }) => {
    const ip = probeIp();
    await hammer(request, DEAD_URL, ip, LIMIT + 1);
    const res = await request.get(DEAD_URL, { headers: { 'x-forwarded-for': ip } });
    expect(res.status()).toBe(429);

    const headers = res.headers();
    expect(headers['cache-control'], '429의 cache-control에 no-store가 없다').toContain('no-store');
    expect(headers['referrer-policy'], '429의 Referrer-Policy가 no-referrer가 아니다').toBe(
      'no-referrer',
    );
    expect(headers['x-robots-tag'], '429의 X-Robots-Tag에 noindex가 없다').toContain('noindex');
  });

  /** 인증 앱 경로·랜딩은 이 제한의 대상이 아니다 — 매처가 넓어지면 여기서 빨개진다. */
  test('/ 와 /login은 제한되지 않는다', async ({ request }) => {
    const ip = probeIp();
    // 먼저 이 IP로 `/g/`를 한도까지 채운다 — 같은 IP인데도 다른 경로는 멀쩡해야 한다.
    await hammer(request, DEAD_URL, ip, LIMIT + 1);
    expect(
      (await request.get(DEAD_URL, { headers: { 'x-forwarded-for': ip } })).status(),
      '준비가 잘못됐다',
    ).toBe(429);

    for (const path of ['/', '/login']) {
      const res = await request.get(`${ORIGIN}${path}`, { headers: { 'x-forwarded-for': ip } });
      expect(res.status(), `${path}가 제한됐다 — 매처가 /g/ 밖으로 새어나갔다`).toBe(200);
    }
  });
});
