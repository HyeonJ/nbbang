import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groups, memberships } from '@/lib/db/schema';

/** 멤버십 확인을 포함한 모임 조회 — 비멤버면 null (페이지에서 notFound 처리). */
export async function getGroupForMember(groupId: string, userId: string) {
  const rows = await db
    .select({ group: groups, membership: memberships })
    .from(memberships)
    .innerJoin(groups, eq(memberships.groupId, groups.id))
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** 모임의 멤버 목록 — 총무 먼저, 이후 합류일 순. */
export async function getGroupMembers(groupId: string) {
  return db
    .select({
      id: memberships.id,
      displayName: memberships.displayName,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .where(eq(memberships.groupId, groupId))
    .orderBy(
      sql`case when ${memberships.role} = 'owner' then 0 else 1 end`,
      asc(memberships.joinedAt),
    );
}
