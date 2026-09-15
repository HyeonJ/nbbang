import { test, expect, type Page } from '@playwright/test';
import {
  createGroup,
  exactAmount,
  INVITE_JOIN_URL,
  newClientContext,
  signUp,
  testEmail,
} from './helpers';

/**
 * 정산(F4) E2E — 플랜 Task 7 Step 6의 검증 목록을 그대로 고정한다.
 *
 * 이 스펙이 지키는 가장 중요한 불변식은 **정산이 원장을 건드리지 않는다**는 것이다(ADR-003).
 * 잔액만 보면 합계 0인 엔트리 쌍을 쓰는 구현도 통과하므로, 원장 **행 수**까지 함께 단언한다.
 */

/**
 * 초대 링크로 새 사람을 합류시키고 그 페이지를 돌려준다.
 *
 * `slug`는 이메일 로컬파트에 들어가므로 **ASCII여야 한다** — 표시 이름(한글)을 그대로 쓰면
 * better-auth가 이메일 형식 검증에서 가입을 거절하고, 화면은 /login에 머문다(실제로 한 번 겪었다).
 */
async function joinViaInvite(
  browser: Parameters<typeof newClientContext>[0],
  invite: string,
  name: string,
  slug: string,
) {
  const context = await newClientContext(browser);
  const page = await context.newPage();
  await page.goto(invite);
  await page.getByTestId('join-login-link').click();
  await signUp(page, { name, email: testEmail('settle', slug) });
  await expect(page).toHaveURL(INVITE_JOIN_URL);
  await page.getByTestId('join-display-name').fill(name);
  await page.getByTestId('join-submit').click();
  await expect(page).toHaveURL(/\/groups\/[^/]+$/);
  return { context, page };
}

/** 원장이 비어 있음 — 잔액 0 + 엔트리 0행. 정산은 이 둘 중 어느 것도 바꾸지 않아야 한다. */
async function expectEmptyLedger(page: Page, groupId: string) {
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByTestId('group-balance')).toHaveText(exactAmount('0'));
  await expect(page.getByTestId('recent-entry-row')).toHaveCount(0);
}

