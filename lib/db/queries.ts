import { and, asc, count, desc, eq, or, sql, sum } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';
import {
  duesPayments,
  duesRounds,
  groups,
  ledgerEntries,
  memberships,
  settlementParticipants,
  settlementTransfers,
  settlements,
} from '@/lib/db/schema';

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

export type LedgerExportRow = Awaited<ReturnType<typeof getAllEntries>>[number];

/**
 * CSV 내보내기(F7)가 쓰는 원장 **전부** — limit 없이, **발생일 오름차순**.
 *
 * 화면(`getRecentEntries`·`getExpenseEntries`)은 내림차순이다. 여기서만 오름차순인 이유:
 * 화면은 "방금 뭘 했지"를 보는 곳이고 파일은 **시간순으로 읽는 장부**다. 스프레드시트에서
 * 누적 잔액 열을 하나 만들면 위에서 아래로 더해지는 순서여야 한다.
 *
 * ⚠️ 컬럼을 **하나하나 적어 고른다** — `lib/db/public-queries.ts`와 같은 이유이고, 여기서는
 * 그 이유가 한 단계 더 직접적이다: 이 select의 결과가 그대로 **파일의 셀**이 된다.
 * `select()`를 인자 없이 쓰면 `created_by`(userId)와 `group_id`가 CSV에 실려 나간다.
 * 공개 장부가 내보내지 않는 것은 CSV도 내보내지 않는다 — 인증을 요구한다고 해서
 * 원장 파일이 계정 식별자를 나를 이유가 되지는 않는다(그 파일은 카톡방으로 흘러간다).
 *
 * `reversalTargetLabel`은 정정 대상을 **사람이 읽을 수 있게** 만든 것이다. `reversal_of`를
 * 그대로 내보내면 CSV 안에 그 id를 가진 행이 없어 가리키는 곳이 없는 참조가 된다
 * (플랜의 `정정대상` 열은 이 문제를 보지 못했다). 자기 조인 한 번으로 대상의 발생일과
 * 메모를 함께 읽어 `2026-01-15 코트 대관` 형태로 만든다.
 */
export async function getAllEntries(groupId: string) {
  const target = alias(ledgerEntries, 'reversal_target');
  return db
    .select({
      type: ledgerEntries.type,
      amount: ledgerEntries.amount,
      occurredAt: ledgerEntries.occurredAt,
      category: ledgerEntries.category,
      memo: ledgerEntries.memo,
      reversalTargetOccurredAt: target.occurredAt,
      reversalTargetMemo: target.memo,
      reversalTargetCategory: target.category,
    })
    .from(ledgerEntries)
    .leftJoin(target, eq(target.id, ledgerEntries.reversalOf))
    .where(eq(ledgerEntries.groupId, groupId))
    .orderBy(asc(ledgerEntries.occurredAt), asc(ledgerEntries.createdAt));
}

export type RoundWithCount = Awaited<ReturnType<typeof getRoundsWithCounts>>[number];

/**
 * 회비 회차 목록 + 회차별 납부 인원. 한 번의 쿼리로 끝낸다(N+1 금지).
 *
 * dues_rounds LEFT JOIN dues_payments → GROUP BY dues_rounds.id → count(dues_payments.id).
 * LEFT JOIN이라 납부가 0인 회차도 행이 남고, count()는 NULL을 세지 않으므로 그 행은 0이 된다.
 * GROUP BY는 PK 하나로 충분하다 — pg가 같은 테이블의 나머지 컬럼을 함수 종속으로 인정한다.
 *
 * 정렬은 period 문자열 내림차순 — 'YYYY-MM'은 사전순=시간순이라 날짜 변환 없이 최신 회차가 위로 온다.
 */
export async function getRoundsWithCounts(groupId: string) {
  return db
    .select({
      id: duesRounds.id,
      period: duesRounds.period,
      amountPerPerson: duesRounds.amountPerPerson,
      createdAt: duesRounds.createdAt,
      paidCount: count(duesPayments.id),
    })
    .from(duesRounds)
    .leftJoin(duesPayments, eq(duesPayments.roundId, duesRounds.id))
    .where(eq(duesRounds.groupId, groupId))
    .groupBy(duesRounds.id)
    .orderBy(desc(duesRounds.period));
}

/**
 * 회차의 납부 멤버십 id 목록 — 회차 화면의 3수치·미납자 판정이 모두 이 집합에서 나온다.
 *
 * roundId는 호출 전에 모임으로 스코프해 확인해야 한다(getRound) — 이 쿼리는 roundId만 받으므로
 * 그 자체로는 모임 경계를 지을 수 없다. (dues_payments는 이제 group_id를 갖고 복합 FK로 회차와
 * 같은 모임에 묶여 있지만, 그것은 "행이 일관됨"을 보장할 뿐 이 함수가 남의 모임 회차를 읽는 것을
 * 막지는 않는다 — 호출자의 스코프 확인은 여전히 필요하다.)
 */
