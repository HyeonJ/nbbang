import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isForeignKeyViolation } from '@/lib/db/errors';
import { getSettlement, getSettlements } from '@/lib/db/queries';
import {
  groups,
  memberships,
  settlementParticipants,
  settlementTransfers,
  settlements,
  user,
} from '@/lib/db/schema';
import { newToken } from '@/lib/domain/token';

/**
 * 정산(F4)의 두 방어선을 **실제 DB 왕복으로** 고정한다.
 *
 *  1차 — `createSettlement` 액션: 모임 경계(NOT_MEMBER)·인가(FORBIDDEN)·입력 검증.
 *  2차 — 복합 FK: 액션을 **우회한** 직접 insert가 23503으로 막히는가, 그리고 **어느 제약**이 막는가.
 *
 * 그리고 이 플랜의 BLOCKER 수정이 실제로 동작하는지 — 정산을 만든 뒤 멤버의 표시 이름을 바꿔도
 * 과거 정산의 이름이 **변하지 않는지**(ADR-003 스냅샷).
 *
 * ⚠️ 액션을 부르려면 요청 컨텍스트가 필요하다(`headers()`·`revalidatePath`). 그래서
 * **Next 경계만** 모킹한다 — 인가 미들웨어·zod·도메인·DB는 전부 진짜다. 기존
 * `money-paths.integration.test.ts`가 "액션은 부를 수 없다"고 적은 것은 그 파일이 모킹을
 * 쓰지 않기 때문이고, 여기서는 세션 하나만 바꿔 끼우면 액션 전체 경로가 그대로 돈다.
 */

const session = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
    },
  },
}));

const { createSettlement } = await import('@/actions/settlement');

type Member = { userId: string; membershipId: string; displayName: string };
type Group = { gid: string; owner: Member; members: Member[] };

async function addMember(gid: string, displayName: string, role: 'owner' | 'member') {
  const userId = crypto.randomUUID();
  await db
    .insert(user)
    .values({ id: userId, name: displayName, email: `${userId}@test.local`, emailVerified: false });
  const membershipId = crypto.randomUUID();
  await db.insert(memberships).values({ id: membershipId, userId, groupId: gid, role, displayName });
  return { userId, membershipId, displayName };
}

/** 총무 1명 + `memberNames`만큼의 멤버를 가진 모임. 총무가 기본 호출자다. */
async function seedGroup(label: string, memberNames: string[] = []): Promise<Group> {
  const gid = crypto.randomUUID();
  await db
    .insert(groups)
    .values({ id: gid, name: label, inviteToken: newToken(), publicToken: newToken() });
  const owner = await addMember(gid, `${label}-총무`, 'owner');
  const members: Member[] = [];
  for (const name of memberNames) members.push(await addMember(gid, name, 'member'));
  return { gid, owner, members };
}

/** 거부를 단언할 때 쓰는 포획기 — 에러 원문을 보기 쉽다. */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('거부될 것으로 기대한 쓰기가 성공했다');
}

beforeEach(() => {
  session.userId = null;
});

