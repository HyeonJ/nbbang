import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { createGroup, INVITE_JOIN_URL, newClientContext, signUp, testEmail } from './helpers';

/**
 * 인가 매트릭스 — 서버 액션 POST를 **세션별로 직접 재생**해 거부 코드를 고정한다.
 *
 * ── 왜 이 스펙이 존재하는가 ─────────────────────────────────────────────────
 * ADR-002(서버 액션 인가)의 가장 강한 증거는 Plan 02에서 **손으로** 액션 POST를 재생해 얻었다
 * (멤버 → FORBIDDEN, 타 모임 id → ENTRY_NOT_FOUND …). 그 증거는 전부 재현 불가였다.
 * 이 스펙이 그 계열의 확인을 매 푸시마다 CI가 하게 만든다.
 *
 * ── 왜 UI 클릭으로는 안 되는가 ──────────────────────────────────────────────
 * 거부 경로에는 **누를 것이 없다**. 멤버·비멤버 화면에는 지출 폼도, 정정 버튼도, 납부 토글도
 * 렌더되지 않는다(ledger.spec이 그 부재를 단언한다). 그래서 "버튼이 없다"는 화면의 성질이고,
 * "액션이 거부한다"는 서버의 성질이다 — 둘은 다른 주장이며 후자는 화면을 통해 확인할 수 없다.
 *
 * ── 재생 방식: `context.request.post` + `Next-Action` 헤더 ──────────────────
 * Plan 02가 검증한 두 방식(`page.route`로 postData 교체 / `Next-Action` 헤더 직접 POST) 중
 * 후자를 택했다. 이유 세 가지:
 *  1) `page.route`는 **실제로 나가는 요청**을 가로채 고치는 방식이라 거부 역할에는 쓸 수 없다 —
 *     가로챌 요청 자체가 발생하지 않는다(위 단락).
 *  2) `BrowserContext.request`는 그 컨텍스트의 **쿠키를 그대로 쓴다** — "이 세션으로"가 문자
 *     그대로 성립한다. 컨텍스트 = 사람이라는 이 레포의 규약(helpers.newClientContext)과 맞는다.
 *  3) 재생 대상 경로를 `/`로 두면 응답이 액션 결과 한 줄뿐인 최소 플라이트 페이로드다
 *     (`1:{"serverError":"NOT_MEMBER"}`) — 페이지 렌더가 섞이지 않아 단언이 정확해진다.
 *
 * `Next-Action` id는 **빌드마다 달라진다**. 그래서 하드코딩하지 않고, 총무가 실제 UI로 그
 * 액션을 한 번 성공시키는 동안 네트워크에서 **포획**한다(`captureActionId`). 부수 효과로
 * "이 id가 정말 그 액션인가"가 포획 자체로 증명된다 — 마지막 테스트의 성공 대조군이 이를 못 박는다.
 */

const ORIGIN = 'http://localhost:3000';

/**
 * 쓰기 액션 8종. 값은 포획한 Next-Action id.
 *
 * `regenerate*` 둘은 원래 이 매트릭스에 없었다 — 포획하려면 총무가 실제로 재발급을 해야
 * 하고, 그러면 **네 번째 역할이 읽는 공개 링크가 그 자리에서 죽는다**. 순서로 풀었다:
 * 재발급을 먼저 하고 그 뒤에 공개 링크를 읽는다(beforeAll), 성공 대조군은 맨 마지막 테스트다.
 * 이 둘이 빠져 있으면 `assertOwner`를 지나는 액션 중 **링크 재발급만** 인가 회귀 감시 밖에 남는다
 * — 토큰 재발급은 "옛 링크를 죽이는" 쓰기이므로 남이 부를 수 있으면 모임 장부 접근이 끊긴다.
 *
 * `deleteGroup`(Plan 04 Task 2)은 그 문제의 **극단**이다: 포획하려면 총무가 실제로 모임을
 * 지워야 하는데 지워진 모임은 되돌아오지 않는다. 재발급의 해법(순서)을 그대로 쓰되 한 단계 더
 * 간다 — 포획 전용으로 **버리는 모임 C**를 만들어 그것을 UI로 지우면서 id를 얻고(beforeAll),
 * 매트릭스 본편은 모임 A를 대상으로 거부를 확인한 뒤, 성공 대조군에서 비로소 A를 지운다.
 * 그래서 삭제의 성공 대조군은 **파일의 맨 마지막 테스트**다(describe가 serial이라 선언 순서 = 실행 순서).
 */
type ActionName =
  | 'createExpense'
  | 'reverseEntry'
  | 'createRound'
  | 'markPaid'
  | 'unmarkPaid'
  | 'regenerateInviteToken'
  | 'regeneratePublicToken'
  | 'deleteGroup';
const ids = {} as Record<ActionName, string>;

/** 재생에 쓸 소재 — 모임 A(총무·멤버)와 남의 모임 B. */
const fx = {
  gidA: '',
  gidB: '',
  /** `deleteGroup`의 id를 포획하기 위해 만들고 곧바로 UI로 지우는 모임. 소재가 아니라 제물이다. */
  gidC: '',
  roundIdA: '',
  roundIdB: '',
  /** 정정하지 않고 남겨 둔 A의 지출 — "정상 대상" 자리. */
  entryA: '',
  /** 이미 정정된 A의 지출 → ALREADY_REVERSED. */
  reversedEntryA: '',
  /** 그 정정 엔트리 자체 → NOT_REVERSIBLE. */
  reversalEntryA: '',
  entryB: '',
  ownerMembershipA: '',
  memberMembershipA: '',
  membershipB: '',
};

