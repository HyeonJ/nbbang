import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groups, ledgerEntries, memberships } from './schema';

/**
 * 공개 장부(F5) **전용** 쿼리. 이 앱에서 인증 없이 데이터를 내보내는 유일한 경로다.
 *
 * ── `lib/db/queries.ts`를 재사용하지 않는 이유 ─────────────────────────────────
 * 그쪽 함수들은 행 전체(`select({ group: groups })` 등)를 돌려준다 — `groups` 행에는
 * `inviteToken`과 `publicToken`이 들어 있다. 인증된 화면에서는 그것이 문제가 아니지만,
 * 여기서는 반환값이 그대로 렌더 출력·flight 페이로드로 나가므로 한 번의 재사용이 곧 유출이다.
 * 그래서 이 모듈은 **컬럼을 하나하나 적어 고른다**. `select()`를 인자 없이 쓰지 말 것.
 *
 * ── `PublicLedger` 타입이 곧 노출 명세다 ──────────────────────────────────────
 * 아래 타입에 **없는 필드는 이 라우트로 절대 나가지 않는다**. 특히 다음은 의도적으로 빠져 있다:
 *   - `groups.id` / `groups.inviteToken` / `groups.publicToken` / `groups.createdAt`
 *   - `memberships.id` / `memberships.userId` / `memberships.joinedAt`
 *   - `user.email`, `user.name` 등 인증 테이블 컬럼 일체 (조인 자체를 하지 않는다)
 *   - `ledgerEntries.createdBy` (userId다) / `ledgerEntries.groupId` / `ledgerEntries.createdAt`
 *   - `groups.accountLabel` — 총무의 입금 계좌 문구. 회차 화면의 미납 안내에만 나온다
 *     (schema.ts의 3줄 규칙 ②). `e2e/public-ledger.spec.ts`의 금칙 목록이 원시 응답 본문과
 *     flight 페이로드에서 이 값을 매 푸시마다 찾아본다 — 일부러 흘려 빨개지는 것을 확인했다.
 * 필드를 늘릴 때는 "이 값이 링크를 가진 모든 사람에게 보여도 되는가"를 먼저 답할 것.
 *
 * ⚠️ `group.id`는 함수 **내부**에서만 쓰고 반환하지 않는다 — 다른 라우트의 인가 판단에 쓰이는
 * 식별자라서, 공개 장부가 그것을 흘리면 공격자가 다른 경로를 두드릴 재료를 얻는다.
 */
export type PublicLedgerEntry = {
  id: string;
  type: 'DUES_PAYMENT' | 'EXPENSE' | 'REVERSAL';
  amount: number;
  occurredAt: Date;
  category: string | null;
  memo: string | null;
  reversalOf: string | null;
};

export type PublicLedger = {
  groupName: string;
  balance: number;
  entries: PublicLedgerEntry[];
  members: { displayName: string; role: 'owner' | 'member' }[];
};

/**
 * 토큰으로 공개 장부를 읽는다. 토큰이 없거나 맞지 않으면 `null` —
 * 호출자는 `notFound()`로 떨어뜨려 **모임의 존재 여부를 알려주지 않는다**.
 *
 * 잔액은 저장값이 아니라 엔트리 합산이다(ADR-001). 여기서는 이미 전부 읽었으므로
 * 별도 SUM 쿼리를 한 번 더 돌리지 않고 그 배열을 접는다 — 같은 트랜잭션이 아닌 두 쿼리가
 * 서로 다른 시점을 보면 "표에 보이는 합"과 "표시된 잔액"이 어긋날 수 있기 때문이기도 하다.
 *
 * ── 모임 삭제와 겹칠 때 (Plan 04 Task 2) ────────────────────────────────────
 * 이 함수는 트랜잭션을 열지 않는다. 그래서 첫 조회(`groups`)와 뒤의 두 조회 사이에
 * `deleteGroup`이 커밋되면 **모임 이름은 있는데 기록과 멤버가 빈** 화면이 한 번 나올 수 있다.
 * 일부러 그대로 둔다:
 *  - 읽기는 잠그지 않으므로 삭제를 막지도, 삭제에 막히지도 않는다(MVCC). 삭제가 지연되거나
 *    실패할 위험이 이 경로에서 생기지 않는다.
 *  - 새는 것이 없다 — 읽는 사람은 이미 그 모임의 링크를 들고 있었고, 나오는 값도 이름뿐이다.
 *  - 이 앱에서 가장 많이 도는 읽기에 BEGIN/COMMIT 왕복 두 번을 얹는 대가가 그 한 번의
 *    빈 표보다 크다. 새로고침하면 `null` → `notFound()` → 404로 정착한다.
 * 삭제 **후**의 동작은 통합 테스트가 못 박는다(토큰 조회 → null).
 */
export async function getPublicLedger(token: string): Promise<PublicLedger | null> {
  // 빈 문자열은 DB까지 갈 필요가 없다. (라우트 구조상 도달하기 어렵지만 방어적으로 둔다.)
  if (!token) return null;

  const [group] = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(eq(groups.publicToken, token))
    .limit(1);
  if (!group) return null;

  const [entries, members] = await Promise.all([
    db
      .select({
        id: ledgerEntries.id,
        type: ledgerEntries.type,
        amount: ledgerEntries.amount,
        occurredAt: ledgerEntries.occurredAt,
        category: ledgerEntries.category,
        memo: ledgerEntries.memo,
        reversalOf: ledgerEntries.reversalOf,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.groupId, group.id))
      // 화면 순서와 같게 고정한다 — 발생일 내림차순, 같은 날은 기록순 뒤에서부터.
      .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.createdAt)),
    // 표시 이름과 역할만. userId·이메일·멤버십 id는 select에 없다.
    db
      .select({ displayName: memberships.displayName, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.groupId, group.id))
      .orderBy(asc(memberships.joinedAt)),
  ]);

  return {
    groupName: group.name,
    balance: entries.reduce((n, e) => n + e.amount, 0),
    entries,
    members,
  };
}
