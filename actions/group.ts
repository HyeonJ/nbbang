'use server';
import { z } from 'zod';
import { authActionClient, groupActionClient, assertOwner } from './clients';
import { db } from '@/lib/db';
import { groups, memberships } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { newToken } from '@/lib/domain/token';
import { revalidatePath } from 'next/cache';

export const createGroup = authActionClient
  .inputSchema(z.object({
    name: z.string().min(1).max(50),
    displayName: z.string().min(1).max(20),
  }))
  .action(async ({ parsedInput, ctx }) => {
    // neon-http 드라이버는 트랜잭션 미지원 — 아래 2-insert는 현재 원자적이지 않다.
    // Plan 02에서 원장 도입 시 neon-serverless(WebSocket) 드라이버로 전환하면서
    // db.transaction()으로 감싼다. 그때까지는 이 비원자성을 의도적으로 수용한다.
    const groupId = crypto.randomUUID();
    await db.insert(groups).values({
      id: groupId, name: parsedInput.name,
      inviteToken: newToken(), publicToken: newToken(),
    });
    await db.insert(memberships).values({
      id: crypto.randomUUID(), userId: ctx.userId, groupId,
      role: 'owner', displayName: parsedInput.displayName,
    });
    revalidatePath('/groups');
    return { groupId };
  });

export const regenerateInviteToken = groupActionClient
  .inputSchema(z.object({ groupId: z.string() }))
  .action(async ({ ctx }) => {
    assertOwner(ctx.role);
    const token = newToken();
    await db.update(groups).set({ inviteToken: token }).where(eq(groups.id, ctx.groupId));
    revalidatePath(`/groups/${ctx.groupId}/settings`);
    return { inviteToken: token };
  });
