'use server';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { groupActionClient, assertOwner, ActionError } from './clients';
import { db } from '@/lib/db';
import {
  memberships,
  settlements,
  settlementParticipants,
  settlementTransfers,
} from '@/lib/db/schema';
import { splitEvenly, minimalTransfers, SettlementRuleError } from '@/lib/domain/settlement';

/**
 * 이 액션이 낼 수 있는 **모든** 실패를 하나의 코드 어휘로 모은다.
 *
 * 왜 필요한가: next-safe-action은 입력 검증 실패를 `validationErrors`로, 액션 본문의
 * ActionError를 `serverError`로 돌려준다 — **서로 다른 두 채널**이다. zod 기본 모양은
 * 필드별 `_errors: string[]` 트리라서, 화면이 그대로 받으면 한국어로 옮길 수 없는
 * 원문 덤프가 된다("Too small: expected array to have >=1 items" 같은 것).
 * 그래서 각 zod 규칙의 message를 도메인 코드로 적고, 아래 shape 함수가 트리를 코드 하나로
 * 접는다. 화면은 `serverError ?? validationErrors?.code` 한 줄이면 두 채널을 함께 덮는다.
 */
const ACTION_CODES = new Set([
  'INVALID_TITLE',
  'INVALID_AMOUNT',
  'INVALID_DATE',
  'NO_PARTICIPANTS',
  'TOO_MANY_PARTICIPANTS',
  'DUPLICATE_PARTICIPANT',
  'PAYER_NOT_PARTICIPANT',
  'INVALID_INPUT',
]);

const createSettlementSchema = z.object({
  groupId: z.string().min(1, 'INVALID_INPUT'),
  title: z.string().min(1, 'INVALID_TITLE').max(50, 'INVALID_TITLE'),
  total: z
    .number('INVALID_AMOUNT')
    .int('INVALID_AMOUNT')
    .positive('INVALID_AMOUNT')
    .max(100_000_000, 'INVALID_AMOUNT'),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE'),
  payerMembershipId: z.string().min(1, 'PAYER_NOT_PARTICIPANT'),
  // ⚠️ 유일성을 **경계에서** 강제한다 (Task 5에서 발견): 중복이 들어오면 같은 사람에게 Share 행이
  // 둘 생겨 settlement_participants_unique(23505)에 걸리고, 아무도 잡지 않는 500이 된다.
  // 도메인의 DUPLICATE_PARTICIPANT와 DB 유니크는 백스톱이고, 여기가 첫 관문이다.
  participantMembershipIds: z
    .array(z.string().min(1, 'INVALID_INPUT'), 'NO_PARTICIPANTS')
    .min(1, 'NO_PARTICIPANTS')
    .max(100, 'TOO_MANY_PARTICIPANTS')
    .refine((ids) => new Set(ids).size === ids.length, { message: 'DUPLICATE_PARTICIPANT' }),
});

/** zod의 `_errors` 트리를 깊이 우선으로 훑어 메시지를 선언 순서대로 모은다. */
function collectMessages(node: unknown, out: string[]): void {
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '_errors') {
      if (Array.isArray(value)) out.push(...value.filter((v): v is string => typeof v === 'string'));
      continue;
    }
    collectMessages(value, out);
  }
}