test('3명 정산 — 미리보기·결과·공유 문구가 맞고 원장은 그대로다', async ({ browser }) => {
  test.setTimeout(180_000);

  const ownerContext = await newClientContext(browser);
  const op = await ownerContext.newPage();

  // ── 1) 총무 + 멤버 2명 모임 ────────────────────────────────────────────────
  await op.goto('/login');
  await signUp(op, { name: '민지', email: testEmail('settle', 'owner') });
  await expect(op).toHaveURL(/\/groups$/);
  const groupId = await createGroup(op, '엔빵모임', '민지');

  await op.goto(`/groups/${groupId}/settings`);
  const inviteLocator = op.getByTestId('invite-link');
  await expect(inviteLocator).toContainText('http://localhost:3000/invite/');
  const invite = (await inviteLocator.innerText()).trim();

  const chulsoo = await joinViaInvite(browser, invite, '철수', 'member1');
  const younghee = await joinViaInvite(browser, invite, '영희', 'member2');

  // 정산 전 원장은 비어 있다 — 이 값이 정산 후에도 같아야 한다.
  await expectEmptyLedger(op, groupId);

  // ── 2) 정산 탭 → 빈 목록 → 마법사 ─────────────────────────────────────────
  await op.getByTestId('tab-정산').click();
  await expect(op).toHaveURL(/\/settle$/);
  await expect(op.getByTestId('settlement-row')).toHaveCount(0);
  await op.getByTestId('settlement-new').click();
  await expect(op).toHaveURL(/\/settle\/new$/);

  // 기본값: 전원 참여, 선결제자는 자신.
  await expect(op.getByTestId('settle-participant')).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) {
    await expect(op.getByTestId('settle-participant').nth(i)).toBeChecked();
  }
  await expect(op.getByTestId('settle-payer').first()).toBeChecked();

  // ── 3) 미리보기 — 10,000원을 3명이 나누면 3,334/3,333/3,333, 이체 2건 ──────
  await op.getByTestId('settle-title').fill('3월 회식');
  await op.getByTestId('settle-date').fill('2026-03-15');
  await op.getByTestId('settle-total').fill('10000');

  const preview = op.getByTestId('settle-preview');
  // 한 값으로 적으면 아래 이체 금액과 어긋나므로 범위로 적는다(settlementShareText 주석).
  await expect(preview).toContainText('3,333~3,334원');
  await expect(preview).toContainText('2건');
  await expect(preview).toContainText('6,666원');

  // ── 4) 저장 → 결과 상세 ───────────────────────────────────────────────────
  await op.getByTestId('settle-submit').click();
  await expect(op).toHaveURL(/\/settle\/[0-9a-f-]{36}$/);

  await expect(op.getByTestId('settle-detail-total')).toHaveText(exactAmount('10,000'));
  await expect(op.getByTestId('settle-occurred-on')).toHaveText('2026-03-15');
  await expect(op.getByTestId('settle-participant-count')).toHaveText('3명');
  await expect(op.getByTestId('settle-per-share')).toHaveText('3,333~3,334원');
  // 이 화면의 핵심 수치 — 총액 − 선결제자 부담액 = 10,000 − 3,334.
  await expect(op.getByTestId('settle-transfer-total')).toHaveText(exactAmount('6,666'));
  await expect(op.getByTestId('settle-transfer-row')).toHaveCount(2);
  // 어긋남 알림은 한 줄도 없어야 한다(정상 정산).
  await expect(op.getByTestId('settle-note')).toHaveCount(0);

  // 참여자는 선결제자·0원 포함 전원이 남는다(ADR-003 스냅샷).
  await expect(op.getByTestId('settle-participant-row')).toHaveCount(3);
  // 순서는 선결제자 먼저, 그 다음 이름순 — 부담액은 3,334 한 명과 3,333 두 명이다.
  await expect(op.getByTestId('settle-share-amount')).toHaveText([
    exactAmount('3,334'),
    exactAmount('3,333'),
    exactAmount('3,333'),
  ]);
  await expect(op.getByTestId('settle-participant-row').first()).toContainText('선결제');

  // ── 5) 공유 문구 — 형식 고정 ──────────────────────────────────────────────
  // 이체 두 줄의 순서는 쿼리 정렬(금액 내림차순 → membership id)이 정하므로 금액이 같으면
  // uuid에 달려 있다. 머리줄은 정확히 단언하고, 이체 줄은 두 줄이 다 있는지로 본다.
  const shareText = (await op.getByTestId('settle-share-text').innerText()).trim();
  const [head, ...lines] = shareText.split('\n').map((l) => l.trim());
  expect(head).toBe('[3월 회식] 2026-03-15 · 총 10,000원 · 3명 (1인 3,333~3,334원)');
  expect(lines.sort()).toEqual(['영희 → 민지 3,333원', '철수 → 민지 3,333원'].sort());
  await op.getByTestId('settle-share-copy').click();

  // ── 6) 원장은 그대로 — 정산은 모임 돈을 움직이지 않는다 (ADR-003) ─────────
  await expectEmptyLedger(op, groupId);

  // ── 7) 목록에 한 줄 ──────────────────────────────────────────────────────
  await op.goto(`/groups/${groupId}/settle`);
  await expect(op.getByTestId('settlement-row')).toHaveCount(1);
  await expect(op.getByTestId('settlement-total')).toHaveText(exactAmount('10,000'));
  await expect(op.getByTestId('settlement-participant-count')).toHaveText('3');
  await expect(op.getByTestId('settlement-row')).toContainText('2026-03-15');

  // ── 8) 두 번째 에러 채널이 실제로 화면에 나온다 ───────────────────────────
  // createSettlement는 실패를 두 경로로 돌려준다: 액션 본문의 ActionError는 `serverError`,
  // zod 입력 검증은 `validationErrors`(코드 하나로 접힌 `{ code }`). 폼이 앞쪽만 읽으면
  // 입력 오류가 **아무 문구도 없이** 조용히 실패한다 — 그 경로를 여기서 강제로 지나간다.
  // 브라우저 기본 검증(max 속성)이 먼저 막으므로 noValidate로 걷어내 서버까지 보낸다.
  await op.goto(`/groups/${groupId}/settle/new`);
  await op.getByTestId('settle-title').fill('한도 초과');
  await op.getByTestId('settle-date').fill('2026-03-16');
  await op.evaluate(() => {
    document.querySelector('form')?.setAttribute('novalidate', '');
  });
  await op.getByTestId('settle-total').fill('200000000');
  await op.getByTestId('settle-submit').click();
  // getByRole('alert')로는 안 된다 — Next의 라우트 알림 div가 같은 role을 갖고 있어 후보가 둘이다.
  await expect(op.getByTestId('settle-error')).toHaveText(
    '총액은 1원 이상 1억 원 이하의 정수여야 합니다.',
  );
  // 거절됐으므로 목록은 그대로 한 줄이다.
  await op.goto(`/groups/${groupId}/settle`);
  await expect(op.getByTestId('settlement-row')).toHaveCount(1);

  // ── 9) 멤버 — 열람은 되고 만들기는 없다 ───────────────────────────────────
  const mp = chulsoo.page;
  await mp.goto(`/groups/${groupId}/settle`);
  // 정산 탭은 전원에게 보인다(열람은 누구나).
  await expect(mp.getByTestId('tab-정산')).toHaveCount(1);
  await expect(mp.getByTestId('settlement-row')).toHaveCount(1);
  await expect(mp.getByTestId('settlement-new')).toHaveCount(0);

  await mp.getByTestId('settlement-link').click();
  await expect(mp.getByTestId('settle-transfer-total')).toHaveText(exactAmount('6,666'));
  await expect(mp.getByTestId('settle-share-text')).toContainText('철수 → 민지 3,333원');

  // 버튼이 없는 것으로 끝나지 않는다 — URL을 직접 쳐도 404다.
  const res = await mp.goto(`/groups/${groupId}/settle/new`);
  expect(res?.status()).toBe(404);

  await ownerContext.close();
  await chulsoo.context.close();
  await younghee.context.close();
});

