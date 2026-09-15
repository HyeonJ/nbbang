import { test, expect, type Page } from '@playwright/test';
import {
  createGroup,
  exactAmount,
  groupForbiddenValues,
  INVITE_JOIN_URL,
  newClientContext,
  signUp,
  testEmail,
} from './helpers';

/**
 * 입금 계좌 문구(Task 10) — **다른 어떤 픽스처도 만들 수 없는 값**으로 둔다.
 * 공개 장부 스펙과도 다른 값이다: CSV에서 이 문자열이 잡히면 어느 경로가 샜는지 즉시 갈린다.
 */
const ACCOUNT_LABEL = '누출탐지은행 0000-ACCT-LEAK-CSV-8264 민지';

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
  // 이메일은 뒤의 CSV 유출 검사에서 금칙 값으로 다시 쓴다.
  const ownerEmail = testEmail('ledger', 'owner');
  const memberEmail = testEmail('ledger', 'member');

  await op.goto('/login');
  await signUp(op, { name: '민지', email: ownerEmail });
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
  await signUp(mp, { name: '철수', email: memberEmail });
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

  // ── 9) 미납 안내 문구에 입금 계좌가 붙는다 (F6 완결, Task 10) ─────────────────
  /**
   * 계좌 **없음 → 있음** 두 상태를 같은 화면에서 본다. 없을 때 빈 `계좌:` 줄이 나가지 않는 것이
   * 절반이고(그게 `null`로 저장하는 이유다), 있을 때 한 줄이 개행으로 붙는 것이 나머지 절반이다.
   *
   * ⚠️ 줄바꿈은 `toHaveText`로 볼 수 없다 — 그 단언은 공백을 정규화해 개행을 스페이스로 접는다.
   * 문구가 **두 줄**이라는 것이 이 기능의 핵심이므로 `innerText()`(pre-wrap 렌더 결과)를 직접 본다.
   */
  const noticeText = async (page: Page) => {
    await expect(page.getByTestId('unpaid-text')).toContainText('미납: 철수');
    return (await page.getByTestId('unpaid-text').innerText()).trim();
  };

  await op.goto(`/groups/${groupId}/dues/${roundId}`);
  // 철수가 아직 안 냈으므로 안내 문구가 뜬다 — 총무이고 계좌가 없으니 등록 안내도 함께 보인다.
  expect(await noticeText(op)).toBe('2026-01 회비(20,000원) 미납: 철수');
  await expect(op.getByTestId('account-hint')).toHaveCount(1);

  await op.goto(`/groups/${groupId}/settings`);
  await op.getByTestId('account-label').fill(ACCOUNT_LABEL);
  await op.getByTestId('account-save').click();
  await expect(op.getByTestId('account-save')).toHaveText('저장됨');

  await op.goto(`/groups/${groupId}/dues/${roundId}`);
  // 개행까지 그대로 단언한다 — 단톡방에 붙는 문구가 두 줄이어야 한다.
  expect(await noticeText(op)).toBe(`2026-01 회비(20,000원) 미납: 철수\n계좌: ${ACCOUNT_LABEL}`);
  // 등록 안내는 사라진다 — 할 일이 끝났으므로.
  await expect(op.getByTestId('account-hint')).toHaveCount(0);

  // 멤버도 같은 문구를 본다(멤버도 입금해야 한다 — 노출 3줄 규칙의 ①).
  await mp.goto(`/groups/${groupId}/dues/${roundId}`);
  await expect(mp.getByTestId('unpaid-text')).toContainText(`계좌: ${ACCOUNT_LABEL}`);
  // 멤버에게는 등록 안내가 없다 — 바꿀 수 없는 일을 권하지 않는다.
  await expect(mp.getByTestId('account-hint')).toHaveCount(0);

  // ── 10) CSV 내보내기(F7) — 파일이 장부와 같고, 새어선 안 되는 것이 없다 ───────
  /**
   * 이스케이프가 **아픈** 엔트리를 하나 심는다: 수식(`=1+1`) + 쉼표 + 큰따옴표 + 한글.
   * 이 세 가지가 한 셀에 같이 있을 때만 드러나는 실수가 있다 —
   * 접두사를 인용 밖에 붙이거나, 따옴표를 이중화하지 않거나, 인용을 잊는 것.
   */
  await op.goto(`/groups/${groupId}/expenses`);
  await op.getByTestId('expense-amount-input').fill('1500');
  await op.getByTestId('expense-date').fill('2026-02-03');
  await op.getByTestId('expense-category').fill('비품');
  await op.getByTestId('expense-memo').fill('=1+1, "큰따옴표" 포함');
  await op.getByTestId('expense-submit').click();
  await expect(op.getByTestId('expense-row')).toHaveCount(2);

  const exportUrl = `/api/groups/${groupId}/export`;
  const res = await ownerContext.request.get(exportUrl);
  expect(res.status(), 'CSV를 받지 못했다').toBe(200);
  expect(res.headers()['content-type']).toBe('text/csv; charset=utf-8');
  expect(res.headers()['cache-control'], '모임 재무 파일이 캐시될 수 있다').toContain('no-store');

  const disposition = res.headers()['content-disposition'];
  expect(disposition, '다운로드가 아니라 브라우저에 그려진다').toContain('attachment;');
  // 한글 모임 이름은 RFC 5987 `filename*`로 실린다(헤더 값은 ASCII만 허용된다).
  expect(disposition).toContain(`filename*=UTF-8''nbbang-${encodeURIComponent('정산모임')}-`);
  // ASCII 폴백은 이름 없이 날짜만 — filename*을 모르는 옛 클라이언트도 파일을 저장할 수 있다.
  expect(disposition).toMatch(/filename="nbbang-ledger-\d{4}-\d{2}-\d{2}\.csv"/);
  expect(disposition, '헤더 값에 비ASCII가 섞였다').toMatch(/^[\x20-\x7e]*$/);

  /**
   * BOM을 **바이트로** 확인한다. BOM이 없으면 Windows Excel이 UTF-8을 cp949로 읽어
   * 한글이 전부 깨진다 — 이 기능에서 현실적으로 가장 흔한 실패다.
   */
  const rawBody = await res.body();
  expect([...rawBody.subarray(0, 3)], 'UTF-8 BOM(EF BB BF)이 없다').toEqual([0xef, 0xbb, 0xbf]);

  const csv = rawBody.toString('utf8').slice(1); // BOM 한 글자만 떼어낸다
  const lines = csv.split('\r\n');
  expect(lines[0], '헤더 행이 다르다').toBe('일자,종류,금액,분류,메모,정정대상');
  // 원장 6줄(지출 2 + 회비 3 + 지출 정정 1) — 화면은 정정을 접지만 파일은 전부 내보낸다.
  expect(lines).toHaveLength(7);

  const lineStartingWith = (prefix: string) => {
    const found = lines.filter((l) => l.startsWith(prefix));
    expect(found, `${prefix}로 시작하는 행이 하나가 아니다`).toHaveLength(1);
    return found[0];
  };

  /**
   * 음수 금액이 `-96000`(ASCII 하이픈, 접두사 없음)으로 나가야 스프레드시트가 **숫자로** 읽는다.
   * 여기서 `'-96000`이 되면 모든 지출이 텍스트가 되어 합계가 불가능해지고,
   * 화면 표기인 U+2212(−)가 섞이면 같은 결과가 된다.
   */
  expect(lineStartingWith('2026-01-15')).toBe('2026-01-15,지출,-96000,대관료,코트 대관,');
  expect(csv, "음수에 수식 방어 접두사가 붙었다 — 숫자로 읽히지 않는다").not.toContain("'-96000");
  expect(csv, '표시용 U+2212가 파일에 섞였다 — 스프레드시트가 숫자로 읽지 못한다').not.toContain('−');

  /**
   * 수식 + 쉼표 + 따옴표 + 한글이 한 셀에: 접두사 `'`는 인용 **안**에, `"`는 이중화,
   * 셀 전체는 인용. 한 글자라도 어긋나면 열이 밀려 파일이 쓸모없어진다.
   */
  expect(lineStartingWith('2026-02-03')).toBe(
    '2026-02-03,지출,-1500,비품,"\'=1+1, ""큰따옴표"" 포함",',
  );

  // 정정 행은 대상을 **사람이 읽을 수 있게** 가리킨다(uuid가 아니라 날짜 + 메모).
  expect(csv, '정정 행이 대상을 가리키지 않는다').toContain(',정정,96000,,정정: ');
  expect(csv).toContain('2026-01-15 코트 대관');
  // 회비 납부·취소도 한 줄씩 남는다(ADR-001 — 지우지 않는다).
  expect(csv.match(/,회비 납부,20000,회비,/g), '회비 납부가 두 줄이 아니다').toHaveLength(2);

  /**
   * 유출 검사 — **공개 장부가 내보내지 않는 것은 CSV도 내보내지 않는다.**
   * CSV는 인증을 요구하지만, 파일이 되면 카톡방·메일로 재유통된다. 인증이 유통을 막지 못한다.
   *
   * 목록은 `e2e/helpers.ts`의 `groupForbiddenValues` 한 곳에서 온다 — 공개 장부 스펙과 **같은
   * 원천**이다. Task 10에서 계좌 문구를 추가할 때 두 스펙에 흩어진 목록을 각각 고쳐야 했고,
   * 한쪽만 고치면 규칙의 절반이 검사되지 않는다는 것이 드러나 헬퍼로 합쳤다.
   * 공개 장부는 `publicToken`을 덜어내지만(주소창에 있다) **CSV는 하나도 덜어내지 않는다** —
   * 파일 안에 있을 이유가 있는 값이 없다.
   */
  const forbidden = await groupForbiddenValues(groupId);
  expect(
    forbidden.map((f) => f.label),
    '계좌 문구가 금칙 목록에 없다 — Task 10의 규칙 절반이 검사되지 않는다',
  ).toContain('accountLabel(입금 계좌 문구)');
  // 이 모임은 총무·멤버 둘뿐이다 — 이메일이 두 개가 아니면 픽스처가 어긋난 것이고,
  // 그러면 "이메일이 파일에 없다"는 단언이 반쪽만 검사한다.
  expect(
    forbidden.filter((f) => f.label.startsWith('이메일')),
    '이메일 금칙 값이 2개가 아니다 — 준비가 잘못됐다',
  ).toHaveLength(2);
  for (const { label, value } of forbidden) {
    expect(csv, `CSV에 ${label}이 들어 있다`).not.toContain(value);
  }

  /**
   * 버튼이 실제로 다운로드를 시작하는지 — **멤버** 화면에서 확인한다.
   * 라우트가 멤버를 통과시켜도 버튼이 총무 전용 화면에만 있으면 멤버는 닿을 수 없다.
   */
  await mp.goto(`/groups/${groupId}`);
  const download = mp.waitForEvent('download');
  await mp.getByTestId('export-csv').click();
  const file = await download;
  // 브라우저가 Content-Disposition의 이름을 그대로 쓴다 — 한글 이름이 filename*로 살아 있는 증거.
  expect(file.suggestedFilename()).toMatch(/^nbbang-정산모임-\d{4}-\d{2}-\d{2}\.csv$/);

  await ownerContext.close();
  await memberContext.close();
});
