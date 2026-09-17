import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  createGroup,
  exactAmount,
  groupForbiddenValues,
  newClientContext,
  signUp,
  testEmail,
  type Forbidden,
} from './helpers';

/**
 * 공개 장부(F5) 유출 테스트 — **이 레포에서 가장 중요한 보안 테스트**.
 *
 * `/g/:token`은 인증 없이 데이터를 내보내는 **유일한** 라우트다. 여기서 한 번 실수하면
 * 링크를 주운 사람이 남의 모임 돈 기록을 보게 되고, 토큰·이메일·id가 함께 새면 다른 경로를
 * 두드릴 재료까지 넘어간다. 그래서 이 스펙은 "화면이 잘 보이는가"가 아니라
 * **"보이면 안 되는 것이 한 바이트도 안 나가는가"**를 본다.
 *
 * ── 왜 `page.content()`가 아니라 `request.get()`의 원시 본문인가 ──────────────
 * `page.content()`는 브라우저가 파싱·정규화한 **DOM 직렬화**다. 원본 HTML과 다르고,
 * 특히 `<script>self.__next_f.push(...)</script>`의 flight 페이로드가 이스케이프 형태로
 * 달라질 수 있다. 서버가 실제로 내보낸 바이트를 봐야 유출 검사가 성립한다.
 *
 * ── 이 검사가 무력하지 않다는 증거 ──────────────────────────────────────────
 * 플랜 Task 8 Step 6의 뮤테이션(전체 `groups` 행을 클라이언트 컴포넌트 prop으로 넘기기)으로
 * 이 스펙이 실제로 빨개지는 것을 확인했다. 검사 목록을 줄이거나 검사 대상을 바꿀 때는
 * 그 뮤테이션을 다시 돌려 여전히 빨개지는지 확인할 것.
 *
 * ── `publicToken`은 금칙 목록에 **없다** ────────────────────────────────────
 * 토큰은 이미 주소창에 있고, Next가 라우트 파라미터를 부트스트랩·flight 페이로드에 싣는 것은
 * 정상 동작이다. 금지하면 보안은 하나도 늘지 않고 테스트만 깨진다(외부 리뷰 IMPORTANT 15).
 * 그래서 이 스펙은 공용 목록(`groupForbiddenValues`)에서 그 한 항목만 덜어낸다.
 */

const ORIGIN = 'http://localhost:3000';

/**
 * 입금 계좌 문구(Task 10) — **다른 어떤 픽스처도 만들 수 없는 값**으로 둔다.
 * 원시 HTML에서 이 문자열이 하나라도 잡히면 출처를 따질 필요가 없다: 계좌가 샌 것이다.
 */
const ACCOUNT_LABEL = '누출탐지은행 0000-ACCT-LEAK-PUBLIC-7391 민지';

const fx = {
  groupId: '',
  publicToken: '',
  inviteToken: '',
  /** 공개 링크 전체 URL(재발급 전). */
  publicUrl: '',
};

let ownerCtx: BrowserContext;
let ownerPage: Page;
/** 쿠키가 하나도 없는 방문자 — 공개 링크가 정말 로그인 없이 열리는지 보는 컨텍스트. */
let anonCtx: BrowserContext;

const forbidden: Forbidden[] = [];

/**
 * 인라인 스크립트에 실린 flight 페이로드만 따로 뽑는다.
 *
 * 원시 본문 전체 검사로 이미 덮이지만, 이걸 따로 보는 이유는 **실패했을 때 어디서 샜는지**가
 * 바로 드러나기 때문이다 — "본문 어딘가"와 "flight 페이로드 안"은 원인이 완전히 다르다.
 */
function flightPayloads(html: string): string {
  return [...html.matchAll(/self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g)]
    .map((m) => m[1])
    .join('\n');
}