describe('createSettlement — 1차 방어선(액션)', () => {
  it('3명 정산: 참여자 3행(선결제자 포함)·이체 2행이 남고 분배 합계가 총액이다', async () => {
    const a = await seedGroup('A', ['철수', '영희']);
    session.userId = a.owner.userId;
    const ids = [a.owner.membershipId, a.members[0].membershipId, a.members[1].membershipId];

    const res = await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 10_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: ids,
    });
    expect(res.serverError).toBeUndefined();
    expect(res.validationErrors).toBeUndefined();
    const settlementId = res.data!.settlementId;

    const detail = (await getSettlement(a.gid, settlementId))!;
    // 참여자는 **전원** 남는다 — 선결제자도 한 행이다(초안이 빠뜨렸던 항목).
    expect(detail.participants).toHaveLength(3);
    expect(detail.participants.filter((p) => p.isPayer)).toHaveLength(1);
    expect(detail.participants.reduce((n, p) => n + p.shareAmount, 0)).toBe(10_000);
    // 나머지는 앞에서부터 1원씩 — 선결제자가 첫 참여자이므로 3,334원을 낸다.
    expect(detail.participants.find((p) => p.isPayer)!.shareAmount).toBe(3_334);

    // 채권자가 한 명이므로 이체는 n−1건이고, 선결제자는 자기에게 보내지 않는다.
    expect(detail.transfers).toHaveLength(2);
    expect(detail.transfers.every((t) => t.toMembershipId === a.owner.membershipId)).toBe(true);
    expect(detail.transfers.every((t) => t.amount > 0)).toBe(true);
    expect(detail.transfers.reduce((n, t) => n + t.amount, 0)).toBe(10_000 - 3_334);

    // 이름은 정산 시점 값이 굳어 있다.
    expect(detail.participants.map((p) => p.displayNameAtTime).sort()).toEqual(
      ['A-총무', '영희', '철수'].sort(),
    );
  });

  it('참여자가 1명이면 이체가 0건이고 참여자는 1행이다', async () => {
    const a = await seedGroup('A');
    session.userId = a.owner.userId;
    const res = await createSettlement({
      groupId: a.gid,
      title: '혼밥',
      total: 9_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: [a.owner.membershipId],
    });
    const detail = (await getSettlement(a.gid, res.data!.settlementId))!;
    expect(detail.participants).toHaveLength(1);
    expect(detail.participants[0].shareAmount).toBe(9_000);
    expect(detail.transfers).toHaveLength(0);
  });

  it('타 모임 멤버십을 참여자로 넣으면 NOT_MEMBER — 아무것도 저장되지 않는다', async () => {
    const a = await seedGroup('A', ['철수']);
    const b = await seedGroup('B', ['남의모임멤버']);
    session.userId = a.owner.userId;

    const res = await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 30_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: [a.owner.membershipId, b.members[0].membershipId],
    });
    expect(res.serverError).toBe('NOT_MEMBER');
    expect(await db.select().from(settlements)).toHaveLength(0);
    expect(await db.select().from(settlementParticipants)).toHaveLength(0);
  });

  it('타 모임 멤버십을 선결제자로 지목해도 NOT_MEMBER — 참여자만 검사하면 놓친다', async () => {
    const a = await seedGroup('A', ['철수']);
    const b = await seedGroup('B', ['남의모임멤버']);
    session.userId = a.owner.userId;

    const res = await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 30_000,
      occurredOn: '2026-09-15',
      payerMembershipId: b.members[0].membershipId,
      participantMembershipIds: [a.owner.membershipId, a.members[0].membershipId],
    });
    expect(res.serverError).toBe('NOT_MEMBER');
    expect(await db.select().from(settlements)).toHaveLength(0);
  });

  it('참여자 id가 중복이면 깨끗한 DUPLICATE_PARTICIPANT다 — 23505로 인한 500이 아니다', async () => {
    // Task 5에서 발견한 구멍: 중복이 통과하면 settlement_participants_unique(23505)에 걸려
    // 아무도 잡지 않는 INTERNAL_ERROR가 된다. 경계(zod)에서 막고, 코드가 화면까지 그대로 온다.
    const a = await seedGroup('A', ['철수']);
    session.userId = a.owner.userId;

    const res = await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 30_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: [a.owner.membershipId, a.members[0].membershipId, a.members[0].membershipId],
    });
    expect(res.validationErrors?.code).toBe('DUPLICATE_PARTICIPANT');
    expect(res.serverError).toBeUndefined();
    // 무엇보다 INTERNAL_ERROR(=잡히지 않은 500)가 **아니어야** 한다.
    expect(res.serverError).not.toBe('INTERNAL_ERROR');
    expect(await db.select().from(settlements)).toHaveLength(0);
  });

  it('검증 실패는 전부 코드 하나로 접힌다 — zod 영어 원문이 화면으로 새지 않는다', async () => {
    const a = await seedGroup('A');
    session.userId = a.owner.userId;
    const base = {
      groupId: a.gid,
      title: '회식비',
      total: 30_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: [a.owner.membershipId],
    };
    const codeFor = async (patch: Partial<typeof base>) =>
      (await createSettlement({ ...base, ...patch })).validationErrors?.code;

    expect(await codeFor({ participantMembershipIds: [] })).toBe('NO_PARTICIPANTS');
    expect(await codeFor({ total: 0 })).toBe('INVALID_AMOUNT');
    expect(await codeFor({ total: 1000.5 })).toBe('INVALID_AMOUNT');
    expect(await codeFor({ title: '' })).toBe('INVALID_TITLE');
    expect(await codeFor({ occurredOn: '2026-9-15' })).toBe('INVALID_DATE');
    expect(await codeFor({ participantMembershipIds: Array.from({ length: 101 }, () => crypto.randomUUID()) }))
      .toBe('TOO_MANY_PARTICIPANTS');
  });

  it('선결제자가 참여자 명단에 없으면 PAYER_NOT_PARTICIPANT다 (도메인 규칙)', async () => {
    const a = await seedGroup('A', ['철수']);
    session.userId = a.owner.userId;
    const res = await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 30_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: [a.members[0].membershipId],
    });
    expect(res.serverError).toBe('PAYER_NOT_PARTICIPANT');
    expect(await db.select().from(settlements)).toHaveLength(0);
  });

  it('총무가 아니면 FORBIDDEN이고, 인가가 모임 경계 검사보다 **먼저** 걸린다 (ADR-002)', async () => {
    const a = await seedGroup('A', ['철수']);
    const b = await seedGroup('B', ['남의모임멤버']);
    session.userId = a.members[0].userId; // member

    const res = await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 30_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      // 타 모임 참여자까지 섞었다 — 인가가 먼저면 NOT_MEMBER가 아니라 FORBIDDEN이 나온다.
      participantMembershipIds: [a.owner.membershipId, b.members[0].membershipId],
    });
    expect(res.serverError).toBe('FORBIDDEN');
    expect(await db.select().from(settlements)).toHaveLength(0);
  });

  it('비멤버는 NOT_MEMBER다 — 남의 모임 정산을 만들 수 없다', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    session.userId = b.owner.userId;
    const res = await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 30_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: [a.owner.membershipId],
    });
    expect(res.serverError).toBe('NOT_MEMBER');
    expect(await db.select().from(settlements)).toHaveLength(0);
  });
});

