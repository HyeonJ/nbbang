import { and, asc, desc, eq, or, sql, sum } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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

export type ExpenseEntry = Awaited<ReturnType<typeof getExpenseEntries>>[number];

/**
 * 지출 화면이 쓰는 원장 조각 — EXPENSE 엔트리 + "그 EXPENSE를 겨눈" REVERSAL 엔트리.
 *
 * 자기 조인 한 번으로 끝낸다(N+1 금지): 각 행을 reversal_of로 자기 테이블에 LEFT JOIN해
 * 대상의 type을 같이 읽고, `type='EXPENSE' OR 대상.type='EXPENSE'`로 거른다.
 * REVERSAL만 reversal_of를 갖기 때문에 두 번째 조건은 회비 납부의 역분개를 걸러낸다.
 */
export async function getExpenseEntries(groupId: string) {
  const target = alias(ledgerEntries, 'reversal_target');
  return db
    .select({
      id: ledgerEntries.id,
      type: ledgerEntries.type,
      amount: ledgerEntries.amount,
      occurredAt: ledgerEntries.occurredAt,
      category: ledgerEntries.category,
      memo: ledgerEntries.memo,
      reversalOf: ledgerEntries.reversalOf,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .leftJoin(target, eq(target.id, ledgerEntries.reversalOf))
    .where(
      and(
        eq(ledgerEntries.groupId, groupId),
        or(eq(ledgerEntries.type, 'EXPENSE'), eq(target.type, 'EXPENSE')),
      ),
    )
    .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.createdAt));
}
