import { and, eq, inArray, sql } from 'drizzle-orm';
import type { db } from '.';
import { ANONYMOUS_MEMBER_NAME } from '@/lib/domain/member';
import {
  account,
  ledgerEntries,
  memberships,
  session,
  settlementParticipants,
  user,
  verification,
} from './schema';

/**
 * **파기되는 것의 전체 목록**이다 — 회원 탈퇴 판(ADR-004).
 *
 * `lib/db/delete.ts`(모임 삭제)와 같은 규약을 따른다: 목록은 **한 곳에만** 있고,
 * "여기 없는 것은 일어나지 않는다"가 성립해야 의미가 있다. 다른 점은 파기의 **모양**이다 —
 * 모임 삭제는 행을 지우지만, 탈퇴는 행을 **남기고 값을 덮어쓴다.**
 *
 * ── 왜 행을 지우지 못하는가 ──────────────────────────────────────────────────
 * `user.id`를 **`notNull`로** 참조하는 컬럼이 셋이다: `memberships.user_id` ·
 * `ledger_entries.created_by` · `settlements.created_by`. `onDelete`는 이 스키마 어디에도
 * 없으므로 `delete from "user"`는 23503으로 실패하고, 캐스케이드를 걸면 남의 모임 금액
 * 기록까지 사라진다(ADR-001이 금지하는 것). Better Auth의 `deleteUser`도 같은 이유로
 * **쓰지 않는다** — 그것은 하드 삭제다.
 *
 * ── `memberships` 행을 지우지 않는 이유 ─────────────────────────────────────
 * 지우면 **회비 납부 체크가 사라진다.** `dues_payments`는 `membership_id`로 매달려 있고
 * 회차 화면은 멤버십 목록을 기준으로 납부/미납을 그린다. 멤버십이 없어지면 그 사람이 낸
 * 회차가 "미납"으로 보이거나 아예 없던 일이 된다 — **없던 사실을 만드는 파기**는 파기가
 * 아니라 손상이다. 그래서 행은 남기고 이름만 익명화한다.
 *
 * ── 파기의 **모양이 둘**이다: 컬럼째 vs 키로 지목한 행만 ────────────────────
 * `ERASED_IDENTIFIER_COLUMNS`의 다섯 컬럼은 **그 사람의 것이 확실하므로** 컬럼째 덮어쓴다.
 * `ERASED_APP_WRITTEN_COLUMNS`(= `ledger_entries.memo`)는 다르다 — 한 컬럼에 **앱이 쓴**
 * 회비 납부 메모와 **사용자가 쓴** 지출·정정 메모가 섞여 있어서, 컬럼째 덮어쓰면 남의 글까지
 * 지우고 통째로 두면 파기를 요청한 사람의 이름이 공개 장부에 남는다. 그래서 그 컬럼만은
 * `ledger_entries.subject_membership_id`로 **지목된 행**만 다시 쓴다(ADR-004 결정 2(b) 개정).
 *
 * ── 여기 **없는** 것 ────────────────────────────────────────────────────────
 *  - **`user.id`** — 보존된다. 탈퇴자의 과거 활동은 하나의 안정적 UUID로 계속 연결되므로
 *    이것은 "연결 불가능한 익명화"가 **아니다.** 숨기지 않는다(ADR-004 결정 2a).
 *    `created_by` 셋을 nullable로 바꾸는 대안은 3테이블 마이그레이션 + "누가 기록했는가"의
 *    영구 소실을 대가로 하므로 v1에서 기각했다.
 *  - **사용자가 타이핑한 자유 텍스트** — `groups.account_label` · `settlements.title` ·
 *    그리고 `ledger_entries.memo` 중 **지출·정정 메모**. 거기에 자기 이름·이메일·계좌번호를
 *    적었다면 **남는다.** 지우려면 자유 텍스트 PII 탐지가 필요하고, 그것은 오탐(남의 이름·모임
 *    이름을 지움)과 미탐을 동시에 갖는 별개의 문제다(ADR-004 결정 2(b) · §8 P5).
 *
 *    ⚠️ **회비 납부 메모는 여기 들어가지 않는다 — 앱이 쓴 식별자다.** 셋을 "사용자가 직접 적은
 *    자유 텍스트"로 묶은 것이 P0 결함의 원인이었다(Plan 04 Task 5 프로덕션 스모크에서 관측:
 *    멤버 목록은 `탈퇴한 멤버`인데 기록 줄은 `2026-01 철수`). 그 경로는 위 단락대로 파기된다.
 *  - **금액·참여 인원·이체 구조** — 한 글자도 바뀌지 않는다(ADR-001·ADR-003).
 *  - `ledger_entries` · `settlements` · `dues_payments` 행 — 모임의 기록이지 그 사람의
 *    기록이 아니다. 지우면 남은 멤버들의 장부가 어긋난다.
 */

