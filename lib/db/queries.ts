import { and, asc, desc, eq, sql, sum } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groups, ledgerEntries, memberships } from '@/lib/db/schema';

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

/**
 * 잔액 = 원장 합산(파생값). 엔트리가 없으면 0 (ADR-001 — 잔액은 절대 저장하지 않는다).
 *
 * pg의 sum()은 numeric을 돌려주므로 드라이버가 정밀도 손실을 피해 문자열로 준다.
 * 행이 없을 때는 null이다 — 둘 다 Number()로 정수 원으로 되돌린다.
 */
export async function getBalance(groupId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(ledgerEntries.amount) })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.groupId, groupId));
  return Number(row?.total ?? 0);
}

/** 최근 원장 내역 — 발생일 내림차순, 같은 날은 기록순으로 뒤에서부터. */
export async function getRecentEntries(groupId: string, limit = 10) {
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.groupId, groupId))
    .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.createdAt))
    .limit(limit);
}
