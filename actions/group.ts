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

/**
 * 입금 계좌 표시 문구 저장 — 총무만 (F6). `groups.accountLabel`의 유일한 쓰기 경로다.
 *
 * ── 빈 문자열을 저장하지 않는 이유 ──────────────────────────────────────────
 * 폼은 비운 칸을 `''`로 보낸다. 그것을 그대로 저장하면 "계좌가 없다"가 `null`과 `''` 두 값으로
 * 갈라지고, 문구를 붙일지 말지 판단하는 곳마다 `!label`처럼 **둘 다** 걸러야 한다 —
 * 한 군데만 `!== null`로 쓰면 빈 `계좌:` 줄이 단톡방으로 나간다. 그래서 경계에서 한 번 접는다.
 * 공백만 입력한 경우도 같다(trim 후 빈 문자열) — `계좌:   `는 계좌가 아니다.
 *
 * `z.string().trim().max(60)`의 순서가 중요하다: trim이 먼저라 뒤에 공백을 붙여 60자 제한을
 * 넘길 수 없다. 60자는 '은행명 + 계좌번호 + 예금주'에 넉넉하고, 단톡방에 붙는 한 줄이라
 * 더 길어지면 문구가 읽히지 않는다.
 */
export const updateGroupAccount = groupActionClient
  .inputSchema(z.object({
    groupId: z.string(),
    accountLabel: z.string().trim().max(60),
  }))
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const accountLabel = parsedInput.accountLabel === '' ? null : parsedInput.accountLabel;
    await db.update(groups).set({ accountLabel }).where(eq(groups.id, ctx.groupId));
    revalidatePath(`/groups/${ctx.groupId}/settings`);
    // 계좌 문구는 **회차 화면의 안내 문구**에 실린다 — 회차 id를 모르므로 회비 하위 전체를 무효화한다.
    // 'page'로는 `/dues`만 무효가 되어 이미 열려 있던 회차 화면이 옛 문구를 계속 보여준다.
    revalidatePath(`/groups/${ctx.groupId}/dues`, 'layout');
    return { accountLabel };
  });
