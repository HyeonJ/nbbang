'use server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { ActionError, authActionClient } from './clients';
import { db } from '@/lib/db';
import { anonymizeUserRows, countOwnedGroups } from '@/lib/db/anonymize';
import { user } from '@/lib/db/schema';
// `'use server'` 파일은 async 함수만 export할 수 있다 — 확인 문구는 순수 모듈에 산다
// (`lib/domain/account.ts`에 그 경위가 적혀 있다).
import { DELETE_ACCOUNT_CONFIRM } from '@/lib/domain/account';

/**
 * 회원 탈퇴 — 되돌릴 수 없다. 의미는 **행 삭제가 아니라 식별자 파기**다(ADR-004).
 *
 * ── 트랜잭션 안의 순서가 이 액션의 전부다 ───────────────────────────────────
 *  1. `select … from "user" where id = $1 for update` — **먼저** 자기 행을 잠근다
 *     (외부 리뷰 IMPORTANT 12). 잠금이 없으면 파기가 도는 동안 다른 요청이 같은 id로
 *     원장·정산을 새로 적을 수 있다. 쓰기 쪽의 짝은 `assertActiveUser`의 `for key share`이고,
 *     두 잠금이 충돌하기 때문에 경쟁하는 쓰기는 **기다렸다가 자기가 거절당한다** — 탈퇴가 이긴다.
 *  2. **확인 문구·소유 모임 검사도 그 잠금 뒤, 트랜잭션 안에서** 한다. 잠금 전에 세면 그
 *     사이에 모임을 하나 더 만든 사람이 총무인 채로 탈퇴한다(`deleteGroup`의 이름 확인이
 *     잠금 뒤인 것과 같은 이유).
 *  3. `anonymizeUserRows` — 파기 목록(`lib/db/anonymize.ts`) 그대로.
 *
 * ── Better Auth의 `deleteUser`를 쓰지 않는다 ────────────────────────────────
 * 그것은 `user` 행을 **하드 삭제**한다. `memberships.user_id` · `ledger_entries.created_by` ·
 * `settlements.created_by` 셋이 `notNull`로 그 행을 참조하므로 23503으로 실패하고,
 * 캐스케이드를 걸어 성공시키면 남의 모임 금액 기록이 함께 사라진다(ADR-001 위반).
 *
 * ── 총무는 탈퇴할 수 없다 ──────────────────────────────────────────────────
 * 총무가 사라진 모임은 회차도, 지출도, 링크 재발급도 할 수 없는 **관리 불가 상태**가 된다.
 * 총무 위임(`transferOwnership`)은 아직 없으므로 소유한 모임이 있으면 `OWNS_GROUPS`로
 * 거절하고, 화면은 **이유를 설명하는** 문구를 보여준다(외부 리뷰 MINOR 23).
 *
 * 화면의 타이핑 확인은 **연출이다** — 서버 액션은 공개 엔드포인트다(ADR-002).
 */
export const deleteAccount = authActionClient
  .inputSchema(z.object({ confirm: z.string().min(1).max(20) }))
  .action(async ({ parsedInput, ctx }) => {
    // 확인 문구 비교는 **양쪽 trim 후 정확 일치** — `deleteGroup`과 같은 규칙이다.
    // 앞뒤 공백 때문에 탈퇴가 막히는 것은 방어가 아니라 버그다("문구를 알아야 한다"는 그대로).
    if (parsedInput.confirm.trim() !== DELETE_ACCOUNT_CONFIRM) {
      throw new ActionError('CONFIRM_MISMATCH');
    }

    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ email: user.email, deletedAt: user.deletedAt })
        .from(user)
        .where(eq(user.id, ctx.userId))
        .limit(1)
        .for('update');
      // 세션이 해석됐으므로 보통은 도달하지 않는다 — 같은 계정의 탈퇴가 겹칠 때의 자리다.
      if (!locked) throw new ActionError('UNAUTHENTICATED');
      if (locked.deletedAt) throw new ActionError('ALREADY_DELETED');

      if ((await countOwnedGroups(tx, ctx.userId)) > 0) throw new ActionError('OWNS_GROUPS');

      // 이메일은 **잠근 행에서 읽은 값**이다 — 액션 진입 시 읽은 값을 쓰면 그 사이에 바뀐
      // 이메일의 verification 행을 놓친다.
      await anonymizeUserRows(tx, ctx.userId, locked.email);
    });

    // 세션 행이 사라졌으므로 다음 요청부터 쿠키는 죽은 값이다. 캐시된 서버 컴포넌트가
    // 탈퇴자의 이름을 계속 그리지 않도록 트리 전체를 무효화한다.
    revalidatePath('/', 'layout');
    return { deleted: true };
  });
