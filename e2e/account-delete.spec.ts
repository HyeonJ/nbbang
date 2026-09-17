import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { createGroup, INVITE_JOIN_URL, newClientContext, signUp, testEmail } from './helpers';

/**
 * 회원 탈퇴(Plan 04 Task 3)의 **사용자가 체감하는 결과**를 브라우저로 고정한다.
 *
 * 파기의 완전성(어느 컬럼이 비워지는가)은 여기 있지 않다 — 그것은
 * `test/account-delete.integration.test.ts`가 DB를 직접 읽어 확인한다. 이 스펙이 답하는 것은
 * 통합 테스트가 답할 수 없는 넷이다:
 *  1. 총무는 **화면에서** 막히고, 그 문구가 이유를 설명하는가(리뷰 MINOR 23)
 *  2. 타이핑 확인이 실재하는가(문구가 맞기 전에는 버튼이 눌리지 않는가)
 *  3. 탈퇴 뒤 **브라우저에 남은 진짜 세션 쿠키**가 더 이상 통하는가 — 화면(리다이렉트)과
 *     서버 액션(UNAUTHENTICATED) **양쪽에서**
 *  4. 남은 멤버가 보는 화면에 `탈퇴한 멤버`가 그 자리에 있는가
 *
 * ── 왜 `authz.spec.ts`의 매트릭스에 넣지 않았는가 ───────────────────────────
 * 그 매트릭스는 **모임 스코프 쓰기**의 인가를 본다(`groupActionClient`: 총무/멤버/비멤버).
 * `deleteAccount`는 `authActionClient`뿐이라 `FORBIDDEN`·`NOT_MEMBER`가 성립하지 않고,
 * 멤버·비멤버 역할에게는 **거부가 아니라 성공**이다 — 매트릭스에 넣으면 그 스펙이 의존하는
 * 계정 둘이 도중에 사라진다. 대신 미인증 거부는 여기서 같은 재생 방식으로 확인한다.
 */

const ORIGIN = 'http://localhost:3000';
const CONFIRM = '탈퇴합니다';

// global-setup이 센티널·dev DB 가드를 통과시킨 그 DB다. 여기서는 **읽기만** 한다.
const sql = neon(process.env.DATABASE_URL!);

let ownerCtx: BrowserContext;
let leaverCtx: BrowserContext;
/**
 * 쿠키 없는 컨텍스트. `newClientContext`를 쓰지 않는 이유는 **옥텟 배정을 아끼기 위해서**다 —
 * 그 헬퍼의 XFF 주입은 better-auth의 가입·로그인 제한 버킷을 가르려는 것인데, 이 컨텍스트는
 * 가입도 로그인도 하지 않고 `/`로 액션 POST만 한 번 던진다(그 경로는 제한 대상이 아니다).
 * 워커당 배정 상한(16)에 가까워질수록 조용히 겹치는 대신 여기서 안 쓰는 쪽이 낫다.
 */
let anonCtx: BrowserContext;

const fx = { gid: '', leaverEmail: '', deleteAccountActionId: '' };

/** 한 번의 실제 UI 상호작용에서 Next-Action id를 포획한다(빌드 산출물이라 소스에 적을 수 없다). */
async function captureActionId(page: Page, trigger: () => Promise<void>): Promise<string> {
  const pending = page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']);
  await trigger();
  const id = (await pending).headers()['next-action'];
  expect(id, 'Next-Action 헤더를 포획하지 못했다').toBeTruthy();
  return id;
}

