'use server';
import { z } from 'zod';
import { authActionClient, groupActionClient, assertOwner } from './clients';
import { db } from '@/lib/db';
import { groups, memberships } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { newPublicToken, newToken } from '@/lib/domain/token';
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
        // 초대 토큰은 72비트, 공개 장부 토큰은 128비트 — 두 링크의 위험이 다르다(token.ts 주석).
        inviteToken: newToken(), publicToken: newPublicToken(),
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

/**
 * 공개 장부 링크 재발급 — 총무만. `regenerateInviteToken`과 같은 형태다.
 *
 * 옛 토큰은 이 UPDATE 하나로 즉시 죽는다(조회가 `publicToken = ?`이므로). 캐시가 옛 응답을
 * 살려두지 않는 것은 `/g/:token*`의 `Cache-Control: private, no-store`와 페이지의
 * `force-dynamic`이 맡는다 — 둘 중 하나라도 빠지면 이 액션의 "즉시 무효"가 거짓이 된다.
 */
export const regeneratePublicToken = groupActionClient
  .inputSchema(z.object({ groupId: z.string() }))
  .action(async ({ ctx }) => {
    assertOwner(ctx.role);
    const token = newPublicToken();
    await db.update(groups).set({ publicToken: token }).where(eq(groups.id, ctx.groupId));
    revalidatePath(`/groups/${ctx.groupId}/settings`);
    return { publicToken: token };
  });