/**
 * 금칙 검사 — 본문 전체와 flight 페이로드를 각각 본다.
 *
 * `urlToken`은 **그 요청의 주소에 내가 직접 넣은 토큰**이다. Next는 라우트 파라미터를
 * 부트스트랩·flight 페이로드에 싣기 때문에(`"c":["","g","<token>"]`) 주소에 있는 값은 응답에도
 * 반드시 나타난다 — `publicToken`을 금칙 목록에서 뺀 것과 **정확히 같은 이유**다.
 * 그래서 주소에 실어 보낸 값 자체는 검사에서 제외한다. 제외하지 않으면 "초대 토큰으로
 * 공개 장부를 열어봤다"는 프로브가 자기 자신 때문에 빨개진다(실제로 한 번 그렇게 죽었다).
 *
 * ⚠️ 제외는 **이 요청의 URL에 있는 값 하나뿐**이다. 나머지 금칙 값은 그대로 다 검사한다.
 */
function expectNoLeaks(html: string, where: string, urlToken?: string) {
  const flight = flightPayloads(html);
  expect(flight.length, `${where}: flight 페이로드를 하나도 못 찾았다 — 검사가 헛돌고 있다`).toBeGreaterThan(0);
  const checked = forbidden.filter((f) => f.value !== urlToken);
  expect(checked.length, `${where}: 검사할 금칙 값이 없다 — 전부 제외됐다`).toBeGreaterThan(0);
  for (const { label, value } of checked) {
    expect(value, `금칙 값 ${label}이 비어 있다 — 준비가 잘못됐다`).toBeTruthy();
    expect(html, `${where}: 원시 응답 본문에 ${label}이 들어 있다`).not.toContain(value);
    expect(flight, `${where}: flight 페이로드에 ${label}이 들어 있다`).not.toContain(value);
  }
}

/**
 * 한 화면이 **외부 호스트로 요청을 하나도 보내지 않음**을 단언한다.
 *
 * 공개 장부와 처리방침 둘 다 이 규칙을 지켜야 하므로 한 곳에 둔다(리뷰 MINOR 21) —
 * 두 벌로 베껴 두면 한쪽만 고쳐져 규칙의 절반이 검사되지 않는 상태가 된다.
 *
 * `networkidle`까지 기다리는 이유: 폰트·이미지는 초기 HTML 파싱 이후에 붙는 경우가 많아,
 * `load`에서 끊으면 늦게 나가는 외부 요청을 놓친다.
 */
