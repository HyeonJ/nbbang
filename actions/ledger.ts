'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { groupActionClient, assertOwner, ActionError } from './clients';
import { db } from '@/lib/db';
import { ledgerEntries } from '@/lib/db/schema';
import { signedAmount, LedgerRuleError } from '@/lib/domain/ledger';

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
    revalidatePath(`/groups/${ctx.groupId}`);
    revalidatePath(`/groups/${ctx.groupId}/expenses`);
    return { ok: true };
  });
