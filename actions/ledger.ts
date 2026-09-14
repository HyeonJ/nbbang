'use server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { groupActionClient, assertOwner, ActionError } from './clients';
import { db } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db/errors';
import { ledgerEntries } from '@/lib/db/schema';
import {
  assertReversible,
  reversalAmount,
  signedAmount,
  LedgerRuleError,
} from '@/lib/domain/ledger';

/**
 * 금액이 하나라도 움직이면 그 돈을 보여주는 화면이 전부 함께 낡는다 — 한 번에 무효화한다.
 * 회비 화면도 포함한다: 납부는 원장 엔트리로 잔액을 움직이고(Task 9), 회차 목록의 수납액도 같은 돈이다.
 */
function revalidateLedger(groupId: string) {
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/expenses`);
  revalidatePath(`/groups/${groupId}/dues`);
}

export const createExpense = groupActionClient
  .inputSchema(
    z.object({
      groupId: z.string(),
      amount: z.number().int().positive().max(100_000_000),
      occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      category: z.string().max(20).optional(),
      memo: z.string().max(100).optional(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    let amount: number;
    try {
      amount = signedAmount('EXPENSE', parsedInput.amount);
    } catch (e) {
      throw e instanceof LedgerRuleError ? new ActionError(e.code) : e;
    }
    // 입력은 KST 날짜(YYYY-MM-DD) — 그날 정오(UTC 03:00)로 저장해 시간대 경계에서 날짜가 밀리지 않게 한다.
    const occurredAt = new Date(`${parsedInput.occurredOn}T03:00:00.000Z`);
    await db.insert(ledgerEntries).values({
      id: crypto.randomUUID(),
      groupId: ctx.groupId,
      type: 'EXPENSE',
      amount,
      occurredAt,
      category: parsedInput.category || null,
      memo: parsedInput.memo || null,
      createdBy: ctx.userId,
      reversalOf: null,
    });
    revalidateLedger(ctx.groupId);
    return { ok: true };
  });

/**
 * 정정 = 역분개 (ADR-001). 원본은 건드리지 않고 정확히 반대 금액의 REVERSAL 엔트리를 덧붙인다.
 *
 * 엔트리를 모임으로 스코프해 읽는 것이 이 액션의 보안 핵심이다 — 남의 모임 entryId는
 * 조회 결과에 애초에 들어오지 않으므로 ENTRY_NOT_FOUND로 떨어진다(존재 여부도 새지 않는다).
 */
export const reverseEntry = groupActionClient
  .inputSchema(z.object({ groupId: z.string(), entryId: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const entries = await db
      .select({
        id: ledgerEntries.id,
        type: ledgerEntries.type,
        amount: ledgerEntries.amount,
        reversalOf: ledgerEntries.reversalOf,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.groupId, ctx.groupId));
    const target = entries.find((e) => e.id === parsedInput.entryId);
    if (!target) throw new ActionError('ENTRY_NOT_FOUND');
    try {
      assertReversible(target, entries);
    } catch (e) {
      if (!(e instanceof LedgerRuleError)) throw e;
      // ALREADY_REVERSED는 "내 화면이 낡았다"는 뜻이다(남이 먼저 정정했다) — 목록을 새로 받게 해
      // 뱃지가 드러나고 버튼이 사라지게 한다. NOT_REVERSIBLE·ENTRY_NOT_FOUND는 화면이 맞으니 그대로 둔다.
      if (e.code === 'ALREADY_REVERSED') revalidateLedger(ctx.groupId);
      throw new ActionError(e.code);
    }
    try {
      await db.insert(ledgerEntries).values({
        id: crypto.randomUUID(),
        groupId: ctx.groupId,
        type: 'REVERSAL',
        amount: reversalAmount(target),
        occurredAt: new Date(),
        category: null,
        memo: `정정: ${parsedInput.entryId.slice(0, 8)}`,
        createdBy: ctx.userId,
        reversalOf: target.id,
      });
    } catch (e) {
      // 위 검증은 읽고 쓰는 사이에 트랜잭션이 없다 — 총무 둘이 같은 행의 '정정'을 동시에 누르면
      // 양쪽 모두 assertReversible을 통과한다. reversal_of 유니크 인덱스가 마지막 방어선이고,
      // 진 쪽에도 도메인 검증과 같은 코드를 돌려줘야 UI 문구가 갈리지 않는다.
      if (isUniqueViolation(e)) {
        // 진 쪽 화면에는 이미 정정된 행이 보여야 한다 — 에러를 던지기 전에 목록을 무효화한다.
        revalidateLedger(ctx.groupId);
        throw new ActionError('ALREADY_REVERSED');
      }
      throw e;
    }
    revalidateLedger(ctx.groupId);
    return { ok: true };
  });
