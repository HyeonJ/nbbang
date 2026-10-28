import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createGroup, exactAmount, INVITE_JOIN_URL, newClientContext, signUp, testEmail } from './helpers';

/**
 * 멤버 생명주기(ADR-005)를 사람이 겪는 순서로 한 번 지나간다.
 * 거부 코드의 전수 확인은 authz.spec이 하고, 규칙의 경계는 통합 테스트가 한다.
 * 여기서 보는 것은 **화면이 그 규칙을 사람에게 어떻게 보이는가**다.
 */

test.describe.configure({ mode: 'serial' });

let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let op: Page;
let mp: Page;
const fx = { groupId: '', roundId: '', invite: '' };

async function joinWithName(page: Page, invite: string, name: string) {
  await page.goto(invite);
  await page.getByTestId('join-display-name').fill(name);
  await page.getByTestId('join-submit').click();
}

test.describe('멤버 생명주기', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    ownerCtx = await newClientContext(browser);
    op = await ownerCtx.newPage();
    op.on('dialog', (d) => d.accept());
    await op.goto('/login');
    await signUp(op, { name: '민지', email: testEmail('lifecycle', 'owner') });
    await expect(op).toHaveURL(/\/groups$/);
    fx.groupId = await createGroup(op, '생명주기모임', '민지');

    // 1월 회차는 총무 혼자일 때 만든다 — 명단 = [민지].
    await op.goto(`/groups/${fx.groupId}/dues`);
    await op.getByTestId('round-period').fill('2026-01');
    await op.getByTestId('round-amount').fill('20000');
    await op.getByTestId('round-create').click();
    await expect(op).toHaveURL(/\/dues\/[^/]+$/);
    fx.roundId = new URL(op.url()).pathname.split('/').pop()!;
    await op.getByTestId('payment-toggle').click();
    await expect(op.getByTestId('round-total-collected')).toHaveText(exactAmount('20,000'));

    await op.goto(`/groups/${fx.groupId}/settings`);
    await expect(op.getByTestId('invite-link')).toContainText('/invite/');
    fx.invite = (await op.getByTestId('invite-link').innerText()).trim();

    memberCtx = await newClientContext(browser);
    mp = await memberCtx.newPage();
    mp.on('dialog', (d) => d.accept());
    await mp.goto(fx.invite);
    await mp.getByTestId('join-login-link').click();
    await signUp(mp, { name: '철수', email: testEmail('lifecycle', 'member') });
    await expect(mp).toHaveURL(INVITE_JOIN_URL);
    await mp.getByTestId('join-display-name').fill('철수');
    await mp.getByTestId('join-submit').click();
    await expect(mp).toHaveURL(/\/groups\/[^/]+$/);
  });

  test.afterAll(async () => {
    await Promise.all([ownerCtx?.close(), memberCtx?.close()]);
  });

  test('회차 뒤에 합류한 사람은 그 회차 명단에 없고, 총무가 넣으면 미납자가 된다', async () => {
    await op.goto(`/groups/${fx.groupId}/dues/${fx.roundId}`);
    await expect(op.getByTestId('round-total-expected')).toHaveText(exactAmount('20,000'));
    await expect(op.getByTestId('roster-addable-row')).toHaveCount(1);
    await expect(op.getByTestId('roster-addable-row')).toContainText('철수');
    await expect(op.getByTestId('payment-row').filter({ hasText: '철수' })).toHaveCount(0);

    await op.getByRole('button', { name: '철수 명단에 추가' }).click();
    await expect(op.getByTestId('round-total-expected')).toHaveText(exactAmount('40,000'));
    await expect(op.getByTestId('roster-addable')).toHaveCount(0);
    await expect(op.getByTestId('unpaid-text')).toHaveText('2026-01 회비(20,000원) 미납: 철수');
  });

  test('멤버가 나가면 모임이 목록에서 사라지고 모임 화면은 404다', async () => {
    await mp.goto(`/groups/${fx.groupId}`);
    await mp.getByTestId('leave-group').click();
    await expect(mp).toHaveURL(/\/groups$/);
    // 목록 화면이 그려진 뒤에 부재를 본다 — 전환 중의 빈 화면에서 통과하지 않게.
    await expect(mp.getByTestId('page-title')).toHaveText('내 모임');
    await expect(mp.getByText('생명주기모임')).toHaveCount(0);

    const res = await mp.goto(`/groups/${fx.groupId}`);
    expect(res?.status(), '나간 사람에게 모임 화면이 열린다').toBe(404);
  });

  test('나간 미납자는 회차 화면에 (나감)으로 남고 안내 문구에서는 빠진다 — 면제하면 예상이 준다', async () => {
    await op.goto(`/groups/${fx.groupId}/dues/${fx.roundId}`);
    await expect(op.getByTestId('payment-row').filter({ hasText: '철수 (나감)' })).toHaveCount(1);
    // 미납자가 나간 사람뿐이라 단톡방에 붙일 문구가 없다.
    await expect(op.getByTestId('unpaid-text')).toHaveCount(0);

    // 기존 on('dialog') 핸들러가 수락하므로 여기서는 메시지만 잡는다.
    const dialogMessage = new Promise<string>((resolve) => op.once('dialog', (d) => resolve(d.message())));
    await op.getByRole('button', { name: '철수 면제' }).click();
    expect(await dialogMessage).toContain('다시 넣을 수 없습니다');
    await expect(op.getByTestId('round-total-expected')).toHaveText(exactAmount('20,000'));
    await expect(op.getByTestId('payment-row').filter({ hasText: '철수' })).toHaveCount(0);
  });

  test('스스로 나간 사람은 초대 링크로 돌아오고 새 이름을 쓴다', async () => {
    await joinWithName(mp, fx.invite, '철수2');
    await expect(mp).toHaveURL(new RegExp(`/groups/${fx.groupId}$`));

    await op.goto(`/groups/${fx.groupId}/settings`);
    await expect(op.getByTestId('member-row').filter({ hasText: '철수2' })).toHaveCount(1);
    await expect(op.getByTestId('left-member-row')).toHaveCount(0);
  });

  test('내보내진 사람은 링크로 돌아올 수 없고, 총무가 되살리면 돌아온다', async () => {
    await op.goto(`/groups/${fx.groupId}/settings`);
    await op.getByRole('button', { name: '철수2 내보내기' }).click();
    const left = op.getByTestId('left-member-row');
    await expect(left).toHaveCount(1);
    await expect(left).toContainText('내보냄');

    await joinWithName(mp, fx.invite, '철수3');
    // Next의 라우트 알림 div도 role=alert라 후보가 둘이다 — 문구로 좁힌다.
    await expect(mp.getByRole('alert').filter({ hasText: '내보내져' })).toBeVisible();
    expect((await mp.goto(`/groups/${fx.groupId}`))?.status()).toBe(404);

    await op.getByRole('button', { name: '철수2 되살리기' }).click();
    await expect(op.getByTestId('left-member-row')).toHaveCount(0);
    await expect(op.getByTestId('member-row').filter({ hasText: '철수2' })).toHaveCount(1);
    expect((await mp.goto(`/groups/${fx.groupId}`))?.status()).toBe(200);
  });

  test('총무 화면에는 나가기가 없고, 총무 자신의 행에는 내보내기가 없다', async () => {
    await op.goto(`/groups/${fx.groupId}`);
    await expect(op.getByTestId('leave-group')).toHaveCount(0);
    await op.goto(`/groups/${fx.groupId}/settings`);
    await expect(op.getByTestId('member-row').filter({ hasText: '민지' }).getByTestId('remove-member')).toHaveCount(0);
  });
});