describe('스냅샷 — 이름을 굳힌다 (ADR-003, 외부 리뷰 BLOCKER 4의 증거)', () => {
  it('정산 후 표시 이름을 바꿔도 과거 정산의 이름은 변하지 않는다', async () => {
    const a = await seedGroup('A', ['철수']);
    session.userId = a.owner.userId;
    const res = await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 20_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: [a.owner.membershipId, a.members[0].membershipId],
    });
    const settlementId = res.data!.settlementId;

    const before = (await getSettlement(a.gid, settlementId))!;
    expect(before.participants.map((p) => p.displayNameAtTime)).toContain('철수');

    // 현재 명단을 바꾼다 — 조인해 렌더했다면 여기서 과거 정산이 소급 변경된다.
    await db
      .update(memberships)
      .set({ displayName: '철수(개명)' })
      .where(eq(memberships.id, a.members[0].membershipId));
    const renamed = await db.query.memberships.findFirst({
      where: eq(memberships.id, a.members[0].membershipId),
    });
    expect(renamed!.displayName).toBe('철수(개명)'); // 대조군: 명단은 실제로 바뀌었다

    const after = (await getSettlement(a.gid, settlementId))!;
    expect(after.participants.map((p) => p.displayNameAtTime).sort()).toEqual(
      before.participants.map((p) => p.displayNameAtTime).sort(),
    );
    expect(after.participants.map((p) => p.displayNameAtTime)).toContain('철수');
    expect(after.participants.map((p) => p.displayNameAtTime)).not.toContain('철수(개명)');
  });
});

