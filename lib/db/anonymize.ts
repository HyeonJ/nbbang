import { and, eq, inArray, sql } from 'drizzle-orm';
import type { db } from '.';
import { account, memberships, session, settlementParticipants, user, verification } from './schema';

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
 * ── 여기 **없는** 것 ────────────────────────────────────────────────────────
 *  - **`user.id`** — 보존된다. 탈퇴자의 과거 활동은 하나의 안정적 UUID로 계속 연결되므로
 *    이것은 "연결 불가능한 익명화"가 **아니다.** 숨기지 않는다(ADR-004 결정 2a).
 *    `created_by` 셋을 nullable로 바꾸는 대안은 3테이블 마이그레이션 + "누가 기록했는가"의
 *    영구 소실을 대가로 하므로 v1에서 기각했다.
 *  - **자유 텍스트** — `ledger_entries.memo` · `groups.account_label` ·
 *    `settlements.title`. 사용자가 거기에 자기 이름·이메일을 적었다면 **남는다.**
 *    파기 범위는 아래 두 상수가 말하는 "구조화된 식별자"로 한정된다(ADR-004 결정 2b).
 *
 *    ⚠️ **셋 중 하나는 사용자가 적은 게 아니다 — 앱이 적는다.** `actions/dues.ts`의
 *    `markPaid`가 납부 원장 메모를 `` `${period} ${displayName}` ``으로 쓰므로, 회비를 한 번이라도
 *    낸 멤버의 표시 이름은 **선택과 무관하게** 원장 메모에 들어가고 탈퇴 후에도 남는다. 그 값은
 *    **공개 장부에 나간다**(Plan 04 Task 5 프로덕션 스모크에서 관측: 멤버 목록은 `탈퇴한 멤버`인데
 *    기록 줄은 `2026-01 철수`). 결론(보존)은 코드와 맞지만 근거("본인이 적었다")는 이 경로에
 *    성립하지 않는다 — ADR-004 결정 2(b)의 정정과 `docs/requirements.md` §8 P0을 보라.
 *    고칠 때는 문자열 매칭이 아니라 `dues_payments`의 `ledger_entry_id` ↔ `membership_id`를 타는
 *    **키 기반** 경로를 쓴다(이름 매칭 금지는 이 파일이 지키는 규칙이다).
 *  - **금액·참여 인원·이체 구조** — 한 글자도 바뀌지 않는다(ADR-001·ADR-003).
 *  - `ledger_entries` · `settlements` · `dues_payments` 행 — 모임의 기록이지 그 사람의
 *    기록이 아니다. 지우면 남은 멤버들의 장부가 어긋난다.
 */

/** 탈퇴 후 `user.name`. 모임 멤버가 아니라 **계정**의 표시 이름이다. */
export const ANONYMOUS_USER_NAME = '탈퇴한 사용자';

/** 탈퇴 후 멤버십·정산 참여자 스냅샷의 표시 이름. 남은 멤버들이 화면에서 보는 문자열이다. */
export const ANONYMOUS_MEMBER_NAME = '탈퇴한 멤버';

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
 * 탈퇴 시 **값이 덮어써지는** 구조화된 식별자 컬럼. `[테이블, 컬럼]`.
 *
 * 통합 테스트가 이 목록을 두 방향으로 쓴다: ① 여기 적힌 컬럼에 원래 이메일·표시명이
 * 남지 않았는지 확인하고, ② 이 목록 + `ERASED_ROW_TABLES` + 테스트의 "식별자 아님" 분류가
 * 여섯 테이블의 텍스트 컬럼 **전부**를 덮는지 대조한다. 컬럼이 추가되면 그 대조가 먼저 빨개진다.
 */
export const ERASED_IDENTIFIER_COLUMNS: readonly (readonly [string, string])[] = [
  ['user', 'email'],
  ['user', 'name'],
  ['user', 'image'],
  ['memberships', 'display_name'],
  ['settlement_participants', 'display_name_at_time'],
];

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
      .set({ displayName: ANONYMOUS_MEMBER_NAME })
      .where(eq(memberships.userId, userId));
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
