'use server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { groupActionClient, assertOwner, ActionError } from './clients';
import { revalidateLedger } from './revalidate';
import { db } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db/errors';
import { getRound } from '@/lib/db/queries';
import { duesPayments, duesRounds, ledgerEntries, memberships } from '@/lib/db/schema';
import { parsePeriod, DuesRuleError } from '@/lib/domain/dues';
import { reversalAmount, signedAmount, LedgerRuleError } from '@/lib/domain/ledger';

export const createRound = groupActionClient
  .inputSchema(
    z.object({
      groupId: z.string(),
      period: z.string(),
      amountPerPerson: z.number().int().positive().max(10_000_000),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    // zod는 period가 문자열인지만 본다 — 'YYYY-MM' 판정은 parsePeriod가 유일한 관문이다.
    // 그 형식이 (모임, 기간) 유니크 키의 절반이라 여기를 건너뛰면 '2026-1'·' 2026-01'·'2026-01-01'이
    // 모두 서로 다른 회차로 들어앉는다. 폼이 month 입력을 쓰는 것과 무관하게 반드시 서버에서 본다.
    let period: string;
    try {
      period = parsePeriod(parsedInput.period);
    } catch (e) {
      throw e instanceof DuesRuleError ? new ActionError(e.code) : e;
    }
    const dup = await db.query.duesRounds.findFirst({
      where: and(eq(duesRounds.groupId, ctx.groupId), eq(duesRounds.period, period)),
    });
    if (dup) throw new ActionError('ROUND_EXISTS');
    const id = crypto.randomUUID();
    try {
      await db.insert(duesRounds).values({
        id,
        groupId: ctx.groupId,
        period,
        amountPerPerson: parsedInput.amountPerPerson,
      });
    } catch (e) {
      // 위 사전 확인과 이 insert 사이에는 트랜잭션이 없다 — 총무 둘이 같은 달 회차를 동시에 만들면
      // 양쪽 다 dup=null을 본다. dues_rounds_group_period 유니크 인덱스가 마지막 방어선이고,
      // 진 쪽에도 사전 확인과 같은 코드를 돌려줘야 UI 문구가 갈리지 않는다
      // (reverseEntry의 ALREADY_REVERSED와 같은 패턴·이유).
      if (isUniqueViolation(e)) {
        // 진 쪽 화면에는 이미 만들어진 회차가 보여야 한다 — 에러를 던지기 전에 목록을 무효화한다.
        revalidatePath(`/groups/${ctx.groupId}/dues`);
        throw new ActionError('ROUND_EXISTS');
      }
      throw e;
    }
    revalidatePath(`/groups/${ctx.groupId}/dues`);
    return { roundId: id };
  });

/**
 * 납부 체크 = 원장 엔트리(+금액) + 납부 기록 한 쌍. 한쪽만 남으면 둘 다 거짓말이 되므로 한 트랜잭션이다.
 *
 * ⚠️ 모임 경계: `dues_payments`에는 group_id가 없다 — 스코프는 roundId → dues_rounds.group_id로만
 * 지을 수 있고, 그 판정을 하는 곳은 이 액션 레이어뿐이다(DB 제약이 대신 막아주지 못한다).
 * 그래서 회차는 getRound(ctx.groupId, …)로, 멤버십은 ctx.groupId로 스코프해 읽는다.
 * 남의 모임 roundId·membershipId는 조회 결과에 애초에 들어오지 않는다(존재 여부도 새지 않는다).
 */
export const markPaid = groupActionClient
  .inputSchema(z.object({ groupId: z.string(), roundId: z.string(), membershipId: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const round = await getRound(ctx.groupId, parsedInput.roundId);
    if (!round) throw new ActionError('ROUND_NOT_FOUND');
    const member = await db.query.memberships.findFirst({
      where: and(eq(memberships.id, parsedInput.membershipId), eq(memberships.groupId, ctx.groupId)),
    });
    if (!member) throw new ActionError('NOT_MEMBER');

    let amount: number;
    try {
      amount = signedAmount('DUES_PAYMENT', round.amountPerPerson);
    } catch (e) {
      throw e instanceof LedgerRuleError ? new ActionError(e.code) : e;
    }

    const entryId = crypto.randomUUID();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(ledgerEntries).values({
          id: entryId,
          groupId: ctx.groupId,
          type: 'DUES_PAYMENT',
          amount,
          occurredAt: new Date(),
          category: '회비',
          memo: `${round.period} ${member.displayName}`,
          createdBy: ctx.userId,
          reversalOf: null,
        });
        await tx.insert(duesPayments).values({
          id: crypto.randomUUID(),
          roundId: round.id,
          membershipId: member.id,
          ledgerEntryId: entryId,
        });
      });
    } catch (e) {
      // 중복 체크(같은 회차·멤버)는 dues_payments_round_membership 유니크 인덱스가 막는다.
      // 이미 납부인 사람에게 '체크'가 눌렸다는 건 내 화면이 낡았다는 뜻이다(reverseEntry의
      // ALREADY_REVERSED와 같은 판단) — 에러가 아닌 멱등 성공으로 돌려주되, 돌아가기 전에
      // 화면을 새로 받게 해 그 사람이 완료 섹션으로 옮겨 앉게 한다. 트랜잭션이므로 원장에도 덤이 남지 않는다.
      if (isUniqueViolation(e)) {
        revalidatePayment(ctx.groupId, parsedInput.roundId);
        return { already: true };
      }
      throw e;
    }
    revalidatePayment(ctx.groupId, round.id);
    return { already: false };
  });