describe('복합 FK — 2차 방어선 (액션을 우회한 직접 insert)', () => {
  /** 액션을 거치지 않고 만든 정산 머리말. 아래 거부 테스트의 토대다. */
  async function rawSettlement(g: Group) {
    const id = crypto.randomUUID();
    await db.insert(settlements).values({
      id,
      groupId: g.gid,
      title: '직접 insert',
      total: 10_000,
      payerMembershipId: g.owner.membershipId,
      occurredAt: new Date(),
      createdBy: g.owner.userId,
    });
    return id;
  }

  it('정상 경로(모두 같은 모임)는 성공한다 — 아래 거부들이 엉뚱한 이유가 아님을 보인다', async () => {
    const a = await seedGroup('A', ['철수']);
    const sid = await rawSettlement(a);
    await db.insert(settlementParticipants).values({
      id: crypto.randomUUID(),
      groupId: a.gid,
      settlementId: sid,
      membershipId: a.members[0].membershipId,
      displayNameAtTime: '철수',
      shareAmount: 5_000,
      isPayer: false,
    });
    await db.insert(settlementTransfers).values({
      id: crypto.randomUUID(),
      groupId: a.gid,
      settlementId: sid,
      fromMembershipId: a.members[0].membershipId,
      toMembershipId: a.owner.membershipId,
      amount: 5_000,
    });
    expect(await db.select().from(settlementTransfers)).toHaveLength(1);
  });

  it('settlements.payer_membership_id에 타 모임 멤버십은 거부된다 (settlements_payer_fk)', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    const e = await captureError(() =>
      db.insert(settlements).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        title: '침범',
        total: 10_000,
        payerMembershipId: b.owner.membershipId,
        occurredAt: new Date(),
        createdBy: a.owner.userId,
      }),
    );
    expect(isForeignKeyViolation(e, 'settlements_payer_fk')).toBe(true);
  });

  it('settlement_participants에 타 모임 멤버십은 거부된다 (settlement_participants_membership_fk)', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B', ['남의모임멤버']);
    const sid = await rawSettlement(a);

    const e = await captureError(() =>
      db.insert(settlementParticipants).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        settlementId: sid,
        membershipId: b.members[0].membershipId, // 타 모임
        displayNameAtTime: '남의모임멤버',
        shareAmount: 5_000,
        isPayer: false,
      }),
    );
    expect(isForeignKeyViolation(e, 'settlement_participants_membership_fk')).toBe(true);
    expect(await db.select().from(settlementParticipants)).toHaveLength(0);
  });

  it('settlement_participants에 타 모임 정산 id는 거부된다 (settlement_participants_settlement_fk)', async () => {
    const a = await seedGroup('A', ['철수']);
    const b = await seedGroup('B');
    const foreign = await rawSettlement(b);

    const e = await captureError(() =>
      db.insert(settlementParticipants).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        settlementId: foreign, // 타 모임 정산
        membershipId: a.members[0].membershipId,
        displayNameAtTime: '철수',
        shareAmount: 5_000,
        isPayer: false,
      }),
    );
    expect(isForeignKeyViolation(e, 'settlement_participants_settlement_fk')).toBe(true);
  });

  it('settlement_transfers.from_membership_id에 타 모임 멤버십은 거부된다 (settlement_transfers_from_fk)', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B', ['남의모임멤버']);
    const sid = await rawSettlement(a);

    const e = await captureError(() =>
      db.insert(settlementTransfers).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        settlementId: sid,
        fromMembershipId: b.members[0].membershipId, // 타 모임
        toMembershipId: a.owner.membershipId,
        amount: 5_000,
      }),
    );
    expect(isForeignKeyViolation(e, 'settlement_transfers_from_fk')).toBe(true);
  });

  it('settlement_transfers.to_membership_id에 타 모임 멤버십은 거부된다 (settlement_transfers_to_fk)', async () => {
    // ⚠️ 초안에는 **이 FK가 없었다**(외부 리뷰 IMPORTANT 5). to 쪽이 비어 있으면 직접 insert로
    // "남의 모임 사람에게 보내라"는 이체가 저장된다 — 공개 장부가 그것을 그대로 렌더한다.
    const a = await seedGroup('A', ['철수']);
    const b = await seedGroup('B', ['남의모임멤버']);
    const sid = await rawSettlement(a);

    const e = await captureError(() =>
      db.insert(settlementTransfers).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        settlementId: sid,
        fromMembershipId: a.members[0].membershipId,
        toMembershipId: b.members[0].membershipId, // 타 모임
        amount: 5_000,
      }),
    );
    expect(isForeignKeyViolation(e, 'settlement_transfers_to_fk')).toBe(true);
    expect(await db.select().from(settlementTransfers)).toHaveLength(0);
  });

  it('존재하지 않는 멤버십도 거부된다 — FK는 "같은 모임"과 "실재함"을 함께 본다', async () => {
    const a = await seedGroup('A');
    const sid = await rawSettlement(a);
    const e = await captureError(() =>
      db.insert(settlementParticipants).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        settlementId: sid,
        membershipId: crypto.randomUUID(),
        displayNameAtTime: '유령',
        shareAmount: 1,
        isPayer: false,
      }),
    );
    expect(isForeignKeyViolation(e, 'settlement_participants_membership_fk')).toBe(true);
  });
});

describe('정산 쿼리 — 모임 스코프', () => {
  it('getSettlements는 참여 인원을 한 쿼리로 세고 남의 모임은 섞이지 않는다', async () => {
    const a = await seedGroup('A', ['철수', '영희']);
    const b = await seedGroup('B', ['남의모임멤버']);
    session.userId = a.owner.userId;
    await createSettlement({
      groupId: a.gid,
      title: '회식비',
      total: 30_000,
      occurredOn: '2026-09-15',
      payerMembershipId: a.owner.membershipId,
      participantMembershipIds: [
        a.owner.membershipId,
        a.members[0].membershipId,
        a.members[1].membershipId,
      ],
    });
    session.userId = b.owner.userId;
    await createSettlement({
      groupId: b.gid,
      title: '남의 회식비',
      total: 10_000,
      occurredOn: '2026-09-15',
      payerMembershipId: b.owner.membershipId,
      participantMembershipIds: [b.owner.membershipId, b.members[0].membershipId],
    });

    const listA = await getSettlements(a.gid);
    expect(listA).toHaveLength(1);
    expect(listA[0].title).toBe('회식비');
    expect(listA[0].participantCount).toBe(3);

    const listB = await getSettlements(b.gid);
    expect(listB).toHaveLength(1);
    expect(listB[0].participantCount).toBe(2);
  });

  it('남의 모임 정산 id는 getSettlement에서 null이다 — 존재 여부도 새지 않는다', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    session.userId = b.owner.userId;
    const res = await createSettlement({
      groupId: b.gid,
      title: '남의 회식비',
      total: 10_000,
      occurredOn: '2026-09-15',
      payerMembershipId: b.owner.membershipId,
      participantMembershipIds: [b.owner.membershipId],
    });
    expect(await getSettlement(a.gid, res.data!.settlementId)).toBeNull();
    expect(await getSettlement(b.gid, res.data!.settlementId)).not.toBeNull();
  });
});
