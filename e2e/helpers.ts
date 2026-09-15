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
 * `browser.newContext()`를 그냥 쓰면 안 되는 이유: better-auth는 `/sign-in*`·`/sign-up*`에
 * **IP당 10초 3회** 제한을 기본으로 걸고(rate-limiter의 default special rule), 프로덕션 빌드에선
 * 클라이언트 IP를 `x-forwarded-for`에서만 찾는다. `next start`는 앞에 프록시가 없어 그 헤더가
 * 없으니 IP 해석이 실패하고, 그러면 제한 키가 `no-trusted-ip|/sign-up/email` **하나로 뭉쳐
 * 서버 전체가 버킷을 공유**한다. 두 스펙의 가입 4건이 10초 안에 들어오는 CI에선 4번째가 429로
 * 죽었다(로컬은 느려서 창을 넘기고 통과 — 그래서 CI에서만 터졌다).
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