let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let outsiderCtx: BrowserContext;
let anonCtx: BrowserContext;
/**
 * 네 번째 역할: **공개 장부 링크만 가진 방문자**(Plan 03 Task 8).
 *
 * 이 매트릭스는 원래 쓰기 3역할(총무·멤버·비멤버)만 덮었다. 공개 장부가 생기면서
 * "읽을 권한이 있는 미인증 방문자"라는 **새로운 종류의 주체**가 나타났고, 그 사람이 읽기에서
 * 쓰기로 넘어갈 수 있는지는 기존 세 역할 중 어느 것도 답하지 않는다.
 * 공개 토큰은 **읽기 전용 베어러**여야 한다 — 쿠키가 아니므로 세션이 되지 않고,
 * 따라서 쓰기 액션 8종은 전부 `UNAUTHENTICATED`로 떨어져야 한다.
 */
let publicVisitorCtx: BrowserContext;
/** 그 방문자가 실제로 장부를 **읽을 수 있는** 링크 — 읽기 권한이 있다는 전제가 참이어야 한다. */
let publicUrl = '';

// DATABASE_URL은 playwright.config.ts가 .env.test에서 로드했거나 CI가 주입한 값 —
// global-setup이 이미 센티널·dev DB 가드를 통과시킨 그 DB다. 여기서는 **읽기만** 한다.
const sql = neon(process.env.DATABASE_URL!);

/**
 * 쓰기가 샜는지 보는 상태 — 거부 뒤에 이 중 하나라도 움직이면 인가가 뚫린 것이다.
 * 행 계수 셋 + **토큰 값**이다(재발급 액션은 행을 늘리지 않고 값을 덮어쓴다).
 *
 * ⚠️ 반드시 이 스펙의 두 모임으로 **스코프**한다. 전역 count로 세면 같은 창에서 병렬로 도는
 * 다른 스펙(ledger.spec)의 쓰기가 섞여 들어와 기준값이 흔들린다 — 인가와 무관한 플레이키가 된다.
 * 이 스펙이 액션에 넘기는 groupId는 A와 B뿐이므로, 두 모임을 덮으면 누출 경로를 다 덮는다.
 */
async function writeCounts() {
  const [row] = await sql`
    select
      (select count(*)::int from ledger_entries where group_id in (${fx.gidA}, ${fx.gidB})) as entries,
      (select count(*)::int from dues_payments  where group_id in (${fx.gidA}, ${fx.gidB})) as payments,
      (select count(*)::int from dues_rounds    where group_id in (${fx.gidA}, ${fx.gidB})) as rounds,
      -- 재발급 액션의 쓰기는 **행을 늘리지 않는다** — groups의 두 컬럼을 덮어쓴다. 계수만 보면
      -- 그 유출이 전부 보이지 않으므로 토큰 값 자체를 상태에 넣는다. 부수 효과로 다른 다섯
      -- 액션의 거부도 "토큰을 건드리지 않았다"까지 함께 단언하게 된다.
      (select string_agg(invite_token || '|' || public_token, ',' order by id)
         from groups where id in (${fx.gidA}, ${fx.gidB})) as tokens`;
  return row as {
    entries: number;
    payments: number;
    rounds: number;
    tokens: string;
  };
}

/**
 * 한 번의 실제 UI 상호작용에서 Next-Action id를 포획한다.
 * id는 빌드 산출물이라 소스에 적어둘 수 없다 — 실제 요청에서 읽는 것이 유일하게 안전한 방법이다.
 */
async function captureActionId(page: Page, trigger: () => Promise<void>): Promise<string> {
  const pending = page.waitForRequest(
    (r) => r.method() === 'POST' && !!r.headers()['next-action'],
  );
  await trigger();
  const id = (await pending).headers()['next-action'];
  expect(id, 'Next-Action 헤더를 포획하지 못했다').toBeTruthy();
  return id;
}

/** 서버 액션 POST 재생. 인자는 하나(입력 객체)이므로 본문은 길이 1의 JSON 배열이다. */
async function replay(ctx: BrowserContext, action: ActionName, input: unknown): Promise<string> {
  const res = await ctx.request.post(`${ORIGIN}/`, {
    headers: {
      'Next-Action': ids[action],
      // 브라우저가 보내는 것과 같은 모양 — 액션 본문은 text/plain으로 실려간다.
      'Content-Type': 'text/plain;charset=UTF-8',
      // 서버 액션은 Origin과 Host를 대조한다. 실제 요청과 같게 실어 그 검사를 통과시킨다.
      Origin: ORIGIN,
    },
    data: JSON.stringify([input]),
  });
  expect(res.status(), `${action} 재생이 200이 아니다`).toBe(200);
  return res.text();
}

/** next-safe-action이 돌려주는 결과 봉투. 이 세 키 말고는 들어오지 않는다. */
const RESULT_KEYS = ['data', 'serverError', 'validationErrors'] as const;

/**
 * 플라이트 응답에서 **액션 결과 객체 한 개**를 꺼낸다 — 모양까지 확인한다.
 *
 * ── 왜 정규식 한 줄로는 부족한가 ────────────────────────────────────────────
 * 원래 이 파일은 응답 본문을 `/"serverError":"([^"]+)"/`로 긁었다. 그 방식은 **응답이 액션
 * 결과가 아니게 된 것을 구별하지 못한다.** 재생 대상은 `/`이고(헤더 주석 3번), 지금 `/`는
 * 인증 없이 열리므로 응답은 액션 결과 한 줄뿐인 최소 페이로드다. 그런데 `/`가 언젠가
 * 로그인 뒤로 들어가면(랜딩을 대시보드로 바꾸는 흔한 변경) 미인증·공개방문자 컨텍스트의 POST는
 * 액션에 닿기 전에 리다이렉트·로그인 렌더로 갈리고, 본문에는 `serverError`가 아예 없어진다.
 * 그때 `?? null`은 "성공"과 구별되지 않는 `null`을 돌려준다 — `expectAllowed`는 본문에
 * `"data"`라는 **문자열이 있는지**만 봤으므로, 렌더된 페이지에 그 네 글자가 섞이면
 * 매트릭스 전체가 아무것도 검사하지 않고 초록이 될 수 있었다.
 *
 * 그래서 파싱을 **구조로** 한다: 플라이트 행(`N:<json>`)들 중 위 세 키를 가진 객체를 찾아
 * 정확히 하나일 것을 요구하고, 모르는 키가 섞여 있으면 깬다. 이게 "재생이 여전히 액션에
 * 닿고 있다"의 증거이고, 닿지 않게 되면 조용한 초록이 아니라 **명시적 실패**가 된다.
 */