/**
 * 납부 취소 = 역분개 + 납부 기록 삭제 (ADR-001). 원장은 +20,000/−20,000 두 줄로 영구히 남고
 * `dues_payments`는 "지금 납부 상태"만 들고 있다 — 그래서 재납부가 다시 가능해진다.
 *
 * assertReversible을 부르지 않는 이유: 대상 엔트리는 살아 있는 납부 기록이 가리키는 엔트리다.
 * 역분개는 그 기록을 지우는 같은 트랜잭션 안에서만 일어나므로, 기록이 남아 있는 동안 그 엔트리가
 * 이미 역분개됐을 수 없다(취소→재체크를 반복하면 회차·멤버당 엔트리가 여러 개 쌓이지만, 각 엔트리에
 * 달리는 역분개는 하나뿐이다). 확인하려면 모임 원장 전체를 읽어야 하는데(reverseEntry가 그렇게 한다)
 * 그 읽기는 여기서 구조적으로 이미 참인 명제를 다시 세는 비용이고, 무엇보다 동시 클릭 레이스를
 * 막지도 못한다 — 읽기와 쓰기 사이가 비어 있다. 실제 방어선은 reversal_of 유니크 인덱스이고,
 * 그 위반을 아래에서 멱등 성공으로 처리한다.
 */
export const unmarkPaid = groupActionClient
  .inputSchema(z.object({ groupId: z.string(), roundId: z.string(), membershipId: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    // 납부 기록을 회차로 조인해 모임까지 좁힌다 — 타 모임 침범 차단(위 markPaid 주석의 그 경계).
    const [payment] = await db
      .select({ id: duesPayments.id, ledgerEntryId: duesPayments.ledgerEntryId })
      .from(duesPayments)
      .innerJoin(duesRounds, eq(duesPayments.roundId, duesRounds.id))
      .where(
        and(
          eq(duesPayments.roundId, parsedInput.roundId),
          eq(duesPayments.membershipId, parsedInput.membershipId),
          eq(duesRounds.groupId, ctx.groupId),
        ),
      );
    if (!payment) throw new ActionError('PAYMENT_NOT_FOUND');

    const [entry] = await db
      .select({
        id: ledgerEntries.id,
        type: ledgerEntries.type,
        amount: ledgerEntries.amount,
        reversalOf: ledgerEntries.reversalOf,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, payment.ledgerEntryId));
    // ledger_entry_id는 not null + FK다 — 여기는 도달 불가지만, 없는 엔트리를 역분개하는 일은 없어야 한다.
    if (!entry) throw new ActionError('ENTRY_NOT_FOUND');

    try {
      await db.transaction(async (tx) => {
        await tx.insert(ledgerEntries).values({
          id: crypto.randomUUID(),
          groupId: ctx.groupId,
          type: 'REVERSAL',
          amount: reversalAmount(entry),
          occurredAt: new Date(),
          category: '회비',
          memo: '납부 취소',
          createdBy: ctx.userId,
          reversalOf: entry.id,
        });
        await tx.delete(duesPayments).where(eq(duesPayments.id, payment.id));
      });
    } catch (e) {
      // 이 트랜잭션에서 유니크 위반이 날 자리는 reversal_of 하나뿐 — 총무 둘이 같은 '취소'를
      // 동시에 눌러 진 쪽이다. 진 트랜잭션은 통째로 롤백되지만 이긴 쪽이 이미 같은 일을 끝냈으므로
      // 최종 상태는 정확히 우리가 원한 그것이다(역분개 1줄 + 기록 삭제) — 멱등 성공으로 돌려준다.
      if (isUniqueViolation(e)) {
        revalidatePayment(ctx.groupId, parsedInput.roundId);
        return { ok: true };
      }
      throw e;
    }
    revalidatePayment(ctx.groupId, parsedInput.roundId);
    return { ok: true };
  });

/** 납부는 잔액·회차 목록·이 회차 화면을 동시에 낡게 만든다 — 원장 화면들 + 회차 상세. */
function revalidatePayment(groupId: string, roundId: string) {
  revalidateLedger(groupId);
  revalidatePath(`/groups/${groupId}/dues/${roundId}`);
}