/**
 * 정산 제목에 쓰는 **어떤 픽스처도 만들 수 없는 문자열**.
 * 공개 장부 원시 본문·CSV 본문에서 이 문자열을 찾는 방식으로 "정산이 저 두 곳에 새지 않는다"를
 * 본다. 사람이 읽는 제목(`4월 뒤풀이`)으로 검사하면 다른 소재와 우연히 겹칠 수 있다.
 */
const SETTLE_MARKER = '뒤풀이-SETTLE-OUTSIDE-LEDGER-4291';

/**
 * v1 전체 흐름 — F2·F3으로 **0이 아닌** 원장을 만든 뒤 정산하고, 잔액·공개 장부·CSV가
 * 하나도 움직이지 않음을 본다.
 *
 * ── 왜 위 테스트로는 부족한가 (Task 11에서 찾은 실제 빈틈) ──────────────────
 * 위 테스트의 ADR-003 단언은 **빈 원장**에서 이뤄진다(잔액 0 · 엔트리 0행). 그것은
 * "정산이 원장에 쓰지 않는다"의 절반만 증명한다 — 0을 0으로 확인하는 것이라, 정산이 원장을
 * **읽어서** 무언가를 다시 계산하거나, 합산 쿼리에 정산 테이블을 끼워 넣는 회귀는 0에서는
 * 드러나지 않는다(0 ± 0 = 0). 통합 테스트도 원장 쪽을 보지 않고(`settlement.integration.test.ts`는
 * 참여자·이체·FK만 본다) 공개 장부 스펙은 정산을 아예 만들지 않는다. 즉 **0이 아닌 잔액에
 * 정산을 얹는 경로는 이 테스트 전까지 어디에서도 검사되지 않았다.**
 *
 * 그리고 같은 주장을 **세 표면**에서 본다 — 대시보드(인증된 화면), 공개 장부(인증 없는 화면),
 * CSV(파일). 셋은 서로 다른 쿼리를 쓴다(`queries.ts` / `public-queries.ts` / 내보내기 라우트).
 * 한 곳에서만 확인하면 나머지 두 쿼리에 정산이 섞여 들어가는 회귀를 놓친다. CSV는 **바이트
 * 동일성**으로 본다 — 가장 강한 형태이고, 파일이라 가능하다.
 */
