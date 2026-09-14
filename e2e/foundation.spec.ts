import { test, expect } from '@playwright/test';

test('가입→모임 생성→초대 합류→설정 권한', async ({ browser }) => {
  test.setTimeout(120_000);
  const ts = Date.now();

  // 1) 총무 가입
  const ownerContext = await browser.newContext();
  const op = await ownerContext.newPage();
  await op.goto('/login');
  await op.getByTestId('auth-toggle').click();
  await op.getByTestId('auth-name').fill('민지');
  await op.getByTestId('auth-email').fill(`owner-${ts}@test.local`);
  await op.getByTestId('auth-password').fill('password123!');
  await op.getByTestId('auth-submit').click();
  await expect(op).toHaveURL(/\/groups$/);

  // 2) 모임 생성 → 대시보드
  await op.getByTestId('group-name').fill('테스트모임');
  await op.getByTestId('group-display-name').fill('민지');
  await op.getByTestId('group-create').click();
  await expect(op).toHaveURL(/\/groups\/[^/]+$/);
  await expect(op.getByTestId('group-title')).toHaveText('테스트모임');
  // 단위·구분자 표기까지 고정하지 않는다 — 이 스펙이 보는 것은 "새 모임의 잔액은 0"이다.
  await expect(op.getByTestId('group-balance')).toContainText('0');

  // 3) 설정 — 초대 링크 추출, 멤버 1명(총무)
  await op.getByTestId('settings-link').click();
  await expect(op).toHaveURL(/\/settings$/);
  const inviteLocator = op.getByTestId('invite-link');
  // origin은 클라이언트 useEffect 이후 채워진다 — 전체 URL이 될 때까지 대기
  await expect(inviteLocator).toContainText('http://localhost:3000/invite/');
  const invite = (await inviteLocator.innerText()).trim();
  await expect(op.getByTestId('member-row')).toHaveCount(1);

  // 4) 멤버 — 초대 링크 → 로그인 유도 → 가입 → 합류
  const memberContext = await browser.newContext();
  const mp = await memberContext.newPage();
  await mp.goto(invite);
  await mp.getByTestId('join-login-link').click();
  await mp.getByTestId('auth-toggle').click();
  await mp.getByTestId('auth-name').fill('철수');
  await mp.getByTestId('auth-email').fill(`member-${ts}@test.local`);
  await mp.getByTestId('auth-password').fill('password123!');
  await mp.getByTestId('auth-submit').click();
  await expect(mp).toHaveURL(/\/invite\/.+/);
  await mp.getByTestId('join-display-name').fill('철수');
  await mp.getByTestId('join-submit').click();
  await expect(mp).toHaveURL(/\/groups\/[^/]+$/);

  // 5) 멤버에겐 설정 링크가 없다
  await expect(mp.getByTestId('group-title')).toHaveText('테스트모임');
  await expect(mp.getByTestId('settings-link')).toHaveCount(0);

  // 6) 총무 설정 재조회 — 멤버 2명
  await op.reload();
  await expect(op.getByTestId('member-row')).toHaveCount(2);

  await ownerContext.close();
  await memberContext.close();
});
