'use server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { ActionError, assertOwner, authActionClient, displayNameOrThrow, groupActionClient } from './clients';
import { db } from '@/lib/db';
import { assertActiveUser } from '@/lib/db/anonymize';
import { isUniqueViolation } from '@/lib/db/errors';
import { markLeftSelf, markRemoved, rejoinLeft, restoreRemoved } from '@/lib/db/membership';
import { groups, memberships } from '@/lib/db/schema';
import { joinDecision } from '@/lib/domain/member';

// 예외: 그룹 대상 쓰기지만 groupActionClient가 아닌 authActionClient 사용.
// 합류·재가입 시점의 사용자는 활동 중인 멤버가 아니므로 멤버십 검사를 통과할 수 없다 (리뷰 승인된 유일한 비멤버 쓰기).
export const joinByInvite = authActionClient
  .inputSchema(z.object({ token: z.string(), displayName: z.string().min(1).max(20) }))
  .action(async ({ parsedInput, ctx }) => {
    const displayName = displayNameOrThrow(parsedInput.displayName);
    const group = await db.query.groups.findFirst({ where: eq(groups.inviteToken, parsedInput.token) });
    if (!group) throw new ActionError('INVALID_INVITE');
    const existing = await db.query.memberships.findFirst({
      where: and(eq(memberships.groupId, group.id), eq(memberships.userId, ctx.userId)),
    });
    const decision = joinDecision(existing ? { leftReason: existing.leftReason } : null);

    if (decision === 'already') return { groupId: group.id, already: true };
    // 내보내진 사람이 링크로 돌아오면 내보내기가 링크 재발급 없이는 의미가 없다(ADR-005 D4).
    if (decision === 'blocked') throw new ActionError('REMOVED_FROM_GROUP');

    if (decision === 'rejoin' && existing) {
      const rejoined = await db.transaction(async (tx) => {
        await assertActiveUser(tx, ctx.userId);
        return rejoinLeft(tx, existing.id, displayName);
      });
      if (!rejoined) {
        // 읽은 뒤 상태가 바뀌었다 — 동시 재가입(이미 돌아옴)이거나 총무가 그 사이에 바꿨다.
        const now = await db.query.memberships.findFirst({ where: eq(memberships.id, existing.id) });
        if (!now) throw new ActionError('INVALID_INVITE');
        if (now.leftReason == null) {
          revalidatePath('/groups');
          return { groupId: group.id, already: true };
        }
        throw new ActionError('REMOVED_FROM_GROUP');
      }
      revalidatePath('/groups');
      return { groupId: group.id, already: false };
    }

    try {
      // 합류도 `memberships.user_id`에 사용자 id를 **기록하는** 쓰기다 — 탈퇴 확인이 이
      // insert와 같은 트랜잭션 안에 있어야 한다(ADR-004 동시성).
      await db.transaction(async (tx) => {
        await assertActiveUser(tx, ctx.userId);
        await tx.insert(memberships).values({
          id: crypto.randomUUID(), userId: ctx.userId, groupId: group.id,
          role: 'member', displayName,
        });
      });
    } catch (e) {
      // 동시 합류 레이스: 유니크 인덱스(memberships_user_group)가 최종 방어선.
      // 진 쪽도 "이미 멤버"와 같은 결과로 본다.
      if (isUniqueViolation(e)) {
        revalidatePath('/groups');
        return { groupId: group.id, already: true };
      }
      throw e;
    }
    revalidatePath('/groups');
    return { groupId: group.id, already: false };
  });

/** 멤버 본인이 모임을 떠난다. 총무는 떠날 수 없다 — 위임이 먼저다(요구사항 P1). */
export const leaveGroup = groupActionClient
  .inputSchema(z.object({ groupId: z.string() }))
  .action(async ({ ctx }) => {
    if (ctx.role === 'owner') throw new ActionError('OWNER_CANNOT_LEAVE');
    const left = await db.transaction(async (tx) => {
      await assertActiveUser(tx, ctx.userId);
      return markLeftSelf(tx, ctx.membershipId);
    });
    // 미들웨어 통과 뒤 다른 요청이 먼저 떠나게 했다(동시 클릭·내보내기).
    if (!left) throw new ActionError('NOT_MEMBER');
    revalidatePath('/groups');
    return { left: true };
  });

const memberInput = z.object({ groupId: z.string(), membershipId: z.string() });

/** 총무가 멤버를 내보낸다. 기록은 남고 접근만 끊긴다. 총무 자신은 대상이 아니다. */
export const removeMember = groupActionClient
  .inputSchema(memberInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const removed = await db.transaction(async (tx) => {
      await assertActiveUser(tx, ctx.userId);
      return markRemoved(tx, ctx.groupId, parsedInput.membershipId);
    });
    if (!removed) throw new ActionError('NOT_MEMBER');
    revalidatePath(`/groups/${ctx.groupId}`, 'layout');
    return { removed: true };
  });

/** 내보낸 멤버를 되살린다. 스스로 나간 사람·탈퇴자는 대상이 아니다. */
export const restoreMember = groupActionClient
  .inputSchema(memberInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const restored = await db.transaction(async (tx) => {
      await assertActiveUser(tx, ctx.userId);
      return restoreRemoved(tx, ctx.groupId, parsedInput.membershipId);
    });
    if (!restored) throw new ActionError('NOT_REMOVED');
    revalidatePath(`/groups/${ctx.groupId}`, 'layout');
    return { restored: true };
  });