/** 탈퇴 후 `user.name`. 모임 멤버가 아니라 **계정**의 표시 이름이다. */
export const ANONYMOUS_USER_NAME = '탈퇴한 사용자';

/** 탈퇴 후 멤버십·정산 참여자 스냅샷의 표시 이름. 남은 멤버들이 화면에서 보는 문자열이다. */
export { ANONYMOUS_MEMBER_NAME } from '@/lib/domain/member';

/**
 * 파기 후 들어가는 이메일. `@deleted.invalid`는 RFC 2606의 예약 TLD라 **실재할 수 없다.**
 *
 * `null`로 비우지 않는 이유 둘: ① `user.email`은 `notNull`이다. ② 유니크 제약을 유지해야
 * 하는데, 값을 고정 문자열로 두면 두 번째 탈퇴자가 23505로 실패한다. 그래서 탈퇴마다 새 UUID다.
 * 원래 이메일이 비워지는 덕분에 **같은 이메일로 재가입할 수 있다** — 비우지 않으면 Better Auth가
 * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`(422)로 거절한다(실측).
 */
export const deletedEmail = (): string => `deleted-${crypto.randomUUID()}@deleted.invalid`;

/** 탈퇴 시 **행째로** 사라지는 테이블. Better Auth 테이블 넷 중 `user`를 뺀 전부다. */
export const ERASED_ROW_TABLES: readonly string[] = ['account', 'session', 'verification'];

/**
 * **앱이 쓴 식별자**가 들어가는 텍스트 컬럼. `[테이블, 컬럼]`.
 *
 * 위 `ERASED_ROW_TABLES`·아래 `ERASED_IDENTIFIER_COLUMNS`와 다른 점은 **파기의 범위**다 —
 * 이 컬럼은 컬럼째 덮어쓰지 않고 **키로 지목된 행만** 다시 쓴다. `ledger_entries.memo`에는
 * 앱이 쓴 납부 메모와 사용자가 쓴 지출 메모가 섞여 있고, 전자는 파기 대상이지만 후자는
 * 범위 밖이기 때문이다(ADR-004 결정 2(b) 개정). 키는 `subject_membership_id`다.
 *
 * 목록이 하나 더 생기는 대가를 치르는 이유: "이 컬럼은 어느 규약으로 파기되는가"가 코드에
 * 적혀 있지 않으면, 다음 사람이 컬럼째 덮어써 남의 글을 지우거나 통째로 남겨 P0을 되살린다.
 * 통합 테스트 5b가 세 목록 + "식별자 아님" 분류로 **아홉 테이블의 텍스트 컬럼 전부**를 덮는지
 * 대조하고, 한 컬럼이 두 목록에 동시에 오르는 것도 깬다.
 */
export const ERASED_APP_WRITTEN_COLUMNS: readonly (readonly [string, string])[] = [
  ['ledger_entries', 'memo'],
];