async function expectNoExternalRequests(url: string, where: string) {
  const page = await anonCtx.newPage();
  const external: string[] = [];
  let observed = 0;
  page.on('request', (r) => {
    observed += 1;
    if (new URL(r.url()).origin !== ORIGIN) external.push(r.url());
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  // 요청을 하나도 못 봤다면 "외부 요청 0건"은 관측이 아니라 공백이다 — 그 상태를 통과시키지 않는다.
  expect(observed, `${where}: 요청을 하나도 관찰하지 못했다 — 검사가 헛돌고 있다`).toBeGreaterThan(0);
  expect(external, `${where}: 외부 호스트 요청이 있다: ${external.join(', ')}`).toEqual([]);
  await page.close();
}

/** 공개 라우트의 응답 헤더 3종. 200이든 404든 똑같이 붙어야 한다. */
function expectPublicHeaders(headers: Record<string, string>, where: string) {
  // private/no-store의 순서·병기는 Next가 정규화할 수 있으므로 토큰 포함 여부로 본다.
  expect(headers['cache-control'], `${where}: cache-control에 no-store가 없다`).toContain('no-store');
  expect(headers['referrer-policy'], `${where}: Referrer-Policy가 no-referrer가 아니다`).toBe('no-referrer');
  expect(headers['x-robots-tag'], `${where}: X-Robots-Tag에 noindex가 없다`).toContain('noindex');
}

test.describe.configure({ mode: 'serial' });

test.describe('공개 장부 — 링크 하나로 열리되 그 밖의 것은 새지 않는다', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);

    const ownerEmail = testEmail('public', 'owner');

    ownerCtx = await newClientContext(browser);
    ownerPage = await ownerCtx.newPage();
    // 정정은 window.confirm을 거친다 — 핸들러가 없으면 자동 dismiss되어 클릭이 무효다.
    ownerPage.on('dialog', (d) => d.accept());

    await ownerPage.goto('/login');
    await signUp(ownerPage, { name: '민지', email: ownerEmail });
    await expect(ownerPage).toHaveURL(/\/groups$/);
    fx.groupId = await createGroup(ownerPage, '공개모임', '민지');

    // ── 장부에 세 종류를 다 채운다: 지출 / 회비 납부 / 정정 ────────────────────
    await ownerPage.getByTestId('tab-지출').click();
    await expect(ownerPage).toHaveURL(/\/expenses$/);

    await ownerPage.getByTestId('expense-amount-input').fill('48000');
    await ownerPage.getByTestId('expense-date').fill('2026-01-20');
    await ownerPage.getByTestId('expense-memo').fill('9월 회식');
    await ownerPage.getByTestId('expense-submit').click();
    await expect(ownerPage.getByTestId('expense-row')).toHaveCount(1);

    await ownerPage.getByTestId('expense-amount-input').fill('9000');
    await ownerPage.getByTestId('expense-date').fill('2026-01-10');
    await ownerPage.getByTestId('expense-memo').fill('프린터 용지');
    await ownerPage.getByTestId('expense-submit').click();
    await expect(ownerPage.getByTestId('expense-row')).toHaveCount(2);

    // 위쪽(2026-01-20) 행을 정정한다 → 원본 + 역분개 두 행이 생긴다.
    await ownerPage.getByTestId('reverse-button').first().click();
    await expect(ownerPage.getByTestId('expense-reversal')).toHaveCount(1);

    await ownerPage.getByTestId('tab-회비').click();
    await expect(ownerPage).toHaveURL(/\/dues$/);
    await ownerPage.getByTestId('round-period').fill('2026-01');
    await ownerPage.getByTestId('round-amount').fill('20000');
    await ownerPage.getByTestId('round-create').click();
    await expect(ownerPage).toHaveURL(/\/dues\/[^/]+$/);
    await ownerPage.getByTestId('payment-toggle').click();
    await expect(ownerPage.getByTestId('round-total-collected')).toHaveText(/20,000/);

    // ── 입금 계좌를 설정한다 (Task 10) ────────────────────────────────────────
    // 이 값이 저장돼 있어야 "공개 장부에 계좌가 없다"는 단언이 내용을 갖는다 —
    // 설정하지 않으면 금칙 값이 비고, `groupForbiddenValues`가 그것을 깨서 알려준다.
    await ownerPage.goto(`/groups/${fx.groupId}/settings`);
    await ownerPage.getByTestId('account-label').fill(ACCOUNT_LABEL);
    await ownerPage.getByTestId('account-save').click();
    await expect(ownerPage.getByTestId('account-save')).toHaveText('저장됨');
    // 새로 받아 온 화면에도 남아 있는지 — 저장이 진짜로 DB까지 갔다는 증거.
    await ownerPage.reload();
    await expect(ownerPage.getByTestId('account-label')).toHaveValue(ACCOUNT_LABEL);

    // ── 공개 링크를 설정 화면에서 복사 ─────────────────────────────────────────
    const linkLocator = ownerPage.getByTestId('public-link');
    await expect(linkLocator).toContainText(`${ORIGIN}/g/`);
    fx.publicUrl = (await linkLocator.innerText()).trim();
    fx.publicToken = fx.publicUrl.split('/g/')[1];
    // 128비트 base64url = 22자. 초대 토큰(12자)과 길이로도 구별된다.
    expect(fx.publicToken, '공개 토큰이 128비트가 아니다').toHaveLength(22);

    // ── 금칙 목록 — 공용 목록에서 publicToken 하나만 덜어낸다 ─────────────────
    // 덜어내는 이유는 파일 머리말의 마지막 단락과 같다(주소창에 있는 값이다). 나머지는 전부
    // 검사한다 — 초대 토큰·groupId·이메일·userId·세션 토큰·**계좌 문구**.
    const all = await groupForbiddenValues(fx.groupId);
    forbidden.push(...all.filter((f) => f.value !== fx.publicToken));
    expect(
      forbidden.map((f) => f.label),
      '계좌 문구가 금칙 목록에 없다 — Task 10의 규칙 절반이 검사되지 않는다',
    ).toContain('accountLabel(입금 계좌 문구)');
    fx.inviteToken = all.find((f) => f.label.startsWith('inviteToken'))!.value;

    anonCtx = await newClientContext(browser);
  });

  test.afterAll(async () => {
    await Promise.all([ownerCtx?.close(), anonCtx?.close()]);
  });

  test('쿠키 없는 방문자가 링크만으로 장부를 본다', async () => {
    const page = await anonCtx.newPage();
    // 이 컨텍스트에 쿠키가 정말 없는지 먼저 못 박는다 — 있으면 "인증 없이"라는 주장이 거짓이 된다.
    expect(await anonCtx.cookies(), '익명 컨텍스트에 쿠키가 있다').toEqual([]);

    await page.goto(fx.publicUrl);
    await expect(page.getByTestId('public-group-name')).toHaveText('공개모임');
    // 잔액 = 회비 20,000 − 지출 9,000 (48,000은 정정돼 상쇄) = 11,000
    await expect(page.getByTestId('public-balance')).toHaveText(exactAmount('11,000'));
    await expect(page.getByTestId('public-member')).toHaveCount(1);
    await expect(page.getByTestId('public-member').first()).toContainText('민지');

    /**
     * 원장 **전부** — 지출 2 + 정정 1 + 회비 납부 1 = 4행 (direction.md Q3의 예외 = A).
     * 지출 화면은 정정을 원본에 접어 넣어 2행만 보이지만, 이 화면은 목적이 검증이므로
     * 원본과 정정이 **둘 다** 행으로 남아야 한다. 이 숫자가 그 규칙을 고정한다.
     */
    await expect(page.getByTestId('public-entry-row')).toHaveCount(4);
    // 정정된 원본과 그 정정 행이 둘 다 보인다.
    await expect(page.getByTestId('public-entry-row').filter({ hasText: '정정됨' })).toHaveCount(1);
    await expect(page.getByTestId('public-entry-row').filter({ hasText: '↳ 정정' })).toHaveCount(1);
    // 쓰기 UI·로그인 유도는 없다.
    await expect(page.getByTestId('expense-form')).toHaveCount(0);
    await expect(page.getByTestId('reverse-button')).toHaveCount(0);
    await page.close();
  });

  test('원시 응답 본문과 flight 페이로드에 토큰·이메일·id가 없다', async () => {
    const res = await anonCtx.request.get(fx.publicUrl);
    expect(res.status()).toBe(200);
    const html = await res.text();
    // 검사 대상이 실제 장부 화면인지 먼저 확인한다 — 엉뚱한 페이지를 검사하고 초록이 되면 안 된다.
    expect(html, '장부 화면이 아니다').toContain('공개모임');
    expectNoLeaks(html, '공개 장부 200');
  });

  test('응답 헤더가 캐시·리퍼러·색인을 모두 막는다', async () => {
    const res = await anonCtx.request.get(fx.publicUrl);
    expect(res.status()).toBe(200);
    expectPublicHeaders(res.headers(), '공개 장부 200');
  });

  /**
   * `Referrer-Policy`가 **실제로 동작하는지**를 헤더 존재가 아니라 결과로 본다.
   *
   * 이 헤더가 없으면 하단 랜딩 링크를 누르는 순간 브라우저가
   * `Referer: …/g/<publicToken>`을 붙여 보낸다 — 같은 출처라 기본 정책으로는 경로가 통째로 실린다.
   * 즉 "링크를 아는 사람만"이 서버 로그·프록시·다음 페이지의 JS에 그대로 흘러나간다.
   */
  test('하단 링크를 눌러도 토큰이 Referer로 나가지 않는다', async () => {
    const page = await anonCtx.newPage();
    await page.goto(fx.publicUrl);

    const referers: (string | undefined)[] = [];
    page.on('request', (r) => referers.push(r.headers()['referer']));

    await page.getByRole('link', { name: '엔빵으로 만든 장부입니다' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/`);

    expect(referers.length, '이동 요청을 하나도 관찰하지 못했다').toBeGreaterThan(0);
    for (const ref of referers) {
      // 관찰 결과(2026-09-15): Chromium/Playwright는 no-referrer일 때 헤더를 **빈 문자열**로
      // 보고한다(`undefined`가 아니다). 그래서 "헤더가 없다"가 아니라 **"값이 비어 있다"**를
      // 단언한다 — 토큰도, 경로도, origin조차 실리지 않았음을 그것이 증명한다.
      // 헤더를 지우면 이 값이 `http://localhost:3000/g/<token>`이 되어 이 단언이 빨개진다(실측).
      expect(ref ?? '', `Referer에 무언가 실렸다: ${ref}`).toBe('');
    }
    await page.close();
  });

  /**
   * 서드파티 리소스 금지의 증거. 외부 요청 하나면 그 요청의 `Referer`나 URL로 토큰이 나간다.
   * (루트 레이아웃은 `next/font`를 쓰므로 폰트가 자기 호스트에서 서빙된다 — 이 단언이
   *  누군가 CDN 폰트·애널리틱스를 붙이는 순간 빨개진다.)
   */
  test('외부 호스트로 요청을 하나도 보내지 않는다', async () => {
    await expectNoExternalRequests(fx.publicUrl, '공개 장부');
  });

  /**
   * **처리방침까지 같은 규칙을 적용한다** (외부 리뷰 MINOR 21).
   *
   * 공개 장부 푸터에서 한 번의 클릭으로 닿는 화면이므로, 여기에 원격 폰트·이미지가 붙으면
   * 그 요청이 장부를 보던 사람의 브라우저에서 나간다. 깨지는 경로는 링크 자체가 아니라
   * **그 페이지가 외부 리소스를 들이는 것**이다 — 그래서 단언은 링크가 아니라 요청을 센다.
   */
  test('처리방침도 외부 호스트로 요청을 하나도 보내지 않는다', async () => {
    await expectNoExternalRequests(`${ORIGIN}/privacy`, '처리방침');
  });

  /**
   * 처리방침은 **로그인 없이** 열려야 한다. 이 화면을 읽어야 하는 사람 중에는 아직 계정이 없는
   * 사람(가입 직전)과 앞으로도 계정을 만들지 않을 사람(공개 장부만 보는 멤버)이 있다.
   *
   * 보관기간 문자열을 함께 못 박는다: 이 숫자는 `app/api/cron/cleanup/route.ts`의 계산에서 나온
   * 값이고 "24시간"으로 되돌아가기 쉬운 자리다(플랜 초안이 그렇게 적었다). 크론이 하루 한 번만
   * 돌 수 있는 한 24시간은 지킬 수 없는 약속이므로, 화면에서 그 값을 고정한다.
   */
  test('처리방침이 쿠키 없는 방문자에게 200으로 열린다', async () => {
    const res = await anonCtx.request.get(`${ORIGIN}/privacy`);
    expect(res.status(), '처리방침이 200이 아니다').toBe(200);
    const html = await res.text();
    expect(html, '처리방침 화면이 아니다').toContain('개인정보처리방침');
    expect(html, 'IP 해시 보관기간이 화면에 없다').toContain('최대 48시간');
    expect(html, '탈퇴 후에도 남는 것에 대한 고지가 없다').toContain('탈퇴해도 남는 것');
  });

  /** 인지 경로 — 장부를 보던 사람이 푸터에서 한 번에 닿는다. */
  test('공개 장부 푸터에서 처리방침으로 이동한다', async () => {
    const page = await anonCtx.newPage();
    await page.goto(fx.publicUrl);
    await page.getByRole('link', { name: '개인정보처리방침' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/privacy`);
    await expect(page.getByTestId('page-title')).toHaveText('개인정보처리방침');
    await page.close();
  });

  test('잘못된 토큰은 모임의 존재 여부를 알려주지 않는 404다', async () => {
    // 두 토큰 모두 존재하지 않는다 — 하나는 무작위, 하나는 **초대 토큰**이다.
    // 초대 토큰으로 공개 장부가 열리면 두 링크의 권한 차이가 무너진다.
    for (const bad of ['zzzzzzzzzzzzzzzzzzzzzz', fx.inviteToken, 'x']) {
      const res = await anonCtx.request.get(`${ORIGIN}/g/${bad}`);
      expect(res.status(), `${bad}: 404가 아니다`).toBe(404);
      const html = await res.text();
      expect(html, `${bad}: 404 본문에 모임명이 들어 있다`).not.toContain('공개모임');
      // `bad`는 내가 주소에 넣은 값이므로 그것만 제외한다 — 초대 토큰 프로브가 자기 자신에 걸리지 않게.
      expectNoLeaks(html, `404(${bad})`, bad);
      // 404에도 같은 헤더가 붙어야 한다 — 캐시된 404가 나중에 정상 링크를 가로막지 않게.
      expectPublicHeaders(res.headers(), `404(${bad})`);
    }
  });

  /**
   * 재발급의 핵심 주장: **옛 링크가 즉시 죽는다**.
   *
   * `request.get()`으로 같은 URL을 다시 부른다 — 브라우저 렌더 캐시를 거치지 않는 경로라
   * 어딘가(Next 렌더 캐시·CDN·keep-alive 프록시)에 옛 응답이 남아 있으면 여기서 200이 나온다.
   * 이 검사는 마지막에 둔다 — 앞의 테스트들이 쓰는 `fx.publicUrl`을 무효화하기 때문이다.
   */
  test('재발급하면 옛 링크는 404, 새 링크는 200이다', async () => {
    const oldUrl = fx.publicUrl;
    const oldToken = fx.publicToken;

    // 재발급 전에는 200임을 못 박는다 — 뒤의 404가 "원래부터 안 됐다"가 아님을 보인다.
    expect((await anonCtx.request.get(oldUrl)).status(), '재발급 전 옛 링크가 200이 아니다').toBe(200);

    await ownerPage.goto(`/groups/${fx.groupId}/settings`);
    /**
     * 노출 고지가 **재발급 버튼 위에** 있다(리뷰 IMPORTANT 16). 위치까지 보는 이유:
     * 버튼 아래로 내려가면 "복사 → 공유"가 끝난 뒤에 읽히는 사후 통보가 된다.
     */
    const notice = ownerPage.getByTestId('public-link-notice');
    await expect(notice).toContainText('로그인 없이');
    await expect(notice).toContainText('즉시');
    const noticeBox = (await notice.boundingBox())!;
    const buttonBox = (await ownerPage.getByTestId('public-regenerate').boundingBox())!;
    expect(noticeBox.y, '노출 고지가 재발급 버튼보다 아래에 있다').toBeLessThan(buttonBox.y);

    await ownerPage.getByTestId('public-regenerate').click();
    await expect(ownerPage.getByTestId('public-link')).not.toHaveText(oldUrl);

    const newUrl = (await ownerPage.getByTestId('public-link').innerText()).trim();
    const newToken = newUrl.split('/g/')[1];
    expect(newToken, '새 토큰이 옛 토큰과 같다').not.toBe(oldToken);
    expect(newToken, '새 토큰도 128비트여야 한다').toHaveLength(22);

    const oldRes = await anonCtx.request.get(oldUrl);
    expect(oldRes.status(), '옛 링크가 아직 열린다 — 캐시가 살아 있거나 재발급이 안 됐다').toBe(404);
    expectPublicHeaders(oldRes.headers(), '재발급 후 옛 링크');

    /**
     * "모임의 존재 여부를 알려주지 않는다"를 **가장 강한 형태로** 못 박는다.
     *
     * 재발급으로 죽은 토큰(= 진짜 모임이 있었던 주소)과 순수 쓰레기 토큰의 404가
     * **토큰 문자열을 빼면 한 바이트도 다르지 않아야** 한다. 응답 길이·본문 차이가 조금이라도
     * 남으면 그것이 "이 주소에는 뭔가 있었다"는 신호가 되어 열거에 정보를 준다.
     */
    const garbage = 'Zg'.repeat(11); // 22자, 존재할 수 없는 값
    const garbageRes = await anonCtx.request.get(`${ORIGIN}/g/${garbage}`);
    expect(garbageRes.status()).toBe(404);
    const normalize = (html: string, token: string) => html.split(token).join('<TOKEN>');
    expect(
      normalize(await oldRes.text(), oldToken),
      '죽은 토큰과 쓰레기 토큰의 404가 다르다 — 차이가 모임의 존재를 알려준다',
    ).toBe(normalize(await garbageRes.text(), garbage));

    const newRes = await anonCtx.request.get(newUrl);
    expect(newRes.status(), '새 링크가 열리지 않는다').toBe(200);
    const newHtml = await newRes.text();
    expect(newHtml).toContain('공개모임');
    expectNoLeaks(newHtml, '재발급 후 새 링크');
    // 옛 토큰이 새 응답에 남아 있으면 재발급이 반쪽이다.
    expect(newHtml, '새 응답에 옛 토큰이 남아 있다').not.toContain(oldToken);
  });
});
