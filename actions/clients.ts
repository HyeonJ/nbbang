import { createSafeActionClient } from 'next-safe-action';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { UserDeletedError } from '@/lib/db/anonymize';
import { memberships } from '@/lib/db/schema';
import { getActiveSession } from '@/lib/session';

export class ActionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const actionClient = createSafeActionClient({
  handleServerError(e) {
    if (e instanceof ActionError) return e.code;
    // `lib/db/anonymize.ts`의 트랜잭션 안 탈퇴 확인이 던지는 신호. 여기서 한 번 번역하므로
    // 쓰기 액션 일곱 곳이 각자 try/catch로 감싸지 않아도 된다 — 감쌌다면 그중 하나를
    // 빠뜨리는 것이 이 방어가 조용히 죽는 경로가 됐을 것이다.
    if (e instanceof UserDeletedError) return 'ACCOUNT_DELETED';
    console.error(e);
    return 'INTERNAL_ERROR';
  },
});

/**
 * 세션은 `getActiveSession` **하나로만** 읽는다 — 탈퇴한 계정(`user.deleted_at`)이 거기서
 * 걸러진다(ADR-004). 여기서 `auth.api.getSession`을 직접 부르면 액션 경로만 그 차단을
 * 지나치게 되고, 그 불일치는 페이지에서는 로그아웃인데 서버 액션은 통과하는 모양이 된다.
 *
 * ⚠️ 이 검사는 액션 **시작 시점**의 한 번이다. 파기가 그 뒤에 커밋되는 배치를 막으려면
 * 쓰기와 같은 트랜잭션 안의 `assertActiveUser`가 따로 필요하다(외부 리뷰 IMPORTANT 12) —
 * 근거는 `lib/db/anonymize.ts`에 있다.
 */
export const authActionClient = actionClient.use(async ({ next }) => {
  const session = await getActiveSession();
  if (!session) throw new ActionError('UNAUTHENTICATED');
  return next({ ctx: { userId: session.user.id } });
});

// groupId를 bindArgs가 아닌 입력 스키마에 포함하는 액션이 사용.
// 사용법: groupActionClient.inputSchema(z.object({ groupId: z.string(), ... }))
export const groupActionClient = authActionClient.use(async ({ next, ctx, clientInput }) => {
  const parsed = z.object({ groupId: z.string() }).safeParse(clientInput);
  if (!parsed.success) throw new ActionError('INVALID_INPUT');
  const m = await db.query.memberships.findFirst({
    where: and(eq(memberships.groupId, parsed.data.groupId), eq(memberships.userId, ctx.userId)),
  });
  if (!m) throw new ActionError('NOT_MEMBER');
  return next({ ctx: { ...ctx, groupId: parsed.data.groupId, role: m.role, membershipId: m.id } });
});

export function assertOwner(role: string) {
  if (role !== 'owner') throw new ActionError('FORBIDDEN');
}
