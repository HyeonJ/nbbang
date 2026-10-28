import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isForeignKeyViolation } from '@/lib/db/errors';
import { duesRoundMembers, memberships } from '@/lib/db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 회차 명단 쓰기(ADR-005 D1·D3). 회차가 같은 모임의 것인지는 호출자가 `getRound(groupId, …)`로
 * 먼저 확인한다 — 여기의 복합 FK가 모임 경계를 다시 막지만, 그것은 500이지 도메인 코드가 아니다.
 */

/**
 * 회차를 만드는 **같은 트랜잭션** 안에서 부른다 — 회차만 있고 명단이 없는 순간이 생기지 않게.
 * 회차 생성과 동시에 커밋된 나가기는 떠난 사람을 새 명단에 (나감)으로 남길 수 있다.
 * 총무가 면제하면 되므로(D3) 감수하고 잠금은 걸지 않는다.
 */
export async function snapshotRoster(tx: Tx, groupId: string, roundId: string): Promise<void> {
  const active = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt)));
  if (active.length === 0) return;
  await tx
    .insert(duesRoundMembers)
    .values(active.map((m) => ({ groupId, roundId, membershipId: m.id })));
}

export type AddResult = 'added' | 'already' | 'not_active';

export async function addToRoster(groupId: string, roundId: string, membershipId: string): Promise<AddResult> {
  // 떠난 사람을 새 회차 의무에 넣지 않는다 — 나간 뒤의 회차는 그 사람의 것이 아니다.
  // 활동 판정과 삽입을 한 문장으로 묶은 이유: 확인과 삽입 사이에 나가기가 끼어들면
  // 떠난 사람이 명단에 들어가는데, 한 문장이면 그 틈이 없다.
  const inserted = await db
    .insert(duesRoundMembers)
    .select(
      db
        .select({
          groupId: memberships.groupId,
          roundId: sql<string>`${roundId}`.as('round_id'),
          membershipId: memberships.id,
        })
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), eq(memberships.groupId, groupId), isNull(memberships.leftAt))),
    )
    .onConflictDoNothing()
    .returning({ membershipId: duesRoundMembers.membershipId });
  if (inserted.length > 0) return 'added';
  const active = await db.query.memberships.findFirst({
    where: and(eq(memberships.id, membershipId), eq(memberships.groupId, groupId), isNull(memberships.leftAt)),
  });
  return active ? 'already' : 'not_active';
}

export type RemoveResult = 'removed' | 'not_in_roster' | 'paid';

export async function removeFromRoster(
  groupId: string,
  roundId: string,
  membershipId: string,
): Promise<RemoveResult> {
  try {
    const deleted = await db
      .delete(duesRoundMembers)
      .where(
        and(
          eq(duesRoundMembers.groupId, groupId),
          eq(duesRoundMembers.roundId, roundId),
          eq(duesRoundMembers.membershipId, membershipId),
        ),
      )
      .returning({ membershipId: duesRoundMembers.membershipId });
    return deleted.length === 0 ? 'not_in_roster' : 'removed';
  } catch (e) {
    // 납부 기록이 이 명단 행을 가리킨다. 사전 확인 대신 FK에 맡기는 이유: 확인과 삭제 사이에
    // 납부 체크가 끼어들 수 있고, FK는 그 경합까지 막는다.
    if (isForeignKeyViolation(e, 'dues_payments_roster_fk')) return 'paid';
    throw e;
  }
}
