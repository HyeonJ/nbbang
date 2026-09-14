import { test, expect } from '@playwright/test';
import { createGroup, exactAmount, signUp, testEmail } from './helpers';

test('가입→모임 생성→초대 합류→설정 권한', async ({ browser }) => {
  test.setTimeout(120_000);

  // 1) 총무 가입
  const ownerContext = await browser.newContext();
  const op = await ownerContext.newPage();
  await op.goto('/login');
  await signUp(op, { name: '민지', email: testEmail('foundation', 'owner') });
  await expect(op).toHaveURL(/\/groups$/);

  // 2) 모임 생성 → 대시보드
  await createGroup(op, '테스트모임', '민지');
  await expect(op.getByTestId('group-title')).toHaveText('테스트모임');
  // 숫자는 정확히 0이어야 한다(뒤따르는 단위 '원'만 허용) — toContainText('0')은 '10,000'도 통과시킨다.
  await expect(op.getByTestId('group-balance')).toHaveText(exactAmount('0'));

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
  await signUp(mp, { name: '철수', email: testEmail('foundation', 'member') });
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
