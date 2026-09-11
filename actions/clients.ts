import { createSafeActionClient } from 'next-safe-action';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { memberships } from '@/lib/db/schema';

export class ActionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const actionClient = createSafeActionClient({
  handleServerError(e) {
    if (e instanceof ActionError) return e.code;
    console.error(e);
    return 'INTERNAL_ERROR';
  },
});

export const authActionClient = actionClient.use(async ({ next }) => {
  const session = await auth.api.getSession({ headers: await headers() });
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
