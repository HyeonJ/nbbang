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
    const groupId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(groups).values({
        id: groupId, name: parsedInput.name,
        inviteToken: newToken(), publicToken: newToken(),
      });
      await tx.insert(memberships).values({
        id: crypto.randomUUID(), userId: ctx.userId, groupId,
        role: 'owner', displayName: parsedInput.displayName,
      });
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
