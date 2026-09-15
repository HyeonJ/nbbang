import { test, expect, type Page } from '@playwright/test';
import { createGroup, exactAmount, INVITE_JOIN_URL, newClientContext, signUp, testEmail } from './helpers';

/**
 * 원장 정합성 E2E — 이 스펙의 존재 이유는 "화면이 원장과 어긋나지 않음"을 고정하는 것이다.
 * 그래서 돈이 움직이는 **모든** 단계 뒤에 대시보드 잔액(원장 합산의 파생값)을 다시 단언한다.
 * 잔액 컬럼은 존재하지 않으므로(ADR-001), 이 단언이 틀어지면 합산 경로가 깨진 것이다.
 */

/** 대시보드로 이동해 잔액을 정확히 단언한다. */
async function expectBalance(page: Page, groupId: string, amount: string) {
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByTestId('group-balance')).toHaveText(exactAmount(amount));
}

test('지출·회비가 잔액에 정확히 반영되고 정정으로 되돌아온다', async ({ browser }) => {
  test.setTimeout(180_000);

  const ownerContext = await newClientContext(browser);
  const op = await ownerContext.newPage();
  // 정정·납부 취소는 window.confirm으로 확인받는다 — 핸들러가 없으면 Playwright가 자동 dismiss해
  // 쓰기가 아예 일어나지 않는다. 항상 수락해 "확인한 사용자"를 연기한다.
  op.on('dialog', (d) => d.accept());

  // ── 1) 총무 가입 + 모임 생성 → 빈 원장의 잔액은 0 ────────────────────────────
  await op.goto('/login');
  await signUp(op, { name: '민지', email: testEmail('ledger', 'owner') });
  await expect(op).toHaveURL(/\/groups$/);
  const groupId = await createGroup(op, '정산모임', '민지');
  await expect(op.getByTestId('group-title')).toHaveText('정산모임');
  await expect(op.getByTestId('group-balance')).toHaveText(exactAmount('0'));
  await expect(op.getByTestId('recent-entry-row')).toHaveCount(0);

  // ── 2) 지출 96,000 → 지출 합계·잔액 모두 −96,000 ─────────────────────────────
  await op.getByTestId('tab-지출').click();
  await expect(op).toHaveURL(/\/expenses$/);
  await op.getByTestId('expense-amount-input').fill('96000');
  await op.getByTestId('expense-date').fill('2026-01-15');
  await op.getByTestId('expense-category').fill('대관료');
  await op.getByTestId('expense-memo').fill('코트 대관');
  await op.getByTestId('expense-submit').click();

  await expect(op.getByTestId('expense-row')).toHaveCount(1);
  await expect(op.getByTestId('expense-amount')).toHaveText(exactAmount('−96,000'));
  await expect(op.getByTestId('expense-total')).toHaveText(exactAmount('−96,000'));
  await expectBalance(op, groupId, '−96,000');

  // ── 3) 회비 회차(2026-01, 20,000/인) + 본인 납부 → 잔액 −76,000 ──────────────
  await op.getByTestId('tab-회비').click();
  await expect(op).toHaveURL(/\/dues$/);
  await op.getByTestId('round-period').fill('2026-01');
  await op.getByTestId('round-amount').fill('20000');
  await op.getByTestId('round-create').click();
  // 회차 생성 성공 시 폼이 방금 만든 회차로 밀어 넣는다(round-form.tsx) — 여기서 roundId를 얻는다.
  await expect(op).toHaveURL(/\/dues\/[^/]+$/);
  const roundId = new URL(op.url()).pathname.split('/').pop()!;

  // 목록에도 회차가 한 줄로 보인다(납부 0/1).
  await op.goto(`/groups/${groupId}/dues`);
  await expect(op.getByTestId('round-row')).toHaveCount(1);
  await expect(op.getByTestId('round-paid-count')).toHaveText('0/1');
  await expect(op.getByTestId('round-collected')).toHaveText(exactAmount('0'));
  await op.getByTestId('round-link').click();
  await expect(op).toHaveURL(new RegExp(`/dues/${roundId}$`));

  // 1인 모임이므로 예상 총액 = 1인 금액.
  await expect(op.getByTestId('round-total-expected')).toHaveText(exactAmount('20,000'));
  await expect(op.getByTestId('round-total-collected')).toHaveText(exactAmount('0'));
  await expect(op.getByTestId('round-total-outstanding')).toHaveText(exactAmount('20,000'));

  await expect(op.getByTestId('payment-toggle')).toHaveCount(1);
  await op.getByTestId('payment-toggle').click();
  await expect(op.getByTestId('round-total-collected')).toHaveText(exactAmount('20,000'));
  await expect(op.getByTestId('round-total-outstanding')).toHaveText(exactAmount('0'));
  await expectBalance(op, groupId, '−76,000');

  // ── 4) 납부 취소 → 수납 0 / 미납 20,000, 잔액 −96,000으로 원복 ───────────────
  await op.goto(`/groups/${groupId}/dues/${roundId}`);
  // 납부한 사람은 '납부 완료' details 안에 접혀 있다 — 펼치지 않으면 토글이 보이지 않는다.
  await op.getByTestId('paid-details').locator('summary').click();
  await op.getByTestId('payment-toggle').click();
  await expect(op.getByTestId('round-total-collected')).toHaveText(exactAmount('0'));
  await expect(op.getByTestId('round-total-outstanding')).toHaveText(exactAmount('20,000'));
  await expectBalance(op, groupId, '−96,000');

  // ── 5) 재납부 → 취소 뒤에도 다시 체크된다(유니크 위반 없음) ──────────────────
  await op.goto(`/groups/${groupId}/dues/${roundId}`);
  await op.getByTestId('payment-toggle').click();
  await expect(op.getByTestId('round-total-collected')).toHaveText(exactAmount('20,000'));
  await expect(op.getByTestId('round-total-outstanding')).toHaveText(exactAmount('0'));
  await expectBalance(op, groupId, '−76,000');

  // ── 6) 원장 3연속 단언 — 납부·취소·재납부가 +/−/+ 세 줄로 남는다(ADR-001) ────
  // DB를 직접 열지 않고 화면으로 증명한다: 대시보드 '최근 기록'이 부호 있는 금액을 그대로 노출한다.
  // 정렬은 발생일 내림차순이므로 회비 세 줄(모두 '지금')이 위에, 지출(2026-01-15)이 아래에 온다.
  // 취소가 기존 납부 행을 지우고 다시 쓰는 방식이었다면 이 배열은 두 줄로 줄어든다.
  await expect(op.getByTestId('recent-entry-row').locator('td:last-child')).toHaveText([
    exactAmount('\\+20,000'),
    exactAmount('−20,000'),
    exactAmount('\\+20,000'),
    exactAmount('−96,000'),
  ]);

  // ── 7) 지출 정정 → 지출 합계 0, 잔액은 회비만 남아 +20,000 ────────────────────
  await op.goto(`/groups/${groupId}/expenses`);
  await expect(op.getByTestId('reverse-button')).toHaveCount(1);
  await op.getByTestId('reverse-button').click();

  // 정정은 행을 지우지 않는다 — 원본 한 줄에 취소선·뱃지가 붙고 정정 기록이 접혀 들어간다.
  await expect(op.getByTestId('expense-row')).toHaveCount(1);
  await expect(op.getByTestId('expense-row')).toContainText('정정됨');
  await expect(op.getByTestId('expense-reversal')).toHaveCount(1);
  // 이미 정정된 행은 다시 정정할 수 없으므로 버튼도 사라진다.
  await expect(op.getByTestId('reverse-button')).toHaveCount(0);
  await expect(op.getByTestId('expense-total')).toHaveText(exactAmount('0'));
  await expectBalance(op, groupId, '20,000');

  // 원장에는 지출 역분개(+96,000)가 한 줄 더 쌓인다 — 상쇄되어 사라지지 않는다.
  await expect(op.getByTestId('recent-entry-row')).toHaveCount(5);

  // ── 8) 멤버 합류 — 숫자는 보이지만 쓰기 수단은 하나도 없다 ───────────────────
  await op.goto(`/groups/${groupId}/settings`);
  const inviteLocator = op.getByTestId('invite-link');
  // origin은 클라이언트 useEffect 이후 채워진다 — 전체 URL이 될 때까지 대기.
  await expect(inviteLocator).toContainText('http://localhost:3000/invite/');
  const invite = (await inviteLocator.innerText()).trim();

  const memberContext = await newClientContext(browser);
  const mp = await memberContext.newPage();
  await mp.goto(invite);
  await mp.getByTestId('join-login-link').click();
  await signUp(mp, { name: '철수', email: testEmail('ledger', 'member') });
  await expect(mp).toHaveURL(INVITE_JOIN_URL);
  await mp.getByTestId('join-display-name').fill('철수');
  await mp.getByTestId('join-submit').click();
  await expect(mp).toHaveURL(/\/groups\/[^/]+$/);

  // 잔액은 원장 하나에서 나온다 — 역할이 달라도 같은 수치를 본다.
  await expect(mp.getByTestId('group-balance')).toHaveText(exactAmount('20,000'));
  await expect(mp.getByTestId('recent-entry-row')).toHaveCount(5);
  await expect(mp.getByTestId('settings-link')).toHaveCount(0);

  await mp.goto(`/groups/${groupId}/expenses`);
  await expect(mp.getByTestId('expense-row')).toHaveCount(1);
  await expect(mp.getByTestId('expense-total')).toHaveText(exactAmount('0'));
  await expect(mp.getByTestId('expense-form')).toHaveCount(0);
  await expect(mp.getByTestId('reverse-button')).toHaveCount(0);

  await mp.goto(`/groups/${groupId}/dues`);
  await expect(mp.getByTestId('round-row')).toHaveCount(1);
  // 명단이 2명으로 늘었으니 납부는 1/2 — 예상 총액도 40,000으로 따라 오른다.
  await expect(mp.getByTestId('round-paid-count')).toHaveText('1/2');
  await expect(mp.getByTestId('round-form')).toHaveCount(0);

  await mp.goto(`/groups/${groupId}/dues/${roundId}`);
  await expect(mp.getByTestId('round-total-expected')).toHaveText(exactAmount('40,000'));
  await expect(mp.getByTestId('round-total-collected')).toHaveText(exactAmount('20,000'));
  await expect(mp.getByTestId('round-total-outstanding')).toHaveText(exactAmount('20,000'));
  await expect(mp.getByTestId('payment-row')).toHaveCount(2);
  await expect(mp.getByTestId('payment-toggle')).toHaveCount(0);

  await ownerContext.close();
  await memberContext.close();
});