test('v1 전체 흐름 — 회비·지출이 있는 모임에서 정산해도 잔액·공개 장부·CSV가 그대로다', async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const ownerContext = await newClientContext(browser);
  const op = await ownerContext.newPage();

  // ── 1) 총무 + 멤버 1명 ────────────────────────────────────────────────────
  await op.goto('/login');
  await signUp(op, { name: '민지', email: testEmail('v1flow', 'owner') });
  await expect(op).toHaveURL(/\/groups$/);
  const groupId = await createGroup(op, 'v1모임', '민지');

  await op.goto(`/groups/${groupId}/settings`);
  await expect(op.getByTestId('invite-link')).toContainText('http://localhost:3000/invite/');
  const invite = (await op.getByTestId('invite-link').innerText()).trim();
  const publicLocator = op.getByTestId('public-link');
  await expect(publicLocator).toContainText('http://localhost:3000/g/');
  const publicUrl = (await publicLocator.innerText()).trim();

  const chulsoo = await joinViaInvite(browser, invite, '철수', 'v1member');

  // ── 2) 지출 30,000 (F3) + 회비 10,000 납부 1건 (F2) → 잔액 −20,000 ─────────
  await op.goto(`/groups/${groupId}/expenses`);
  await op.getByTestId('expense-amount-input').fill('30000');
  await op.getByTestId('expense-date').fill('2026-04-02');
  await op.getByTestId('expense-category').fill('대관료');
  await op.getByTestId('expense-submit').click();
  await expect(op.getByTestId('expense-row')).toHaveCount(1);

  await op.goto(`/groups/${groupId}/dues`);
  await op.getByTestId('round-period').fill('2026-04');
  await op.getByTestId('round-amount').fill('10000');
  await op.getByTestId('round-create').click();
  await expect(op).toHaveURL(/\/dues\/[^/]+$/);
  await op.getByTestId('payment-toggle').first().click();
  await expect(op.getByTestId('round-total-collected')).toHaveText(exactAmount('10,000'));

  await op.goto(`/groups/${groupId}`);
  await expect(op.getByTestId('group-balance')).toHaveText(exactAmount('−20,000'));
  // 원장 2줄(지출 1 + 회비 납부 1) — 정산 뒤에도 이 숫자여야 한다.
  await expect(op.getByTestId('recent-entry-row')).toHaveCount(2);

  // ── 3) 정산 전 세 표면의 상태를 **떠 둔다** ───────────────────────────────
  const anonContext = await newClientContext(browser);
  const publicBefore = await anonContext.request.get(publicUrl);
  expect(publicBefore.status(), '공개 장부를 못 읽었다').toBe(200);
  const publicBodyBefore = await publicBefore.text();

  const exportUrl = `/api/groups/${groupId}/export`;
  const csvBefore = await ownerContext.request.get(exportUrl);
  expect(csvBefore.status(), 'CSV를 못 받았다').toBe(200);
  const csvBytesBefore = await csvBefore.body();
  // 원장 2줄 + 헤더 = 3줄. 이 숫자가 맞지 않으면 아래 바이트 비교가 엉뚱한 것을 비교한다.
  expect(csvBytesBefore.toString('utf8').trimEnd().split('\r\n')).toHaveLength(3);

  // ── 4) 정산 9,000원 · 2명 (F4) ────────────────────────────────────────────
  await op.goto(`/groups/${groupId}/settle/new`);
  await expect(op.getByTestId('settle-participant')).toHaveCount(2);
  await op.getByTestId('settle-title').fill(SETTLE_MARKER);
  await op.getByTestId('settle-date').fill('2026-04-20');
  await op.getByTestId('settle-total').fill('9000');
  await op.getByTestId('settle-submit').click();
  await expect(op).toHaveURL(/\/settle\/[0-9a-f-]{36}$/);

  // 2명이 9,000을 나누면 4,500씩, 이체는 1건 4,500원.
  await expect(op.getByTestId('settle-per-share')).toHaveText(exactAmount('4,500'));
  await expect(op.getByTestId('settle-transfer-row')).toHaveCount(1);
  await expect(op.getByTestId('settle-transfer-total')).toHaveText(exactAmount('4,500'));

  // ── 5) 대시보드 — 잔액·원장 행 수 둘 다 그대로다 (ADR-003) ────────────────
  await op.goto(`/groups/${groupId}`);
  await expect(op.getByTestId('group-balance')).toHaveText(exactAmount('−20,000'));
  await expect(op.getByTestId('recent-entry-row')).toHaveCount(2);

  // ── 6) 공개 장부 — 잔액·행 수가 같고 정산은 흔적조차 없다 ─────────────────
  const publicPage = await anonContext.newPage();
  await publicPage.goto(publicUrl);
  await expect(publicPage.getByTestId('public-balance')).toHaveText(exactAmount('−20,000'));
  await expect(publicPage.getByTestId('public-entry-row')).toHaveCount(2);
  await publicPage.close();

  const publicAfter = await anonContext.request.get(publicUrl);
  const publicBodyAfter = await publicAfter.text();
  expect(publicBodyAfter, '공개 장부 본문에 정산 제목이 들어 있다').not.toContain(SETTLE_MARKER);
  // 본문 전체를 바이트로 비교하지 않는 이유: 공개 페이지는 멤버 명단·빌드 id 등 정산과 무관한
  // 조각을 함께 실어 회귀와 무관한 차이가 생길 수 있다. 대신 **금액 행들**을 뽑아 비교한다.
  const amountsOf = (body: string) => body.match(/[+−-]?[\d,]{3,}원/g) ?? [];
  expect(amountsOf(publicBodyAfter), '공개 장부의 금액 구성이 바뀌었다').toEqual(
    amountsOf(publicBodyBefore),
  );

  // ── 7) CSV — **바이트가 완전히 같다** ────────────────────────────────────
  const csvAfter = await ownerContext.request.get(exportUrl);
  const csvBytesAfter = await csvAfter.body();
  expect(csvBytesAfter.toString('utf8'), 'CSV에 정산 제목이 들어 있다').not.toContain(
    SETTLE_MARKER,
  );
  expect(
    csvBytesAfter.equals(csvBytesBefore),
    '정산 전후 CSV 바이트가 다르다 — 정산이 원장 내보내기에 섞였다',
  ).toBe(true);

  // ── 8) 정산은 정산 탭에만 남는다 — 사라진 게 아니라 다른 곳에 있다 ────────
  // 6·7의 "없다"가 "정산이 저장되지 않았다"로 통과하는 것을 막는 대조군이다.
  await op.goto(`/groups/${groupId}/settle`);
  await expect(op.getByTestId('settlement-row')).toHaveCount(1);
  await expect(op.getByTestId('settlement-row')).toContainText(SETTLE_MARKER);

  await anonContext.close();
  await ownerContext.close();
  await chulsoo.context.close();
});
