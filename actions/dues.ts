'use server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { groupActionClient, assertOwner, ActionError } from './clients';
import { db } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db/errors';
import { duesRounds } from '@/lib/db/schema';
import { parsePeriod, DuesRuleError } from '@/lib/domain/dues';

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