/**
 * 탈퇴 시 **값이 덮어써지는** 구조화된 식별자 컬럼. `[테이블, 컬럼]`.
 *
 * 통합 테스트가 이 목록을 두 방향으로 쓴다: ① 여기 적힌 컬럼에 원래 이메일·표시명이
 * **한 행도** 남지 않았는지 확인하고(컬럼째 파기이므로 "테이블 어디에도 없다"가 성립한다),
 * ② 이 목록 + `ERASED_ROW_TABLES` + `ERASED_APP_WRITTEN_COLUMNS` + 테스트의 "식별자 아님"
 * 분류가 아홉 테이블의 텍스트 컬럼 **전부**를 덮는지 대조한다. 컬럼이 추가되면 그 대조가
 * 먼저 빨개진다.
 *
 * ⚠️ `ledger_entries.memo`를 **여기 넣지 말 것.** 그 컬럼은 사용자가 쓴 지출 메모와 같은
 * 자리를 쓰므로 ①의 "테이블 어디에도 없다"가 성립하지 않는다(그 메모는 일부러 남긴다).
 * 그쪽은 `ERASED_APP_WRITTEN_COLUMNS`다.
 */
export const ERASED_IDENTIFIER_COLUMNS: readonly (readonly [string, string])[] = [
  ['user', 'email'],
  ['user', 'name'],
  ['user', 'image'],
  ['memberships', 'display_name'],
  ['settlement_participants', 'display_name_at_time'],
];

/**
 * 탈퇴 후 **회비 납부 메모**에 들어갈 값. `` `${period} ${displayName}` `` → `` `${period} 탈퇴한 멤버` ``.
 *
 * 이 표현식이 보는 것은 **앱이 쓴 형식의 앞 7자**(`YYYY-MM`)뿐이고 이름은 쳐다보지 않는다 —
 * 이름 문자열 매칭은 이 파일이 지키는 금지 규칙이다(동명이인·개명). 어느 행에 적용할지는
 * 전적으로 `subject_membership_id` 키가 정한다.
 *
 * 형식이 예상과 다르면(= 기간 접두사가 없으면) 기간을 **추측하지 않고** 값을 통째로
 * `'탈퇴한 멤버'`로 덮는다. 파기 쪽으로 기운 선택이다 — 어디가 이름인지 모르는 문자열을
 * 부분만 남기는 것보다 안전하다. `null`은 그대로 둔다(메모 없는 엔트리에 이름을 적을 이유가 없다).
 *
 * 별도 상수로 export하는 이유: `lib/db/anonymize.test.ts`가 **DB 없이** 이 SQL의 모양을
 * 고정한다(기간 보존 · 이름 매칭 부재). 단위 테스트가 닿을 수 있는 유일한 형태다.
 */
export const anonymizedDuesMemo = sql`case
    when ${ledgerEntries.memo} is null then null
    when left(${ledgerEntries.memo}, 8) ~ '^[0-9]{4}-[0-9]{2} '
      then left(${ledgerEntries.memo}, 7) || ' ' || ${ANONYMOUS_MEMBER_NAME}
    else ${ANONYMOUS_MEMBER_NAME}
  end`;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 한 사용자의 **구조화된 식별자 전부**를 파기한다.
 *
 * ⚠️ **반드시 트랜잭션 안에서, `user` 행을 `for update`로 잠근 뒤에** 부른다.
 * 잠금이 없으면 이 함수가 도는 동안 다른 요청이 같은 사용자 id로 원장을 새로 적을 수 있다
 * (외부 리뷰 IMPORTANT 12). 잠금을 거는 자리는 `actions/account.ts`의 `deleteAccount`
 * 하나뿐이고, 쓰기 쪽의 짝은 `assertActiveUser`다.
 *
 * `email`은 **잠근 행에서 읽은 값**을 넘긴다 — 액션 진입 시 읽은 값을 쓰면 그 사이에 바뀐
 * 이메일의 `verification` 행을 놓친다(`deleteGroup`의 이름 확인이 잠금 뒤인 것과 같은 이유).
 */
