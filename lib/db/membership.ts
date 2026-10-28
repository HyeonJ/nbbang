import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { memberships } from '@/lib/db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 멤버십 상태 전이(ADR-005). 모두 **비교-후-갱신**이다 — WHERE에 기대하는 이전 상태를 넣고
 * 갱신된 행 수로 성공을 판정한다. 읽고 나서 쓰는 사이에 다른 요청이 상태를 바꿔도
 * (예: 되살리는 동안 탈퇴가 `withdrawn`으로 덮음) 잘못된 전이가 일어나지 않는다.
 * 반드시 `assertActiveUser`와 같은 트랜잭션 안에서 부른다(ADR-004 동시성).
 */

/** 활동 중 → left. 총무 여부는 호출자가 먼저 본다. */
export async function markLeftSelf(tx: Tx, membershipId: string): Promise<boolean> {
  const rows = await tx
    .update(memberships)
    .set({ leftAt: new Date(), leftReason: 'left' })
    .where(and(eq(memberships.id, membershipId), eq(memberships.role, 'member'), isNull(memberships.leftAt)))
    .returning({ id: memberships.id });
  return rows.length > 0;
}

/** 활동 중인 **멤버**(총무 아님) → removed. 총무 자신·남의 모임·이미 떠난 사람은 0행이다. */
export async function markRemoved(tx: Tx, groupId: string, membershipId: string): Promise<boolean> {
  const rows = await tx
    .update(memberships)
    .set({ leftAt: new Date(), leftReason: 'removed' })
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.groupId, groupId),
        eq(memberships.role, 'member'),
        isNull(memberships.leftAt),
      ),
    )
    .returning({ id: memberships.id });
  return rows.length > 0;
}

/** removed → 활동 중. `left`·`withdrawn`은 되살리지 않는다(스스로 나간 사람은 링크로 돌아온다). */
export async function restoreRemoved(tx: Tx, groupId: string, membershipId: string): Promise<boolean> {
  const rows = await tx
    .update(memberships)
    .set({ leftAt: null, leftReason: null })
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.groupId, groupId),
        eq(memberships.leftReason, 'removed'),
      ),
    )
    .returning({ id: memberships.id });
  return rows.length > 0;
}

/** left → 활동 중 + 새 이름. 초대 링크 재가입 전용. */
export async function rejoinLeft(tx: Tx, membershipId: string, displayName: string): Promise<boolean> {
  const rows = await tx
    .update(memberships)
    .set({ leftAt: null, leftReason: null, displayName })
    .where(and(eq(memberships.id, membershipId), eq(memberships.leftReason, 'left')))
    .returning({ id: memberships.id });
  return rows.length > 0;
}
