import { describe, it, expect, vi, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getPublicLedger } from '@/lib/db/public-queries';
import { getGroupForMember, getGroupMembers, getLeftMembers } from '@/lib/db/queries';
import { groups, memberships, settlements, user } from '@/lib/db/schema';
import type { LeftReason } from '@/lib/domain/member';
import { newPublicToken, newToken } from '@/lib/domain/token';

/**
 * 멤버 생명주기(Plan 05, ADR-005)를 실제 DB 왕복으로 고정한다.
 * 세션은 settlement.integration.test.ts와 같은 방식으로 흉내 낸다 — 여기서 보는 것은
 * Better Auth가 아니라 "활동 중" 판정과 명단 규칙이다.
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

const { createExpense } = await import('@/actions/ledger');
const { createSettlement } = await import('@/actions/settlement');

type Member = { userId: string; membershipId: string; displayName: string };
type Group = { gid: string; inviteToken: string; publicToken: string; owner: Member; members: Member[] };

async function addMember(gid: string, displayName: string, role: 'owner' | 'member'): Promise<Member> {
  const userId = crypto.randomUUID();
  await db
    .insert(user)
    .values({ id: userId, name: displayName, email: `${userId}@test.local`, emailVerified: false });
  const membershipId = crypto.randomUUID();
  await db.insert(memberships).values({ id: membershipId, userId, groupId: gid, role, displayName });
  return { userId, membershipId, displayName };
}

async function seedGroup(memberNames: string[] = []): Promise<Group> {
  const gid = crypto.randomUUID();
  const inviteToken = newToken();
  const publicToken = newPublicToken();
  await db.insert(groups).values({ id: gid, name: '생명주기모임', inviteToken, publicToken });
  const owner = await addMember(gid, '총무', 'owner');
  const members: Member[] = [];
  for (const name of memberNames) members.push(await addMember(gid, name, 'member'));
  return { gid, inviteToken, publicToken, owner, members };
}

/** 액션을 거치지 않고 떠난 상태를 만든다 — 판정(읽기) 쪽을 쓰기 쪽과 떼어 시험하기 위해. */
async function markLeft(m: Member, reason: LeftReason) {
  await db
    .update(memberships)
    .set({ leftAt: new Date(), leftReason: reason })
    .where(eq(memberships.id, m.membershipId));
}

beforeEach(() => {
  session.userId = null;
});

describe('활동 중 판정 — 나간 사람은 모임에서 사라진다', () => {
  it('페이지 접근(getGroupForMember)이 null이 된다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    expect(await getGroupForMember(g.gid, chulsoo.userId)).not.toBeNull();
    await markLeft(chulsoo, 'left');
    expect(await getGroupForMember(g.gid, chulsoo.userId)).toBeNull();
  });

  it('액션 접근이 FORBIDDEN이 아니라 NOT_MEMBER가 된다 — 역할 이전에 소속에서 막힌다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    session.userId = chulsoo.userId;
    const input = { groupId: g.gid, amount: 1000, occurredOn: '2026-10-01' };

    expect((await createExpense(input)).serverError).toBe('FORBIDDEN');
    await markLeft(chulsoo, 'left');
    expect((await createExpense(input)).serverError).toBe('NOT_MEMBER');
  });

  it('멤버 목록·공개 장부 멤버 목록에서 빠지고, 나간 멤버 목록에 나온다', async () => {
    const g = await seedGroup(['철수', '영희']);
    const [chulsoo, younghee] = g.members;
    await markLeft(chulsoo, 'removed');

    expect((await getGroupMembers(g.gid)).map((m) => m.id)).toEqual([
      g.owner.membershipId,
      younghee.membershipId,
    ]);
    expect((await getPublicLedger(g.publicToken))!.members.map((m) => m.displayName)).toEqual(['총무', '영희']);

    const left = await getLeftMembers(g.gid);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: chulsoo.membershipId, displayName: '철수', leftReason: 'removed' });
  });

  it('정산 참여자·선결제자로 나간 사람을 넣으면 NOT_MEMBER — 아무것도 저장되지 않는다', async () => {
    const g = await seedGroup(['철수', '영희']);
    const [chulsoo, younghee] = g.members;
    await markLeft(chulsoo, 'left');
    session.userId = g.owner.userId;
    const base = { groupId: g.gid, title: '회식', total: 30_000, occurredOn: '2026-10-01' };

    const asParticipant = await createSettlement({
      ...base,
      payerMembershipId: g.owner.membershipId,
      participantMembershipIds: [g.owner.membershipId, chulsoo.membershipId],
    });
    expect(asParticipant.serverError).toBe('NOT_MEMBER');

    const asPayer = await createSettlement({
      ...base,
      payerMembershipId: chulsoo.membershipId,
      participantMembershipIds: [g.owner.membershipId, younghee.membershipId],
    });
    expect(asPayer.serverError).toBe('NOT_MEMBER');
    expect(await db.select().from(settlements).where(eq(settlements.groupId, g.gid))).toHaveLength(0);
  });

  it('CHECK — left_at과 left_reason은 함께 채워지거나 함께 비어 있다', async () => {
    const g = await seedGroup(['철수']);
    // drizzle이 PG 오류를 "Failed query"로 감싸므로 제약 이름은 cause에 있다.
    const error = await db
      .update(memberships)
      .set({ leftAt: new Date() })
      .where(and(eq(memberships.id, g.members[0].membershipId), eq(memberships.groupId, g.gid)))
      .then(
        () => null,
        (e: unknown) => e as { cause?: { message?: string } },
      );
    expect(error?.cause?.message).toMatch(/memberships_left_consistency/);
  });
});
