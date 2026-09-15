import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * E2E 공용 절차. foundation.spec과 ledger.spec이 같은 가입·개설 동선을 쓰기 때문에
 * 셀렉터가 두 파일에 흩어지지 않도록 여기 한 곳에만 둔다.
 */

/** 워커마다 IP 대역을 갈라 쓴다 — 스펙은 각자의 프로세스에서 돌아 모듈 카운터를 공유하지 않는다. */
const WORKER_INDEX = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
let contextSeq = 0;

/**
 * 브라우저 컨텍스트 = 서로 다른 사람. 컨텍스트마다 다른 클라이언트 IP를 실어 보낸다.
 *
 * `browser.newContext()`를 그냥 쓰면 안 되는 이유: better-auth는 가입·로그인에 경로별 제한을
 * 걸고(지금은 `lib/auth.ts`의 customRules), 제한 키는 `createRateLimitKey(ip, path)`다.
 * 그런데 헤더를 안 실으면 **모든 컨텍스트의 IP가 똑같다** — `next start`는 소켓 주소로
 * `x-forwarded-for`를 스스로 채우므로 로컬에서 들어오는 모든 요청이 루프백 한 주소로 해석되고,
 * 결국 서버 전체가 `<loopback>|/sign-up/email` **한 버킷을 공유**한다. 그래서 두 스펙의 가입이
 * 한 창에 겹치면 뒤쪽이 429로 죽는다 — 기본값(10초 3회) 시절 CI에서 4번째 가입이 그렇게 죽었다
 * (로컬은 느려서 창을 넘기고 통과 — 그래서 CI에서만 터졌다).
 *
 * 실제 배포(Vercel)는 프록시가 `x-forwarded-for`를 채워 사용자별로 버킷이 갈린다. 그래서 여기서
 * 헤더를 넣는 건 제한을 끄는 우회가 아니라 **테스트를 실제 배포 형태에 맞추는 것**이다 —
 * 레이트리밋은 켜진 채로 남는다.
 *
 * 주소는 TEST-NET-1(192.0.2.0/24) — 문서용 예약 대역이라 실주소와 겹치지 않는다.
 */
export function newClientContext(browser: Browser): Promise<BrowserContext> {
  contextSeq += 1;
  return browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `192.0.2.${WORKER_INDEX * 16 + contextSeq}` },
  });
}

/**
 * 초대 합류 화면에 **도달했음**을 확인하는 URL 패턴.
 *
 * `/\/invite\/.+/`처럼 앵커 없이 쓰면 이 단언은 아무것도 지키지 못한다. 이 동선에서 이동
 * **직전** URL은 `/login?next=/invite/<token>`인데(초대 페이지의 로그인 링크가 next를
 * 인코딩하지 않고 그대로 붙인다) 그 문자열에도 `/invite/<token>`이 들어 있어 **가입이
 * 일어나기 전에 이미 통과**한다. 실제로 이 때문에, 이동이 끊긴 회귀가 URL 단언을 그냥 지나쳐
 * 다음 줄 `fill`에서 171초를 매달려 있다가 타임아웃으로 죽었다 — 원인이 URL에 있다는 걸
 * 아무것도 알려주지 않는 실패였다.
 *
 * `/\/invite\/[^/?]+$/`로 좁히는 것만으론 부족하다. 이동 직전 URL은 토큰으로 끝나고 그 뒤에
 * `/`도 `?`도 없어서 **여전히 매칭된다**. 그래서 **호스트 바로 뒤**부터 앵커를 걸어 경로 전체를
 * 고정한다 — 쿼리에 실려온 `/invite/...`는 호스트 뒤 첫 세그먼트가 아니므로 걸리지 않는다.
 *
 * 두 스펙이 같은 전이를 검사하므로 패턴은 여기 한 곳에만 둔다 — 한쪽만 고쳐져 어긋나는 걸 막는다.
 */
export const INVITE_JOIN_URL = /^https?:\/\/[^/]+\/invite\/[^/?#]+$/;

/**
 * 스펙·역할마다 겹치지 않는 테스트 이메일.
 *
 * `Date.now()`만으로는 부족하다 — 스펙들이 각자의 병렬 워커에서 거의 같은 순간에 시작하므로
 * 같은 밀리초가 나올 수 있고, 그러면 뒤늦은 쪽의 가입이 email 유니크 제약에 걸려
 * "Failed to create user"로 죽는다(실제로 한 번 겪었다). 스코프와 난수를 함께 붙여 시계에서 떼어낸다.
 */
export const testEmail = (scope: string, role: string) =>
  `${scope}-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

/**
 * 이미 열려 있는 인증 화면(`/login` 또는 초대 → 로그인 유도)에서 회원가입한다.
 * 가입 후의 이동 지점은 호출자에 따라 다르므로(`/groups` vs `/invite/…`) URL 단언은 호출자 몫이다.
 */
export async function signUp(
  page: Page,
  { name, email, password = 'password123!' }: { name: string; email: string; password?: string },
) {
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-name').fill(name);
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
}

/** 모임 목록에서 모임을 만들고, 이동한 대시보드 URL에서 groupId를 돌려준다. */
export async function createGroup(page: Page, name: string, displayName: string): Promise<string> {
  await page.getByTestId('group-name').fill(name);
  await page.getByTestId('group-display-name').fill(displayName);
  await page.getByTestId('group-create').click();
  await expect(page).toHaveURL(/\/groups\/[^/]+$/);
  const groupId = new URL(page.url()).pathname.split('/')[2];
  expect(groupId).toBeTruthy();
  return groupId;
}

/**
 * 금액 텍스트 정확 일치용 정규식.
 * `toContainText('0')`은 '10,000'도, `toContainText('20,000')`은 '120,000'도 통과시킨다 —
 * 숫자를 양쪽 앵커로 묶고 뒤따르는 단위('원')만 `\D*`로 허용한다.
 * 음수는 formatAmount가 U+2212(−)로 찍으므로 하이픈이 아니라 '−'를 넘겨야 한다.
 */
export const exactAmount = (text: string) => new RegExp(`^${text}\\D*$`);