function actionResultOf(body: string): {
  data?: unknown;
  serverError?: string;
  validationErrors?: unknown;
} {
  const found = body
    .split('\n')
    .map((line) => /^[0-9a-f]+:(\{.*\})$/.exec(line.trim())?.[1])
    .filter((json): json is string => !!json)
    .map((json) => {
      try {
        return JSON.parse(json) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(
      (obj): obj is Record<string, unknown> =>
        !!obj && RESULT_KEYS.some((k) => Object.hasOwn(obj, k)),
    );

  expect(
    found.length,
    `액션 결과 행을 찾지 못했다(또는 여러 개다) — 재생이 액션에 닿지 않는다. 본문: ${body}`,
  ).toBe(1);
  const result = found[0];
  expect(
    Object.keys(result).filter((k) => !(RESULT_KEYS as readonly string[]).includes(k)),
    `액션 결과에 모르는 키가 있다 — 응답 모양이 바뀌었다. 본문: ${body}`,
  ).toEqual([]);
  return result;
}

/** 플라이트 응답에서 액션이 돌려준 도메인 코드를 뽑는다. 성공이면 null. */
function serverErrorOf(body: string): string | null {
  const { serverError } = actionResultOf(body);
  return serverError ?? null;
}

/**
 * 거부 단언 — **코드까지** 고정하고, 쓰기가 새지 않았음을 계수로 확인한다.
 *
 * "쓰기가 실패했다"만 보면 안 되는 이유: Task 2 이후 DB가 두 번째 방어선이라 인가가 뚫려도
 * 복합 FK가 막아 겉보기 결과가 같아진다. 코드를 못 박아야 **인가 레이어가** 막았음이 남는다.
 */
async function expectDenied(
  ctx: BrowserContext,
  action: ActionName,
  input: unknown,
  code: string,
  baseline: Awaited<ReturnType<typeof writeCounts>>,
) {
  const body = await replay(ctx, action, input);
  expect(serverErrorOf(body), `${action}: 기대 ${code}, 응답 ${body}`).toBe(code);
  // 거부마다 확인한다 — 한 케이스만 새도 그 케이스에서 빨개져야 한다.
  expect(await writeCounts(), `${action} 거부 뒤 쓰기가 샜다`).toEqual(baseline);
}

/** 성공 단언 — 재생 경로가 실제로 액션에 도달함을 보이는 대조군. */
async function expectAllowed(ctx: BrowserContext, action: ActionName, input: unknown) {
  const body = await replay(ctx, action, input);
  const result = actionResultOf(body);
  expect(result.serverError ?? null, `${action}: 성공해야 하는데 거부됐다 — ${body}`).toBeNull();
  expect(result.validationErrors ?? null, `${action}: 입력 검증에서 걸렸다 — ${body}`).toBeNull();
  // 문자열 포함이 아니라 **키의 존재**로 본다 — 렌더된 페이지에 우연히 섞인 `"data"`가 아니다.
  expect(Object.hasOwn(result, 'data'), `${action}: data가 없다 — ${body}`).toBe(true);
  return body;
}

test.describe.configure({ mode: 'serial' });

test.describe('인가 매트릭스', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);

    // ── 총무: 모임 A + 다섯 액션을 실제로 한 번씩 성공시켜 id를 포획한다 ──────────
    ownerCtx = await newClientContext(browser);
    const op = await ownerCtx.newPage();
    // 정정·납부 취소는 window.confirm을 거친다 — 핸들러가 없으면 자동 dismiss되어 클릭이 무효다.
    op.on('dialog', (d) => d.accept());

    await op.goto('/login');
    await signUp(op, { name: '민지', email: testEmail('authz', 'owner') });
    await expect(op).toHaveURL(/\/groups$/);
    fx.gidA = await createGroup(op, '인가모임', '민지');

    await op.getByTestId('tab-지출').click();
    await expect(op).toHaveURL(/\/expenses$/);

    // 지출 두 건. 날짜를 갈라 목록 순서를 고정한다(발생일 내림차순) —
    // 아래 reverse-button.first()가 어느 행을 정정하는지가 결정적이어야 한다.
    ids.createExpense = await captureActionId(op, async () => {
      await op.getByTestId('expense-amount-input').fill('96000');
      await op.getByTestId('expense-date').fill('2026-01-20');
      await op.getByTestId('expense-submit').click();
    });
    await expect(op.getByTestId('expense-row')).toHaveCount(1);

    await op.getByTestId('expense-amount-input').fill('12000');
    await op.getByTestId('expense-date').fill('2026-01-10');
    await op.getByTestId('expense-submit').click();
    await expect(op.getByTestId('expense-row')).toHaveCount(2);

    // 위쪽(2026-01-20, 96,000) 행을 정정한다 → ALREADY_REVERSED·NOT_REVERSIBLE 소재가 생긴다.
    ids.reverseEntry = await captureActionId(op, () =>
      op.getByTestId('reverse-button').first().click(),
    );
    await expect(op.getByTestId('expense-reversal')).toHaveCount(1);
    // 아래 행(12,000)은 정정하지 않고 남긴다 — "정상 대상" 자리.
    await expect(op.getByTestId('reverse-button')).toHaveCount(1);

    await op.getByTestId('tab-회비').click();
    await expect(op).toHaveURL(/\/dues$/);
    ids.createRound = await captureActionId(op, async () => {
      await op.getByTestId('round-period').fill('2026-01');
      await op.getByTestId('round-amount').fill('20000');
      await op.getByTestId('round-create').click();
    });
    await expect(op).toHaveURL(/\/dues\/[^/]+$/);
    fx.roundIdA = new URL(op.url()).pathname.split('/').pop()!;

    ids.markPaid = await captureActionId(op, () => op.getByTestId('payment-toggle').click());
    await expect(op.getByTestId('round-total-collected')).toHaveText(/20,000/);

    // 납부한 사람은 '납부 완료' details 안으로 옮겨 앉는다 — 펼치지 않으면 토글이 보이지 않는다.
    await op.getByTestId('paid-details').locator('summary').click();
    ids.unmarkPaid = await captureActionId(op, () => op.getByTestId('payment-toggle').click());
    await expect(op.getByTestId('round-total-collected')).toHaveText(/^0/);

    // ── 멤버: 초대 링크로 A에 합류(role=member) ──────────────────────────────
    await op.goto(`/groups/${fx.gidA}/settings`);
    const inviteLocator = op.getByTestId('invite-link');
    await expect(inviteLocator).toContainText(`${ORIGIN}/invite/`);
    const invite = (await inviteLocator.innerText()).trim();

    memberCtx = await newClientContext(browser);
    const mp = await memberCtx.newPage();
    await mp.goto(invite);
    await mp.getByTestId('join-login-link').click();
    await signUp(mp, { name: '철수', email: testEmail('authz', 'member') });
    await expect(mp).toHaveURL(INVITE_JOIN_URL);
    await mp.getByTestId('join-display-name').fill('철수');
    await mp.getByTestId('join-submit').click();
    await expect(mp).toHaveURL(/\/groups\/[^/]+$/);

    // ── 비멤버: 자기 모임 B의 총무. B의 소재는 액션 재생으로 만든다 ───────────
    // 영희는 B의 총무이므로 이것은 정당한 경로다 — UI 단계를 되풀이하지 않고 소재만 얻는다.
    outsiderCtx = await newClientContext(browser);
    const xp = await outsiderCtx.newPage();
    await xp.goto('/login');
    await signUp(xp, { name: '영희', email: testEmail('authz', 'outsider') });
    await expect(xp).toHaveURL(/\/groups$/);
    fx.gidB = await createGroup(xp, '남의모임', '영희');

    await expectAllowed(outsiderCtx, 'createExpense', {
      groupId: fx.gidB,
      amount: 7000,
      occurredOn: '2026-03-01',
    });
    const roundBody = await expectAllowed(outsiderCtx, 'createRound', {
      groupId: fx.gidB,
      period: '2026-03',
      amountPerPerson: 5000,
    });
    fx.roundIdB = /"roundId":"([^"]+)"/.exec(roundBody)![1];

    // ── 미인증: 쿠키 없는 컨텍스트 ─────────────────────────────────────────
    anonCtx = await newClientContext(browser);

    // ── 재발급 액션 2종의 id 포획 — **공개 링크를 읽기 전에** ─────────────────
    // 이 둘은 포획 자체가 파괴적이다: 클릭하면 그 자리에서 옛 토큰이 죽는다. 그래서 순서가
    // 해법이다 — 멤버가 이미 합류를 끝냈으므로 초대 토큰을 돌려도 잃을 것이 없고, 공개 토큰은
    // 돌린 **뒤에** 읽어서 네 번째 역할이 살아 있는 링크를 받는다.
    // 두 패널 모두 window.confirm을 거친다 — 위에서 등록한 dialog 핸들러가 수락한다.
    await op.goto(`/groups/${fx.gidA}/settings`);
    const inviteBefore = (await op.getByTestId('invite-link').innerText()).trim();
    ids.regenerateInviteToken = await captureActionId(op, () =>
      op.getByTestId('invite-regenerate').click(),
    );
    await expect(op.getByTestId('invite-link')).not.toHaveText(inviteBefore);

    const publicBefore = (await op.getByTestId('public-link').innerText()).trim();
    ids.regeneratePublicToken = await captureActionId(op, () =>
      op.getByTestId('public-regenerate').click(),
    );
    await expect(op.getByTestId('public-link')).not.toHaveText(publicBefore);

    // ── 공개 장부 방문자: 쿠키는 없고 공개 링크만 아는 사람 ────────────────────
    // 재발급 뒤에 다시 읽는다 — 화면 상태가 아니라 DB가 가진 현재 토큰을 받기 위해 재진입한다.
    await op.goto(`/groups/${fx.gidA}/settings`);
    const publicLocator = op.getByTestId('public-link');
    await expect(publicLocator).toContainText(`${ORIGIN}/g/`);
    publicUrl = (await publicLocator.innerText()).trim();
    expect(publicUrl, '재발급 뒤에도 옛 공개 링크가 그대로다').not.toBe(publicBefore);
    publicVisitorCtx = await newClientContext(browser);

    // ── deleteGroup의 id 포획 — **버리는 모임 C**로 ────────────────────────────
    // 이 포획만 파괴가 되돌아오지 않는다. 그래서 A가 아니라 C를 제물로 쓴다.
    // 부수 효과로 **설정 화면의 위험 구역 동선 자체**(이름 타이핑 → 활성화 → 삭제 → 목록 복귀)가
    // 여기서 한 번 실제로 돌아간다 — 매트릭스의 재생은 그 UI를 건너뛰므로 둘 다 필요하다.
    await op.goto('/groups');
    fx.gidC = await createGroup(op, '삭제될모임', '민지');
    await op.goto(`/groups/${fx.gidC}/settings`);
    const deleteButton = op.getByTestId('delete-group');
    // 이름을 옮겨 적기 전에는 눌리지 않는다 — 화면 쪽 확인이 실재함을 여기서 본다(판정은 서버가 한다).
    await expect(deleteButton).toBeDisabled();
    await op.getByTestId('delete-group-confirm').fill('삭제될모임');
    await expect(deleteButton).toBeEnabled();
    ids.deleteGroup = await captureActionId(op, () => deleteButton.click());
    await expect(op).toHaveURL(/\/groups$/);
    expect(
      (await sql`select id from groups where id = ${fx.gidC}`) as { id: string }[],
      'UI로 지운 모임 C가 DB에 남아 있다',
    ).toHaveLength(0);

    // ── 소재 id 회수 ──────────────────────────────────────────────────────
    const entries = (await sql`
      select id, group_id, type, amount, reversal_of from ledger_entries`) as {
      id: string;
      group_id: string;
      type: string;
      amount: number;
      reversal_of: string | null;
    }[];
    fx.reversedEntryA = entries.find(
      (e) => e.group_id === fx.gidA && e.type === 'EXPENSE' && e.amount === -96_000,
    )!.id;
    fx.entryA = entries.find(
      (e) => e.group_id === fx.gidA && e.type === 'EXPENSE' && e.amount === -12_000,
    )!.id;
    fx.reversalEntryA = entries.find((e) => e.reversal_of === fx.reversedEntryA)!.id;
    fx.entryB = entries.find((e) => e.group_id === fx.gidB && e.type === 'EXPENSE')!.id;

    const mems = (await sql`select id, group_id, role from memberships`) as {
      id: string;
      group_id: string;
      role: string;
    }[];
    fx.ownerMembershipA = mems.find((m) => m.group_id === fx.gidA && m.role === 'owner')!.id;
    fx.memberMembershipA = mems.find((m) => m.group_id === fx.gidA && m.role === 'member')!.id;
    fx.membershipB = mems.find((m) => m.group_id === fx.gidB)!.id;

    for (const [k, v] of Object.entries({ ...ids, ...fx })) {
      expect(v, `준비 실패: ${k}`).toBeTruthy();
    }
  });

  test.afterAll(async () => {
    await Promise.all([
      ownerCtx?.close(),
      memberCtx?.close(),
      outsiderCtx?.close(),
      anonCtx?.close(),
      publicVisitorCtx?.close(),
    ]);
  });

  /** 역할과 무관하게 형식이 올바른 정상 입력 — 거부는 인가에서 나야 한다(입력 검증이 아니라). */
  const validInputs = () =>
    [
      ['createExpense', { groupId: fx.gidA, amount: 5000, occurredOn: '2026-02-01' }],
      ['reverseEntry', { groupId: fx.gidA, entryId: fx.entryA }],
      ['createRound', { groupId: fx.gidA, period: '2026-09', amountPerPerson: 10_000 }],
      [
        'markPaid',
        { groupId: fx.gidA, roundId: fx.roundIdA, membershipId: fx.ownerMembershipA },
      ],
      [
        'unmarkPaid',
        { groupId: fx.gidA, roundId: fx.roundIdA, membershipId: fx.ownerMembershipA },
      ],
      // 재발급 2종 — 입력은 groupId 하나다. 거부가 새면 **옛 링크가 죽는다**(행이 아니라 값이
      // 바뀌는 쓰기), 그래서 writeCounts가 토큰 값까지 들고 있다.
      ['regenerateInviteToken', { groupId: fx.gidA }],
      ['regeneratePublicToken', { groupId: fx.gidA }],
      // 삭제 — **이름까지 맞는** 입력이다. 거부가 인가에서 나야 하므로 NAME_MISMATCH로 비껴가면
      // 안 된다. 즉 이 네 역할에 대해서는 "이름을 알아도 못 지운다"를 확인하는 것이다.
      // 거부가 새면 writeCounts의 세 계수가 전부 0이 되고 tokens가 A를 잃는다 — 가장 크게 보이는 유출.
      ['deleteGroup', { groupId: fx.gidA, name: '인가모임' }],
    ] as const satisfies readonly (readonly [ActionName, unknown])[];

  test('멤버(총무 아님)는 쓰기 액션 8종 전부 FORBIDDEN이고 아무것도 쓰이지 않는다', async () => {
    const baseline = await writeCounts();
    for (const [action, input] of validInputs()) {
      await expectDenied(memberCtx, action, input, 'FORBIDDEN', baseline);
    }
  });

  test('비멤버는 쓰기 액션 8종 전부 NOT_MEMBER다 — 모임의 존재 여부도 알려주지 않는다', async () => {
    const baseline = await writeCounts();
    for (const [action, input] of validInputs()) {
      await expectDenied(outsiderCtx, action, input, 'NOT_MEMBER', baseline);
    }
  });

  test('미인증은 쓰기 액션 8종 전부 UNAUTHENTICATED다', async () => {
    const baseline = await writeCounts();
    for (const [action, input] of validInputs()) {
      await expectDenied(anonCtx, action, input, 'UNAUTHENTICATED', baseline);
    }
  });

  /**
   * 공개 장부 토큰은 **읽기 전용 베어러**다 — 읽기 권한이 쓰기로 승격되지 않는다.
   *
   * 이 테스트는 두 주장을 한 번에 한다:
   *  1. 이 컨텍스트는 정말로 장부를 **읽을 수 있다**(그래서 이 역할이 실재한다),
   *  2. 그런데도 쓰기 액션 8종은 전부 UNAUTHENTICATED다 — 토큰이 세션이 되지 않는다.
   * 1번이 없으면 "그냥 아무 권한도 없는 컨텍스트"를 시험하는 것이라 anonCtx와 구별되지 않는다.
   */
  test('공개 장부 링크 보유자는 읽을 수 있어도 쓰기 8종은 전부 UNAUTHENTICATED다', async () => {
    const page = await publicVisitorCtx.newPage();
    expect(await publicVisitorCtx.cookies(), '공개 방문자에게 쿠키가 있다').toEqual([]);
    await page.goto(publicUrl);
    // 읽기는 된다 — 이 역할이 anonCtx와 다른 지점.
    await expect(page.getByTestId('public-group-name')).toHaveText('인가모임');
    await page.close();

    // 읽었다고 세션이 생기지도 않는다 — 공개 라우트는 쿠키를 심지 않는다.
    expect(await publicVisitorCtx.cookies(), '공개 장부를 읽었더니 쿠키가 생겼다').toEqual([]);

    const baseline = await writeCounts();
    for (const [action, input] of validInputs()) {
      await expectDenied(publicVisitorCtx, action, input, 'UNAUTHENTICATED', baseline);
    }
  });

  /**
   * CSV 내보내기 라우트 — **이 매트릭스에 속한다.**
   *
   * 이 레포의 다른 모든 인가는 `groupActionClient`(세션 → 멤버십 → 역할) 하나를 지난다.
   * 그런데 파일 다운로드는 서버 액션으로 할 수 없어(액션 응답은 파일이 아니다) F7은 라우트
   * 핸들러가 됐고, **라우트 핸들러는 그 미들웨어를 지나지 않는다**. 즉 이 경로의 인가는
   * `app/api/groups/[groupId]/export/route.ts`에 손으로 쓴 네 줄이 전부다 —
   * 이 레포에서 인가 코드가 중복된 유일한 자리이고, 그래서 회귀 위험도 여기에만 있다.
   *
   * 역할 다섯 개가 이미 갖춰진 이 스펙이 그 확인의 제자리다. 읽기 경로라 쓰기 계수는 보지
   * 않지만, 묻는 것은 같다: **누가 이 모임의 데이터에 닿는가.**
   */
  test('CSV 내보내기는 멤버 이상만 통과한다 — 액션 미들웨어를 지나지 않는 경로', async () => {
    const url = (gid: string) => `${ORIGIN}/api/groups/${gid}/export`;

    // 총무와 멤버는 둘 다 받는다. 장부 열람 권한이 있으면 파일로도 받을 수 있다(F7).
    const ownerRes = await ownerCtx.request.get(url(fx.gidA));
    expect(ownerRes.status(), '총무가 CSV를 받지 못했다').toBe(200);
    expect(ownerRes.headers()['content-type']).toContain('text/csv');
    expect(ownerRes.headers()['content-disposition']).toContain('attachment');

    const memberRes = await memberCtx.request.get(url(fx.gidA));
    expect(memberRes.status(), '멤버가 CSV를 받지 못했다').toBe(200);
    // 역할에 따라 내용이 갈리지 않는다 — 같은 원장, 같은 파일.
    expect(await memberRes.text(), '멤버와 총무의 파일이 다르다').toBe(await ownerRes.text());

    // 거부 3역할. 비멤버는 **404**다 — 401은 "그 모임은 있다"를 알려준다.
    const denied = [
      ['비멤버', outsiderCtx, 404],
      ['미인증', anonCtx, 401],
      // 공개 링크는 **읽기 전용 베어러**다. 장부 화면을 읽을 수 있어도 원본 반출로 승격되지 않는다.
      ['공개 링크 방문자', publicVisitorCtx, 401],
    ] as const;
    for (const [label, ctx, status] of denied) {
      const res = await ctx.request.get(url(fx.gidA));
      expect(res.status(), `${label}: 기대 ${status}`).toBe(status);
      expect(await res.text(), `${label}: 거부 응답에 장부가 실려 있다`).not.toContain('인가모임');
    }

    // 총무여도 모임 경계를 넘지 못한다 — 남의 모임 id는 "없음"이다.
    const cross = await ownerCtx.request.get(url(fx.gidB));
    expect(cross.status(), '총무가 남의 모임 CSV를 받았다').toBe(404);
    // 존재하지 않는 id도 같은 404 — 모임의 존재 여부가 상태 코드로 새지 않는다.
    expect((await ownerCtx.request.get(url(crypto.randomUUID()))).status()).toBe(404);
  });

  test('총무여도 모임 경계를 넘을 수 없다 — 타 모임 id는 "없음"으로 떨어진다', async () => {
    const baseline = await writeCounts();
    // 남의 모임 엔트리는 모임 스코프 조회에 애초에 들어오지 않는다 → 존재 여부가 새지 않는다.
    await expectDenied(
      ownerCtx,
      'reverseEntry',
      { groupId: fx.gidA, entryId: fx.entryB },
      'ENTRY_NOT_FOUND',
      baseline,
    );
    await expectDenied(
      ownerCtx,
      'reverseEntry',
      { groupId: fx.gidA, entryId: crypto.randomUUID() },
      'ENTRY_NOT_FOUND',
      baseline,
    );
    // 남의 모임 회차 → getRound(ctx.groupId, …)가 null.
    await expectDenied(
      ownerCtx,
      'markPaid',
      { groupId: fx.gidA, roundId: fx.roundIdB, membershipId: fx.ownerMembershipA },
      'ROUND_NOT_FOUND',
      baseline,
    );
    // 남의 모임 멤버십 → 멤버 조회가 ctx.groupId로 스코프돼 있다.
    // (이 경로가 뚫려도 dues_payments_membership_fk가 23503으로 막는다 —
    //  그래서 여기서 **코드**를 고정하는 것이 의미가 있다: 막은 것이 액션 레이어임을 남긴다.)
    await expectDenied(
      ownerCtx,
      'markPaid',
      { groupId: fx.gidA, roundId: fx.roundIdA, membershipId: fx.membershipB },
      'NOT_MEMBER',
      baseline,
    );
    // 납부 취소는 회차를 조인해 모임까지 좁힌다 → 남의 회차·남의 멤버십 모두 기록 없음.
    await expectDenied(
      ownerCtx,
      'unmarkPaid',
      { groupId: fx.gidA, roundId: fx.roundIdB, membershipId: fx.membershipB },
      'PAYMENT_NOT_FOUND',
      baseline,
    );
    await expectDenied(
      ownerCtx,
      'unmarkPaid',
      { groupId: fx.gidA, roundId: fx.roundIdA, membershipId: fx.memberMembershipA },
      'PAYMENT_NOT_FOUND',
      baseline,
    );
  });

  test('총무의 도메인 규칙 위반도 코드로 돌아온다', async () => {
    const baseline = await writeCounts();
    // 한 엔트리는 한 번만 정정된다.
    await expectDenied(
      ownerCtx,
      'reverseEntry',
      { groupId: fx.gidA, entryId: fx.reversedEntryA },
      'ALREADY_REVERSED',
      baseline,
    );
    // 정정의 정정은 없다.
    await expectDenied(
      ownerCtx,
      'reverseEntry',
      { groupId: fx.gidA, entryId: fx.reversalEntryA },
      'NOT_REVERSIBLE',
      baseline,
    );
    // 한 모임에 같은 달 회차는 하나뿐.
    await expectDenied(
      ownerCtx,
      'createRound',
      { groupId: fx.gidA, period: '2026-01', amountPerPerson: 20_000 },
      'ROUND_EXISTS',
      baseline,
    );
    // 기간은 (모임, 기간) 유니크 키의 절반이라 서버가 형식을 본다 — zod는 문자열인지만 본다.
    await expectDenied(
      ownerCtx,
      'createRound',
      { groupId: fx.gidA, period: '2026-1', amountPerPerson: 20_000 },
      'INVALID_PERIOD',
      baseline,
    );
    // 납부 기록이 없는 사람의 취소.
    await expectDenied(
      ownerCtx,
      'unmarkPaid',
      { groupId: fx.gidA, roundId: fx.roundIdA, membershipId: fx.ownerMembershipA },
      'PAYMENT_NOT_FOUND',
      baseline,
    );
    // 이름이 틀린 삭제 — **총무 자신도** 못 지운다. 화면의 타이핑 확인이 연출인 이유가 이것이다:
    // 진짜 판정은 여기, 잠근 행에서 읽은 이름과의 비교다(ADR-002).
    await expectDenied(
      ownerCtx,
      'deleteGroup',
      { groupId: fx.gidA, name: '인가모임2' },
      'NAME_MISMATCH',
      baseline,
    );
    // 공백만 다른 이름은 통과해야 하지만(양쪽 trim), 그 확인은 여기서 하지 않는다 —
    // 성공하면 모임이 사라져 뒤 테스트가 전부 죽는다. 통합 테스트가 같은 비교를 덮는다.
  });

  /**
   * 대조군 — 위 거부들이 "재생이 액션에 도달하지 못해서" 난 것이 아님을 보인다.
   * 같은 재생 경로·같은 id로 총무 세션이 일곱 액션 모두 성공시키고 원장·토큰이 실제로 변한다.
   * 이 테스트가 없으면 포획한 id가 엉뚱해도 매트릭스 전체가 초록일 수 있다.
   *
   * ⚠️ **뒤에서 두 번째 테스트여야 한다.** 여기서 공개 토큰을 실제로 돌리므로 그 뒤의 테스트가
   * `publicUrl`을 쓰면 404를 만난다(describe가 serial이므로 순서는 선언 순서다).
   * 여덟 번째 액션(`deleteGroup`)의 대조군만 이 뒤에 온다 — 그것은 모임 A를 없애기 때문이다.
   */
  test('같은 재생 경로로 총무는 비파괴 7종 전부 성공한다 (대조군)', async () => {
    const before = await writeCounts();

    await expectAllowed(ownerCtx, 'createExpense', {
      groupId: fx.gidA,
      amount: 5000,
      occurredOn: '2026-02-01',
    });
    await expectAllowed(ownerCtx, 'reverseEntry', { groupId: fx.gidA, entryId: fx.entryA });
    const roundBody = await expectAllowed(ownerCtx, 'createRound', {
      groupId: fx.gidA,
      period: '2026-09',
      amountPerPerson: 10_000,
    });
    const roundId = /"roundId":"([^"]+)"/.exec(roundBody)![1];
    await expectAllowed(ownerCtx, 'markPaid', {
      groupId: fx.gidA,
      roundId,
      membershipId: fx.ownerMembershipA,
    });
    await expectAllowed(ownerCtx, 'unmarkPaid', {
      groupId: fx.gidA,
      roundId,
      membershipId: fx.ownerMembershipA,
    });

    // 재발급 2종 — 액션이 돌려준 새 토큰이 **DB에 실제로 들어갔는지**까지 본다.
    // 거부 케이스는 "토큰이 안 변했다"를 단언했으므로, 대조군은 그 반대를 보여야 짝이 맞는다.
    const inviteBody = await expectAllowed(ownerCtx, 'regenerateInviteToken', {
      groupId: fx.gidA,
    });
    const newInvite = /"inviteToken":"([^"]+)"/.exec(inviteBody)![1];
    const publicBody = await expectAllowed(ownerCtx, 'regeneratePublicToken', {
      groupId: fx.gidA,
    });
    const newPublic = /"publicToken":"([^"]+)"/.exec(publicBody)![1];

    const { tokens: tokensBefore, ...countsBefore } = before;
    const { tokens: tokensAfter, ...countsAfter } = await writeCounts();
    // 지출 1 + 정정 1 + 납부 1 + 납부취소 역분개 1 = 원장 4줄. 회차 1개.
    // 납부 기록은 체크로 생기고 취소로 지워지므로 순증 0 — ADR-001의 "원장은 지우지 않는다"가
    // dues_payments와 원장에서 각각 다르게 나타난다는 것까지 이 숫자가 담고 있다.
    expect(countsAfter).toEqual({
      entries: countsBefore.entries + 4,
      payments: countsBefore.payments,
      rounds: countsBefore.rounds + 1,
    });
    // 토큰은 **달라져야** 한다 — 이 한 줄이 거부 케이스의 `tokens` 동일성 단언이
    // "애초에 변할 수 없는 값"을 본 것이 아님을 증명한다.
    expect(tokensAfter, '재발급했는데 토큰이 그대로다').not.toBe(tokensBefore);
    const [rowA] = (await sql`
      select invite_token, public_token from groups where id = ${fx.gidA}`) as {
      invite_token: string;
      public_token: string;
    }[];
    expect(rowA.invite_token, '액션이 돌려준 초대 토큰이 DB에 없다').toBe(newInvite);
    expect(rowA.public_token, '액션이 돌려준 공개 토큰이 DB에 없다').toBe(newPublic);
  });

  /**
   * 여덟 번째 액션의 성공 대조군 — **파괴적이라 맨 마지막이다**.
   *
   * 앞의 네 역할은 "이름까지 맞는 입력으로도 못 지운다"를 확인했다. 그 거부들이 인가에서 난
   * 것임을 보이려면 같은 재생 경로·같은 id로 총무가 **실제로 지워지는** 것을 보여야 한다.
   * 지워진 A는 돌아오지 않으므로 이 뒤에는 어떤 테스트도 올 수 없다.
   *
   * 완전성(= 어떤 테이블도 행을 남기지 않는다)의 주장은 여기 있지 않다 — 그것은
   * `test/group-delete.integration.test.ts`가 FK 메타데이터와 대조해서 한다. 여기서 보는 것은
   * **사용자가 체감하는 결과**다: 모임이 사라지고, 공개 링크가 그 자리에서 404가 되고,
   * 남의 모임 B는 그대로다.
   */
  test('총무의 삭제는 성공하고 공개 링크가 그 자리에서 404가 된다 (파괴적 대조군)', async () => {
    const [{ public_token: token }] = (await sql`
      select public_token from groups where id = ${fx.gidA}`) as { public_token: string }[];
    const publicLink = `${ORIGIN}/g/${token}`;
    // 지우기 전에는 읽힌다 — 이 줄이 없으면 아래 404가 "원래 없던 링크"와 구별되지 않는다.
    expect((await publicVisitorCtx.request.get(publicLink)).status()).toBe(200);

    // B는 이 스펙에서 **지워지면 안 되는 쪽**이다 — 삭제 전후를 직접 비교한다.
    // (`writeCounts`는 A와 B를 합쳐 세므로 A가 사라진 뒤에는 이 비교에 쓸 수 없다.)
    const countB = async () => {
      const [row] = (await sql`
        select
          (select count(*)::int from ledger_entries where group_id = ${fx.gidB}) as entries,
          (select count(*)::int from dues_rounds    where group_id = ${fx.gidB}) as rounds,
          (select count(*)::int from memberships    where group_id = ${fx.gidB}) as memberships,
          (select count(*)::int from groups         where id       = ${fx.gidB}) as groups`) as {
        entries: number;
        rounds: number;
        memberships: number;
        groups: number;
      }[];
      return row;
    };
    const beforeB = await countB();
    expect(beforeB.groups, 'B가 준비되지 않았다 — 비교가 헛돈다').toBe(1);

    await expectAllowed(ownerCtx, 'deleteGroup', { groupId: fx.gidA, name: '인가모임' });

    const [gone] = (await sql`
      select
        (select count(*)::int from groups         where id       = ${fx.gidA}) as groups,
        (select count(*)::int from memberships    where group_id = ${fx.gidA}) as memberships,
        (select count(*)::int from ledger_entries where group_id = ${fx.gidA}) as entries,
        (select count(*)::int from dues_rounds    where group_id = ${fx.gidA}) as rounds,
        (select count(*)::int from dues_payments  where group_id = ${fx.gidA}) as payments`) as {
      groups: number;
      memberships: number;
      entries: number;
      rounds: number;
      payments: number;
    }[];
    expect(gone).toEqual({ groups: 0, memberships: 0, entries: 0, rounds: 0, payments: 0 });

    // 공개 링크는 재발급을 기다리지 않고 즉시 죽는다 — 토큰이 가리키던 행 자체가 없다.
    expect((await publicVisitorCtx.request.get(publicLink)).status()).toBe(404);

    // 남의 모임 B는 그대로다 — A를 지우는 삭제가 B까지 쓸어가지 않았다.
    expect(await countB(), 'A를 지웠는데 B가 줄었다').toEqual(beforeB);
  });
});
