import { eq } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import type { db } from '.';
import {
  duesPayments,
  duesRounds,
  groups,
  ledgerEntries,
  memberships,
  settlementParticipants,
  settlementTransfers,
  settlements,
} from './schema';

/**
 * **파괴되는 것의 전체 목록**이다.
 *
 * `public-queries.ts`가 "공개 장부로 나갈 수 있는 것의 전체 목록"인 것과 같은 역할을 반대
 * 방향으로 한다 — 그쪽은 노출의 화이트리스트, 이쪽은 파괴의 화이트리스트다. 두 목록 모두
 * **한 곳에만** 있어야 하고, 둘 다 "여기 없는 것은 일어나지 않는다"가 성립해야 의미가 있다.
 *
 * ── 왜 목록이 필요한가: 이 스키마에 `onDelete`가 **하나도 없다** ────────────────
 * `lib/db/schema.ts`의 FK는 전부 기본 `NO ACTION`이다. 캐스케이드가 없으므로 부모를 지우려면
 * 자식을 **먼저, 순서대로** 지워야 한다. 순서가 틀리면 23503으로 실패한다 — 조용히 절반만
 * 지워지는 것이 아니라 트랜잭션 전체가 롤백되므로 실패는 눈에 띈다. 위험한 쪽은 그 반대다:
 * **새 테이블이 생겼는데 이 목록에 추가되지 않는 것.** 그러면 삭제는 성공하는데(그 테이블이
 * `groups`를 직접 참조하지 않으면 FK도 안 막는다) 행이 남는다 — `settlement_participants`와
 * `settlement_transfers`가 정확히 그런 모양이다(`groups`를 직접 참조하지 않고 `settlements`·
 * `memberships`를 거쳐 매달려 있다). 그래서 `test/group-delete.integration.test.ts`가 이 목록을
 * **FK 메타데이터에서 계산한 전이 폐포**와 대조한다. 테이블이 추가되면 그 테스트가 **먼저**
 * 빨개진다.
 *
 * ── 순서의 근거 ──────────────────────────────────────────────────────────────
 * 자식 → 부모. 같은 이유로 `ledger_entries`는 `dues_payments` 뒤,
 * `memberships`는 정산 3종과 `dues_payments` 뒤에 온다.
 *  - `dues_payments` → dues_rounds · memberships · ledger_entries (복합 FK 3개)
 *  - `settlement_transfers` → settlements · memberships (from·to 양쪽)
 *  - `settlement_participants` → settlements · memberships
 *  - `settlements` → memberships (선결제자)
 *  - `ledger_entries` → **자기 자신**(역분개 복합 FK). 한 문장으로 부모·자식을 함께 지우므로
 *    통과한다 — `NO ACTION`은 **문장 종료 시** 검사하기 때문이다. `RESTRICT`로 바뀌면
 *    (= 즉시 검사) 조용히 깨진다. 그래서 통합 테스트가 그 성질을 따로 못 박는다.
 *
 * ── 여기 **없는** 것 ─────────────────────────────────────────────────────────
 *  - `user` · `session` · `account` · `verification` — 계정이지 모임이 아니다. 모임 하나를
 *    지운다고 사람이 사라지지 않는다(탈퇴는 Task 3의 몫이고 의미가 다르다: 파기 vs 삭제).
 *  - `rate_limits` — 모임에 매달려 있지 않다. 버킷 키는 **접속 IP의 해시**이지 모임 id가
 *    아니므로 "이 모임의 레이트 리밋 행"이라는 것이 존재하지 않는다(있다면 그것 자체가
 *    모임과 IP를 잇는 개인정보가 된다). 값도 60초 윈도라 스스로 무의미해지고 정리 크론이
 *    치운다. FK 폐포 대조가 이 사실을 구조적으로 확인한다 — `rate_limits`는 `groups`를
 *    직·간접으로 참조하지 않으므로 폐포에 들어오지 않는다.
 */

/** `group_id` 컬럼으로 모임에 매달린 테이블. 아래 배열의 원소 타입이다. */
type GroupScopedTable = PgTable & { groupId: PgColumn };

/**
 * 모임에 딸린 행을 지우는 **순서**. `groups` 자신은 여기 없다 — 마지막에 다른 컬럼(`id`)으로
 * 지우므로 같은 배열에 섞으면 타입이 거짓말을 한다.
 */
export const GROUP_CHILD_DELETE_ORDER: readonly GroupScopedTable[] = [
  duesPayments,
  settlementTransfers,
  settlementParticipants,
  settlements,
  duesRounds,
  ledgerEntries,
  memberships,
];

/** 위 순서를 테이블 **이름**으로. FK 메타데이터 대조와 실패 메시지가 쓴다. */
export const GROUP_DELETE_TABLES: readonly string[] = [
  ...GROUP_CHILD_DELETE_ORDER.map((t) => getTableConfig(t).name),
  getTableConfig(groups).name,
];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 모임 하나와 거기 딸린 **모든** 행을 지운다.
 *
 * ⚠️ **반드시 트랜잭션 안에서, `groups` 행을 `for update`로 잠근 뒤에** 부른다.
 * 잠금이 없으면 이 루프가 도는 동안 다른 액션이 같은 모임에 원장·납부를 새로 넣을 수 있고,
 * 그러면 마지막 `groups` 삭제가 그 새 행 때문에 23503으로 실패한다(외부 리뷰 BLOCKER 3).
 * 잠금을 거는 자리는 `actions/group.ts`의 `deleteGroup` 하나뿐이고, 그 순서를 통합 테스트가
 * 동시 쓰기로 증명한다.
 */
export async function deleteGroupRows(tx: Tx, groupId: string): Promise<void> {
  for (const table of GROUP_CHILD_DELETE_ORDER) {
    await tx.delete(table).where(eq(table.groupId, groupId));
  }
  await tx.delete(groups).where(eq(groups.id, groupId));
}