export async function anonymizeUserRows(tx: Tx, userId: string, email: string): Promise<void> {
  // ── 1. 표시 이름 (행은 남고 값만 바뀐다) ──────────────────────────────────
  // 정산 참여자 스냅샷은 **`membership_id`로** 찾는다. 이름 문자열로 찾으면 동명이인의
  // 스냅샷까지 함께 지우고(같은 모임에 '민지'가 둘일 수 있다), 개명 이력이 있으면 반대로
  // 놓친다(과거 스냅샷은 옛 이름을 들고 있다). 통합 테스트가 **같은 표시 이름을 가진 두
  // 번째 멤버**를 픽스처에 두어 이름 매칭 구현이라면 빨개지게 한다.
  const mine = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const membershipIds = mine.map((m) => m.id);
  if (membershipIds.length > 0) {
    await tx
      .update(settlementParticipants)
      .set({ displayNameAtTime: ANONYMOUS_MEMBER_NAME })
      .where(inArray(settlementParticipants.membershipId, membershipIds));
    await tx
      .update(memberships)
      .set({
        displayName: ANONYMOUS_MEMBER_NAME,
        // 탈퇴는 모든 모임을 떠나는 것이다(ADR-005). 이미 떠난 시각은 보존하고, 사유는
        // `withdrawn`으로 덮는다 — `removed`로 남으면 총무가 이름이 파기된 멤버십을 되살릴 수 있다.
        leftReason: 'withdrawn',
        leftAt: sql`coalesce(${memberships.leftAt}, now())`,
      })
      .where(eq(memberships.userId, userId));

    // ── 1-b. 앱이 쓴 회비 납부 메모 — **키로 지목된 행만** ──────────────────
    //
    // `markPaid`는 납부 원장 메모를 `${period} ${displayName}`으로 쓴다. 사용자가 적은 글이
    // 아니라 **앱이 적은 식별자**이고, 그 값은 공개 장부로 나간다(`public-queries.ts`가 memo를
    // 내보낸다) — 그래서 파기 대상이다(ADR-004 결정 2(b) 개정).
    //
    // ⚠️ **키는 `dues_payments`가 아니라 `subject_membership_id`다.** 납부 취소는 역분개를
    // 남기고 `dues_payments` **행을 지우므로**(ADR-001·Plan 02), 그 테이블을 타는 구현은
    // **취소된 납부를 놓친다** — 그 엔트리의 메모에는 이름이 그대로 남고 공개 장부에 계속
    // 나간다. 통합 테스트 5c가 취소된 납부를 픽스처에 두어 그 구현이면 빨개지게 한다.
    //
    // **회차 기간은 남긴다.** '2026-02'는 사람의 식별자가 아니라 그 입금이 어느 회차의 것인지다 —
    // 지우면 남은 멤버들의 장부에서 그 정보가 사라진다(파기 요청에 없던 손상이다). 기간을
    // 떼어낼 때 보는 것은 **앱이 쓴 형식의 앞 7자**이고 이름은 쳐다보지 않는다. 이름 문자열로
    // 찾는 것은 이 파일이 지키는 금지 규칙이다 — 동명이인의 기록까지 지우고(한 모임에 '민지'가
    // 둘일 수 있다) 개명 이력은 반대로 놓친다.
    await tx
      .update(ledgerEntries)
      .set({ memo: anonymizedDuesMemo })
      .where(inArray(ledgerEntries.subjectMembershipId, membershipIds));
  }

  // ── 2. 자격증명·세션 (행째로) ────────────────────────────────────────────
  await tx.delete(account).where(eq(account.userId, userId));
  await tx.delete(session).where(eq(session.userId, userId));
  /**
   * `verification`은 `user_id` FK가 없다 — 이메일 인증·비밀번호 재설정 토큰이 사는 테이블이라
   * `identifier`에 **이메일이 문자열로** 들어가고 `value`에 `user.id`가 들어간다
   * (외부 리뷰 IMPORTANT 13). 그래서 두 경로 모두로 찾는다.
   *
   * `like`가 아니라 `position`을 쓰는 이유: 이메일에는 `_`가 합법적으로 들어가는데
   * `like`에서 그것은 **와일드카드**다. `a_b@x.com`으로 탈퇴한 사람이 `axb@x.com`의
   * 토큰까지 지우는 경로가 열린다. `position`은 순수 부분문자열이라 그 경로가 없다.
   */
  await tx.execute(
    sql`delete from ${verification}
         where ${verification.value} = ${userId}
            or position(${email} in ${verification.identifier}) > 0`,
  );

  // ── 3. 계정 프로필 (마지막 — 여기서 이메일이 비워진다) ────────────────────
  await tx
    .update(user)
    .set({
      email: deletedEmail(),
      name: ANONYMOUS_USER_NAME,
      image: null,
      // 남은 이메일은 실재하지 않는 주소다 — "인증됨"으로 남겨 둘 근거가 없다.
      emailVerified: false,
      deletedAt: new Date(),
    })
    .where(eq(user.id, userId));
}