export const createSettlement = groupActionClient
  .inputSchema(createSettlementSchema, {
    // 검증 실패를 코드 하나로 접는다(위 ACTION_CODES 주석 참조). 알 수 없는 메시지가 섞여도
    // 원문을 흘리지 않고 INVALID_INPUT으로 떨어뜨린다 — 화면에 zod 영어가 새는 경로를 닫는다.
    handleValidationErrorsShape: async (validationErrors) => {
      const messages: string[] = [];
      collectMessages(validationErrors, messages);
      return { code: messages.find((m) => ACTION_CODES.has(m)) ?? 'INVALID_INPUT' };
    },
  })
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);

    // 모임 경계는 여기서 그린다(ADR-002). 참여자와 **선결제자까지** 전부 이 모임의 멤버여야 한다 —
    // 선결제자를 빠뜨리면 settlements_payer_fk가 23503으로 막지만, 그건 500이지 NOT_MEMBER가 아니다.
    //
    // 플랜 스니펫은 같은 where로 두 번 조회했다(존재 확인용 id 한 번, 이름 굳히기 한 번).
    // 한 번에 읽는다 — 두 쿼리 사이에 이름이 바뀌면 "확인한 명단"과 "굳힌 이름"의 시점이 갈리고,
    // 무엇보다 같은 답을 두 번 묻는 왕복이다. 이 한 번의 읽기가 **스냅샷의 시점**이다.
    const ids = Array.from(
      new Set([...parsedInput.participantMembershipIds, parsedInput.payerMembershipId]),
    );
    const rows = await db
      .select({ id: memberships.id, displayName: memberships.displayName })
      .from(memberships)
      .where(and(eq(memberships.groupId, ctx.groupId), inArray(memberships.id, ids)));
    if (rows.length !== ids.length) throw new ActionError('NOT_MEMBER');
    const nameById = new Map(rows.map((m) => [m.id, m.displayName]));

    let shares, transfers;
    try {
      shares = splitEvenly(parsedInput.total, parsedInput.participantMembershipIds);
      transfers = minimalTransfers(shares, parsedInput.payerMembershipId, parsedInput.total);
    } catch (e) {
      throw e instanceof SettlementRuleError ? new ActionError(e.code) : e;
    }

    const settlementId = crypto.randomUUID();
    const participantRows = shares.map((s) => {
      const displayNameAtTime = nameById.get(s.membershipId);
      // 위 NOT_MEMBER 검사가 ids 전부를 이 맵에 넣었으므로 도달 불가다.
      // 그래도 조용히 빈 이름을 굳히지는 않는다 — 스냅샷에 거짓을 적느니 정산을 만들지 않는다.
      if (displayNameAtTime === undefined) throw new ActionError('NOT_MEMBER');
      return {
        id: crypto.randomUUID(),
        groupId: ctx.groupId,
        settlementId,
        membershipId: s.membershipId,
        displayNameAtTime,
        shareAmount: s.amount,
        isPayer: s.membershipId === parsedInput.payerMembershipId,
      };
    });

    // 머리말·참여자·이체는 함께여야 뜻이 있다 — 참여자 없는 정산이나 합계가 어긋난 이체 목록은
    // 스냅샷이 아니라 손상된 기록이다. 한 트랜잭션으로 묶는다.
    await db.transaction(async (tx) => {
      await tx.insert(settlements).values({
        id: settlementId,
        groupId: ctx.groupId,
        title: parsedInput.title,
        total: parsedInput.total,
        payerMembershipId: parsedInput.payerMembershipId,
        // 날짜만 받아 KST 정오로 굳힌다 — 자정으로 두면 UTC 변환에서 하루가 앞뒤로 밀린다.
        occurredAt: new Date(`${parsedInput.occurredOn}T03:00:00.000Z`),
        createdBy: ctx.userId,
      });
      // 참여자는 전원 기록한다 — 선결제자도, 부담액이 0원인 사람도 (ADR-003 스냅샷).
      await tx.insert(settlementParticipants).values(participantRows);
      // 이체는 0건일 수 있다(참여자 1명, 또는 전원 0원) — 빈 배열 insert는 SQL이 되지 않는다.
      if (transfers.length > 0) {
        await tx.insert(settlementTransfers).values(
          transfers.map((t) => ({
            id: crypto.randomUUID(),
            groupId: ctx.groupId,
            settlementId,
            fromMembershipId: t.from,
            toMembershipId: t.to,
            amount: t.amount,
          })),
        );
      }
    });

    // 정산은 원장을 건드리지 않으므로(ADR-003) 잔액 화면은 낡지 않는다 — 정산 목록만 무효화한다.
    revalidatePath(`/groups/${ctx.groupId}/settle`);
    return { settlementId };
  });