/** 서버 액션 POST 재생 — `authz.spec.ts`와 같은 방식(그 파일 머리말에 근거가 있다). */
async function replayDeleteAccount(ctx: BrowserContext): Promise<string | null> {
  const res = await ctx.request.post(`${ORIGIN}/`, {
    headers: {
      'Next-Action': fx.deleteAccountActionId,
      'Content-Type': 'text/plain;charset=UTF-8',
      Origin: ORIGIN,
    },
    data: JSON.stringify([{ confirm: CONFIRM }]),
  });
  expect(res.status(), 'deleteAccount 재생이 200이 아니다').toBe(200);
  const body = await res.text();
  const found = body
    .split('\n')
    .map((line) => /^[0-9a-f]+:(\{.*\})$/.exec(line.trim())?.[1])
    .filter((json): json is string => !!json)
    .map((json) => JSON.parse(json) as Record<string, unknown>)
    .filter((o) => ['data', 'serverError', 'validationErrors'].some((k) => Object.hasOwn(o, k)));
  expect(found.length, `액션 결과 행을 찾지 못했다 — 재생이 액션에 닿지 않는다. 본문: ${body}`).toBe(1);
  return (found[0].serverError as string | undefined) ?? null;
}

test.describe.configure({ mode: 'serial' });

test.describe('회원 탈퇴', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);

    // ── 총무 영희: 모임을 만든다(그래서 탈퇴할 수 없다) ──────────────────────
    ownerCtx = await newClientContext(browser);
    const op = await ownerCtx.newPage();
    await op.goto('/login');
    await signUp(op, { name: '영희', email: testEmail('account', 'owner') });
    await expect(op).toHaveURL(/\/groups$/);
    fx.gid = await createGroup(op, '탈퇴테스트모임', '영희');

    await op.goto(`/groups/${fx.gid}/settings`);
    const invite = (await op.getByTestId('invite-link').innerText()).trim();

    // ── 민지: 멤버로 합류한다(그래서 탈퇴할 수 있다) ─────────────────────────
    leaverCtx = await newClientContext(browser);
    fx.leaverEmail = testEmail('account', 'leaver');
    const lp = await leaverCtx.newPage();
    await lp.goto(invite);
    await lp.getByTestId('join-login-link').click();
    await signUp(lp, { name: '민지', email: fx.leaverEmail });
    await expect(lp).toHaveURL(INVITE_JOIN_URL);
    await lp.getByTestId('join-display-name').fill('민지');
    await lp.getByTestId('join-submit').click();
    await expect(lp).toHaveURL(/\/groups\/[^/]+$/);
    await lp.close();

    anonCtx = await browser.newContext();
  });

  test.afterAll(async () => {
    await Promise.all([ownerCtx?.close(), leaverCtx?.close(), anonCtx?.close()]);
  });

  test('총무는 화면에서 막히고, 문구가 이유와 다음 행동을 알려준다', async () => {
    const page = await ownerCtx.newPage();
    // 계정 화면으로 가는 입구가 실재해야 한다 — 없으면 이 기능에 아무도 닿을 수 없다.
    await page.goto('/groups');
    await page.getByTestId('account-link').click();
    await expect(page).toHaveURL(/\/account$/);

    const blocked = page.getByTestId('delete-account-blocked');
    await expect(blocked).toContainText('탈퇴테스트모임');
    // "왜 안 되는가"와 "그래서 무엇을 하면 되는가"가 모두 있어야 한다(리뷰 MINOR 23).
    await expect(blocked).toContainText('먼저 삭제');
    await expect(blocked, '총무 위임이 미구현이라는 사실을 알려주지 않는다').toContainText(
      '넘기는 기능은 아직 없습니다',
    );
    // 막힌 상태에서는 확인 입력 자체가 없고 버튼도 눌리지 않는다.
    await expect(page.getByTestId('delete-account-confirm')).toHaveCount(0);
    await expect(page.getByTestId('delete-account')).toBeDisabled();
    await page.close();
  });

  test('멤버는 확인 문구를 정확히 입력해야 탈퇴할 수 있다', async () => {
    const page = await leaverCtx.newPage();
    await page.goto('/account');
    await expect(page.getByTestId('account-email')).toHaveText(fx.leaverEmail);

    const button = page.getByTestId('delete-account');
    const confirm = page.getByTestId('delete-account-confirm');
    await expect(button, '아무것도 입력하지 않았는데 버튼이 눌린다').toBeDisabled();
    await confirm.fill('탈퇴할래요');
    await expect(button, '틀린 문구인데 버튼이 눌린다').toBeDisabled();
    await confirm.fill(CONFIRM);
    await expect(button).toBeEnabled();

    fx.deleteAccountActionId = await captureActionId(page, () => button.click());
    await expect(page).toHaveURL(`${ORIGIN}/`);
    await page.close();

    // DB에서도 파기됐다 — 화면이 이동한 것과 파기가 일어난 것은 다른 주장이다.
    const [u] = (await sql`
      select email, name, deleted_at from "user" where email = ${fx.leaverEmail}`) as unknown[];
    expect(u, '탈퇴했는데 원래 이메일로 계정이 조회된다').toBeUndefined();
  });

  test('탈퇴 뒤에는 남아 있는 세션 쿠키가 화면에서도 액션에서도 통하지 않는다', async () => {
    // 쿠키가 **아직 브라우저에 있다**는 것이 이 테스트의 전제다 — 없으면 미인증 컨텍스트를
    // 시험하는 것이 되어 anonCtx와 구별되지 않는다.
    const cookies = await leaverCtx.cookies();
    expect(
      cookies.some((c) => c.name.includes('session')),
      '탈퇴 뒤 브라우저에 세션 쿠키가 남아 있지 않다 — 이 테스트의 전제가 깨졌다',
    ).toBe(true);

    // ① 화면: 인증이 필요한 경로는 로그인으로 보낸다.
    const page = await leaverCtx.newPage();
    await page.goto('/groups');
    await expect(page, '탈퇴한 쿠키로 모임 목록이 열린다').toHaveURL(/\/login/);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
    await page.close();

    // ② 서버 액션: 화면을 건너뛴 재생도 막힌다. 리다이렉트는 화면의 성질이고,
    //    거부는 서버의 성질이다 — 둘은 다른 주장이다(authz.spec 머리말과 같은 이유).
    expect(await replayDeleteAccount(leaverCtx), '탈퇴한 세션으로 액션이 통과했다').toBe(
      'UNAUTHENTICATED',
    );
    expect(await replayDeleteAccount(anonCtx)).toBe('UNAUTHENTICATED');
  });

  test('남은 총무의 화면에서 탈퇴자는 이름만 바뀐 채 그 자리에 있다', async () => {
    const page = await ownerCtx.newPage();
    await page.goto(`/groups/${fx.gid}/settings`);
    const rows = page.getByTestId('member-row');
    // 멤버십 행을 **지우지 않으므로** 인원이 줄지 않는다 — 지웠다면 과거 회비 납부 체크가
    // 함께 사라져 낸 사람이 안 낸 사람이 된다(ADR-004).
    await expect(rows, '탈퇴로 멤버 행이 사라졌다').toHaveCount(2);
    await expect(rows.filter({ hasText: '탈퇴한 멤버' })).toHaveCount(1);
    await expect(page.getByTestId('member-row').filter({ hasText: '민지' })).toHaveCount(0);
    await page.close();
  });

  test('탈퇴한 이메일로 다시 가입할 수 있다', async () => {
    const page = await leaverCtx.newPage();
    await page.goto('/login');
    await signUp(page, { name: '민지', email: fx.leaverEmail });
    // 이메일이 비워지지 않았다면 여기서 "이미 가입된 이메일" 에러에 걸려 이동하지 않는다.
    await expect(page, '탈퇴한 이메일로 재가입이 막혔다').toHaveURL(/\/groups$/);
    // 재가입자는 **다른 사람**이다 — 옛 모임이 딸려 오지 않는다.
    await expect(page.getByTestId('group-list-item')).toHaveCount(0);
    await page.close();
  });
});
