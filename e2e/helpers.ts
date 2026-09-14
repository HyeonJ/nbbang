import { expect, type Page } from '@playwright/test';

/**
 * E2E 공용 절차. foundation.spec과 ledger.spec이 같은 가입·개설 동선을 쓰기 때문에
 * 셀렉터가 두 파일에 흩어지지 않도록 여기 한 곳에만 둔다.
 */

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
