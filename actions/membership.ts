'use server';
import { z } from 'zod';
import { authActionClient, ActionError } from './clients';
import { db } from '@/lib/db';
import { groups, memberships } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

// 예외: 그룹 대상 쓰기지만 groupActionClient가 아닌 authActionClient 사용.
// 합류 시점의 사용자는 아직 멤버가 아니므로 멤버십 검사를 통과할 수 없다 (리뷰 승인된 유일한 비멤버 쓰기).
export const joinByInvite = authActionClient
  .inputSchema(z.object({ token: z.string(), displayName: z.string().min(1).max(20) }))
  .action(async ({ parsedInput, ctx }) => {
    const group = await db.query.groups.findFirst({ where: eq(groups.inviteToken, parsedInput.token) });
    if (!group) throw new ActionError('INVALID_INVITE');
    const dup = await db.query.memberships.findFirst({
      where: and(eq(memberships.groupId, group.id), eq(memberships.userId, ctx.userId)),
    });
    if (dup) return { groupId: group.id, already: true };
    await db.insert(memberships).values({
      id: crypto.randomUUID(), userId: ctx.userId, groupId: group.id,
      role: 'member', displayName: parsedInput.displayName,
    });
    revalidatePath('/groups');
    return { groupId: group.id, already: false };
  });