export async function getRoundPaidMembershipIds(roundId: string): Promise<string[]> {
  const rows = await db
    .select({ membershipId: duesPayments.membershipId })
    .from(duesPayments)
    .where(eq(duesPayments.roundId, roundId));
  return rows.map((r) => r.membershipId);
}

/** 모임으로 스코프한 회차 단건 — 남의 모임 roundId는 null로 떨어진다(존재 여부도 새지 않는다). */
export async function getRound(groupId: string, roundId: string) {
  const rows = await db
    .select({
      id: duesRounds.id,
      period: duesRounds.period,
      amountPerPerson: duesRounds.amountPerPerson,
    })
    .from(duesRounds)
    .where(and(eq(duesRounds.id, roundId), eq(duesRounds.groupId, groupId)))
    .limit(1);
  return rows[0] ?? null;
}

export type SettlementListItem = Awaited<ReturnType<typeof getSettlements>>[number];

/**
 * 정산 목록 + 정산별 참여 인원. 한 번의 쿼리로 끝낸다(N+1 금지) —
 * `getRoundsWithCounts`와 같은 모양이다: LEFT JOIN → GROUP BY PK → count(자식 PK).
 * LEFT JOIN이라 참여자가 0인 정산(있을 수 없지만)도 행이 남고, count()는 NULL을 세지 않는다.
 *
 * ⚠️ `memberships`를 조인하지 않는다. 선결제자 이름이 필요하면 `settlement_participants`의
 * `display_name_at_time`에서 가져온다 — 현재 명단을 조인하는 순간 과거 정산이 소급 변경된다(ADR-003).
 */
export async function getSettlements(groupId: string) {
  return db
    .select({
      id: settlements.id,
      title: settlements.title,
      total: settlements.total,
      occurredAt: settlements.occurredAt,
      createdAt: settlements.createdAt,
      payerMembershipId: settlements.payerMembershipId,
      participantCount: count(settlementParticipants.id),
    })
    .from(settlements)
    .leftJoin(settlementParticipants, eq(settlementParticipants.settlementId, settlements.id))
    .where(eq(settlements.groupId, groupId))
    .groupBy(settlements.id)
    .orderBy(desc(settlements.occurredAt), desc(settlements.createdAt));
}

export type SettlementDetail = NonNullable<Awaited<ReturnType<typeof getSettlement>>>;

/**
 * 정산 상세 — 머리말 1행 + 참여자 **전원** + 이체 전원. 남의 모임 id는 null로 떨어진다.
 *
 * 세 테이블은 세 쿼리로 읽는다. 한 번의 조인으로 합치면 참여자 × 이체의 카티션 곱이 되어
 * 행을 다시 갈라야 하고, 참여자만 있고 이체가 0건인 정산(1명 정산)에서 모양이 또 갈린다.
 * 세 쿼리는 정산 하나당 고정 3회라 N+1이 아니다.
 *
 * ⚠️ 여기서도 `memberships` 조인은 없다 — 이름은 전부 `displayNameAtTime`이다(ADR-003 스냅샷).
 * 이름이 바뀌거나 멤버가 떠나도 이 화면은 변하지 않아야 한다.
 */
export async function getSettlement(groupId: string, settlementId: string) {
  const [settlement] = await db
    .select({
      id: settlements.id,
      title: settlements.title,
      total: settlements.total,
      payerMembershipId: settlements.payerMembershipId,
      occurredAt: settlements.occurredAt,
      createdAt: settlements.createdAt,
    })
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)))
    .limit(1);
  if (!settlement) return null;

  const participants = await db
    .select({
      membershipId: settlementParticipants.membershipId,
      displayNameAtTime: settlementParticipants.displayNameAtTime,
      shareAmount: settlementParticipants.shareAmount,
      isPayer: settlementParticipants.isPayer,
    })
    .from(settlementParticipants)
    .where(
      and(
        eq(settlementParticipants.settlementId, settlementId),
        eq(settlementParticipants.groupId, groupId),
      ),
    )
    // 선결제자를 맨 위로, 그 다음은 이름순 — 같은 정산을 두 사람이 봐도 같은 순서로 읽힌다.
    .orderBy(desc(settlementParticipants.isPayer), asc(settlementParticipants.displayNameAtTime));

  const transfers = await db
    .select({
      id: settlementTransfers.id,
      fromMembershipId: settlementTransfers.fromMembershipId,
      toMembershipId: settlementTransfers.toMembershipId,
      amount: settlementTransfers.amount,
    })
    .from(settlementTransfers)
    .where(
      and(
        eq(settlementTransfers.settlementId, settlementId),
        eq(settlementTransfers.groupId, groupId),
      ),
    )
    .orderBy(desc(settlementTransfers.amount), asc(settlementTransfers.fromMembershipId));

  return { settlement, participants, transfers };
}