/**
 * **쓰기 직전의 탈퇴 확인** — 반드시 그 쓰기와 **같은 트랜잭션 안에서** 부른다
 * (외부 리뷰 IMPORTANT 12).
 *
 * `for key share`가 이 함수의 전부다. 탈퇴는 `for update`로 같은 행을 잠그고, 두 잠금은
 * **충돌한다.** 그래서 탈퇴가 진행 중이면 이 select가 **기다렸다가** 커밋 이후의 행 버전을
 * 읽는다 — `deleted_at`이 찍힌 것을 보고 거절한다.
 *
 * ── 왜 인가 계층의 세션 검사만으로는 부족한가 ────────────────────────────────
 * `lib/session.ts`의 검사는 액션 시작 시점의 **한 번**이고, 그 뒤 쓰기까지 사이가 비어 있다.
 * 세션 확인이 탈퇴 잠금 **직전에** 끝나고 insert가 커밋 **이후에** 도는 배치가 가능하다 —
 * 그러면 탈퇴한 사용자 id로 새 원장 줄이 생긴다. 확인과 쓰기가 한 트랜잭션 안에 있어야
 * 그 창이 닫힌다. 통합 테스트가 두 트랜잭션을 실제로 겹쳐 그것을 고정한다.
 *
 * ── 왜 `key share`인가 ─────────────────────────────────────────────────────
 * 가장 약한 행 잠금이다. `for update`(탈퇴)와는 충돌하지만 서로 간에는 충돌하지 않으므로,
 * 같은 사람의 동시 쓰기 둘이 서로를 막지 않는다. 마침 FK가 참조 행에 거는 잠금과 같은
 * 종류라 추가 비용도 사실상 없다.
 *
 * ── 어디에 거는가 ─────────────────────────────────────────────────────────
 * `user.id`를 **기록하는** 쓰기에만 건다(`created_by`·`user_id`). 나머지(모임 토큰 재발급·
 * 계좌 문구·모임 삭제)는 총무 전용인데 총무는 애초에 탈퇴할 수 없다(`OWNS_GROUPS`).
 * 근거 없이 넓히면 모든 쓰기에 왕복이 하나씩 붙는다.
 */
export async function assertActiveUser(tx: Tx, userId: string): Promise<void> {
  const [row] = await tx
    .select({ deletedAt: user.deletedAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
    .for('key share');
  // 세션이 해석됐다는 것은 행이 있었다는 뜻이다 — 없다면 그 사이에 사라진 것이고, 어느 쪽이든
  // 이 쓰기를 진행시킬 근거가 없다.
  if (!row || row.deletedAt) throw new UserDeletedError();
}

/**
 * `assertActiveUser`가 던지는 신호. `actions/`가 이것을 잡아 `ActionError('ACCOUNT_DELETED')`로
 * 바꾼다 — `lib/db`가 액션 레이어의 에러 타입을 알지 않게 하려고 한 겹 둔다.
 */
export class UserDeletedError extends Error {
  constructor() {
    super('ACCOUNT_DELETED');
  }
}

/** 탈퇴자가 **소유한 모임**의 개수. 0이 아니면 탈퇴를 거부한다(ADR-004: 총무 위임 미구현). */
export async function countOwnedGroups(tx: Tx, userId: string): Promise<number> {
  const owned = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')));
  return owned.length;
}
