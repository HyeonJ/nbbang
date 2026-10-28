import { describe, it, expect, vi, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getPublicLedger } from '@/lib/db/public-queries';
import { constraintOf } from '@/lib/db/errors';
import {
  getGroupForMember,
  getGroupMembers,
  getLeftMembers,
  getRoundRoster,
  getRoundsWithCounts,
} from '@/lib/db/queries';
import { duesPayments, duesRoundMembers, groups, ledgerEntries, memberships, settlements, user } from '@/lib/db/schema';
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

const { createGroup } = await import('@/actions/group');
const { createExpense } = await import('@/actions/ledger');
const { createSettlement } = await import('@/actions/settlement');
const { createRound, markPaid, addToRound, removeFromRound } = await import('@/actions/dues');
const { joinByInvite, leaveGroup, removeMember, restoreMember } = await import('@/actions/membership');

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

async function membershipState(m: Member) {
  const [row] = await db
    .select({ leftAt: memberships.leftAt, leftReason: memberships.leftReason, displayName: memberships.displayName })
    .from(memberships)
    .where(eq(memberships.id, m.membershipId));
  return row;
}

/** 거부를 단언할 때 쓰는 포획기 — 성공하면 테스트가 실패한다. */
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
    const error = await captureError(() =>
      db.update(memberships).set({ leftAt: new Date() }).where(eq(memberships.id, g.members[0].membershipId)),
    );
    expect(constraintOf(error)).toBe('memberships_left_consistency');
  });
});

/** 총무로 회차를 만들고 id를 돌려준다. */
async function newRound(g: Group, period = '2026-10') {
  session.userId = g.owner.userId;
  const res = await createRound({ groupId: g.gid, period, amountPerPerson: 10_000 });
  expect(res.serverError).toBeUndefined();
  return res.data!.roundId;
}

const rosterIds = async (roundId: string) =>
  (await getRoundRoster(roundId)).map((r) => r.membershipId).sort();

describe('회차 명단 — 생성 시점에 고정된다 (D1)', () => {
  it('만드는 순간의 활동 중 멤버만 들어가고, 나중에 합류한 사람은 없다', async () => {
    const g = await seedGroup(['철수', '영희']);
    const [chulsoo, younghee] = g.members;
    await markLeft(younghee, 'left');

    const roundId = await newRound(g);
    expect(await rosterIds(roundId)).toEqual([g.owner.membershipId, chulsoo.membershipId].sort());

    await addMember(g.gid, '늦게온사람', 'member');
    expect(await rosterIds(roundId)).toEqual([g.owner.membershipId, chulsoo.membershipId].sort());
  });

  it('명단을 만든 뒤 떠난 사람은 명단에 남고 left로 표시된다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    const roundId = await newRound(g);
    await markLeft(chulsoo, 'left');

    const roster = await getRoundRoster(roundId);
    expect(roster.map((r) => [r.displayName, r.left])).toEqual([
      ['총무', false],
      ['철수', true],
    ]);
    const [row] = (await getRoundsWithCounts(g.gid)).filter((r) => r.id === roundId);
    expect(row.rosterCount).toBe(2);
  });
});

describe('납부는 명단 안에서만', () => {
  it('명단 밖 사람의 납부 체크는 NOT_IN_ROSTER이고 원장에 아무것도 남지 않는다', async () => {
    const g = await seedGroup();
    const roundId = await newRound(g);
    const late = await addMember(g.gid, '늦게온사람', 'member');

    session.userId = g.owner.userId;
    const res = await markPaid({ groupId: g.gid, roundId, membershipId: late.membershipId });
    expect(res.serverError).toBe('NOT_IN_ROSTER');
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.groupId, g.gid))).toHaveLength(0);
  });

  it('명단에 있다가 떠난 사람의 납부는 받는다 — 빚을 갚는 길은 열려 있다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    const roundId = await newRound(g);
    await markLeft(chulsoo, 'left');

    session.userId = g.owner.userId;
    const res = await markPaid({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });
    expect(res.serverError).toBeUndefined();
    expect(res.data).toEqual({ already: false });
  });
});

describe('명단 편집 — 총무의 면제·추가 (D3)', () => {
  it('미납자를 빼면 명단에서 사라진다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    const roundId = await newRound(g);

    session.userId = g.owner.userId;
    const res = await removeFromRound({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });
    expect(res.serverError).toBeUndefined();
    expect(await rosterIds(roundId)).toEqual([g.owner.membershipId]);
  });

  it('납부한 사람은 뺄 수 없다 — PAID_MEMBER이고 명단·납부가 그대로다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    const roundId = await newRound(g);
    session.userId = g.owner.userId;
    const paidRes = await markPaid({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });
    expect(paidRes.serverError).toBeUndefined();

    const res = await removeFromRound({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });
    expect(res.serverError).toBe('PAID_MEMBER');
    expect(await rosterIds(roundId)).toContain(chulsoo.membershipId);
    expect(await db.select().from(duesPayments).where(eq(duesPayments.roundId, roundId))).toHaveLength(1);
  });

  it('명단에 없는 사람을 빼면 NOT_IN_ROSTER', async () => {
    const g = await seedGroup();
    const roundId = await newRound(g);
    const late = await addMember(g.gid, '늦게온사람', 'member');
    session.userId = g.owner.userId;
    const res = await removeFromRound({ groupId: g.gid, roundId, membershipId: late.membershipId });
    expect(res.serverError).toBe('NOT_IN_ROSTER');
  });

  it('활동 중인 멤버를 넣을 수 있고, 두 번 넣어도 한 행이다', async () => {
    const g = await seedGroup();
    const roundId = await newRound(g);
    const late = await addMember(g.gid, '늦게온사람', 'member');

    session.userId = g.owner.userId;
    expect((await addToRound({ groupId: g.gid, roundId, membershipId: late.membershipId })).data).toEqual({
      already: false,
    });
    expect((await addToRound({ groupId: g.gid, roundId, membershipId: late.membershipId })).data).toEqual({
      already: true,
    });
    expect(
      await db
        .select()
        .from(duesRoundMembers)
        .where(and(eq(duesRoundMembers.roundId, roundId), eq(duesRoundMembers.membershipId, late.membershipId))),
    ).toHaveLength(1);
  });

  it('떠난 사람은 넣을 수 없다 — NOT_MEMBER', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    await markLeft(chulsoo, 'left');
    const roundId = await newRound(g);
    session.userId = g.owner.userId;
    const res = await addToRound({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });
    expect(res.serverError).toBe('NOT_MEMBER');
  });

  it('멤버(총무 아님)는 면제·추가 모두 FORBIDDEN', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    const roundId = await newRound(g);
    session.userId = chulsoo.userId;
    const input = { groupId: g.gid, roundId, membershipId: chulsoo.membershipId };
    expect((await removeFromRound(input)).serverError).toBe('FORBIDDEN');
    expect((await addToRound(input)).serverError).toBe('FORBIDDEN');
  });
});

describe('명단 편집 — 경합과 모임 경계', () => {
  it('면제한 뒤의 납부 체크는 NOT_IN_ROSTER이고 원장이 늘지 않는다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    const roundId = await newRound(g);
    session.userId = g.owner.userId;
    const removed = await removeFromRound({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });
    expect(removed.serverError).toBeUndefined();

    const res = await markPaid({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });
    expect(res.serverError).toBe('NOT_IN_ROSTER');
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.groupId, g.gid))).toHaveLength(0);
  });

  it('다른 모임의 멤버십은 추가 NOT_MEMBER, 면제 NOT_IN_ROSTER — 500이 아니다', async () => {
    const g = await seedGroup();
    const other = await seedGroup(['타모임']);
    const roundId = await newRound(g);
    const foreign = other.members[0];

    session.userId = g.owner.userId;
    const input = { groupId: g.gid, roundId, membershipId: foreign.membershipId };
    expect((await addToRound(input)).serverError).toBe('NOT_MEMBER');
    expect((await removeFromRound(input)).serverError).toBe('NOT_IN_ROSTER');
    expect(await rosterIds(roundId)).toEqual([g.owner.membershipId]);
  });
});

describe('나가기 · 내보내기 · 되살리기 (D2·D4)', () => {
  it('멤버는 스스로 나갈 수 있다 — left로 표시되고 행은 남는다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    session.userId = chulsoo.userId;

    const res = await leaveGroup({ groupId: g.gid });
    expect(res.serverError).toBeUndefined();
    const s = await membershipState(chulsoo);
    expect(s.leftReason).toBe('left');
    expect(s.leftAt).toBeInstanceOf(Date);
    expect(s.displayName).toBe('철수');
  });

  it('총무는 나갈 수 없다 — OWNER_CANNOT_LEAVE', async () => {
    const g = await seedGroup();
    session.userId = g.owner.userId;
    expect((await leaveGroup({ groupId: g.gid })).serverError).toBe('OWNER_CANNOT_LEAVE');
    expect((await membershipState(g.owner)).leftReason).toBeNull();
  });

  it('총무는 멤버를 내보내고 되살릴 수 있다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    session.userId = g.owner.userId;

    expect((await removeMember({ groupId: g.gid, membershipId: chulsoo.membershipId })).serverError).toBeUndefined();
    expect((await membershipState(chulsoo)).leftReason).toBe('removed');

    expect((await restoreMember({ groupId: g.gid, membershipId: chulsoo.membershipId })).serverError).toBeUndefined();
    const s = await membershipState(chulsoo);
    expect(s.leftReason).toBeNull();
    expect(s.leftAt).toBeNull();
  });

  it('총무는 자기 자신을 내보낼 수 없고, 스스로 나간 사람은 되살릴 수 없다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    session.userId = g.owner.userId;
    expect((await removeMember({ groupId: g.gid, membershipId: g.owner.membershipId })).serverError).toBe(
      'NOT_MEMBER',
    );

    await markLeft(chulsoo, 'left');
    expect((await restoreMember({ groupId: g.gid, membershipId: chulsoo.membershipId })).serverError).toBe(
      'NOT_REMOVED',
    );
    expect((await membershipState(chulsoo)).leftReason).toBe('left');
  });

  it('멤버는 남을 내보내거나 되살릴 수 없다 — FORBIDDEN', async () => {
    const g = await seedGroup(['철수', '영희']);
    const [chulsoo, younghee] = g.members;
    session.userId = chulsoo.userId;
    expect((await removeMember({ groupId: g.gid, membershipId: younghee.membershipId })).serverError).toBe(
      'FORBIDDEN',
    );
    expect((await restoreMember({ groupId: g.gid, membershipId: younghee.membershipId })).serverError).toBe(
      'FORBIDDEN',
    );
  });

  it('나간 사람이 다시 나가기를 누르면 NOT_MEMBER — 이미 모임 밖이다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    await markLeft(chulsoo, 'left');
    session.userId = chulsoo.userId;
    expect((await leaveGroup({ groupId: g.gid })).serverError).toBe('NOT_MEMBER');
  });
});

describe('다른 모임의 멤버십은 건드릴 수 없다', () => {
  it('A의 총무가 B의 멤버십 id로 내보내기·되살리기를 하면 거부되고 B의 행은 그대로다', async () => {
    const a = await seedGroup();
    const b = await seedGroup(['철수']);
    const [chulsoo] = b.members;
    session.userId = a.owner.userId;

    expect((await removeMember({ groupId: a.gid, membershipId: chulsoo.membershipId })).serverError).toBe(
      'NOT_MEMBER',
    );
    expect((await membershipState(chulsoo)).leftReason).toBeNull();

    await markLeft(chulsoo, 'removed');
    const before = await membershipState(chulsoo);
    expect((await restoreMember({ groupId: a.gid, membershipId: chulsoo.membershipId })).serverError).toBe(
      'NOT_REMOVED',
    );
    expect(await membershipState(chulsoo)).toEqual(before);
  });
});

describe('초대 링크로 다시 들어오기 (D4)', () => {
  it('스스로 나간 사람은 같은 멤버십으로 돌아오고 새 이름을 쓴다 — 과거 납부가 이어진다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    const roundId = await newRound(g);
    await markPaid({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });
    await markLeft(chulsoo, 'left');

    session.userId = chulsoo.userId;
    const res = await joinByInvite({ token: g.inviteToken, displayName: '철수2' });
    expect(res.serverError).toBeUndefined();
    expect(res.data).toEqual({ groupId: g.gid, already: false });

    const rows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, g.gid), eq(memberships.userId, chulsoo.userId)));
    expect(rows, '재가입이 새 멤버십을 만들었다').toHaveLength(1);
    expect(rows[0].id).toBe(chulsoo.membershipId);
    expect(rows[0].leftReason).toBeNull();
    expect(rows[0].displayName).toBe('철수2');
    expect(await db.select().from(duesPayments).where(eq(duesPayments.membershipId, chulsoo.membershipId))).toHaveLength(1);
  });

  it('내보내진 사람은 링크로 돌아올 수 없다 — REMOVED_FROM_GROUP이고 상태가 그대로다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    await markLeft(chulsoo, 'removed');

    session.userId = chulsoo.userId;
    const res = await joinByInvite({ token: g.inviteToken, displayName: '철수' });
    expect(res.serverError).toBe('REMOVED_FROM_GROUP');
    expect((await membershipState(chulsoo)).leftReason).toBe('removed');
  });

  it('활동 중인 멤버의 재합류는 already', async () => {
    const g = await seedGroup(['철수']);
    session.userId = g.members[0].userId;
    expect((await joinByInvite({ token: g.inviteToken, displayName: '철수' })).data).toEqual({
      groupId: g.gid,
      already: true,
    });
  });
});

describe('표시 이름 검증', () => {
  it('합류 이름은 앞뒤 공백을 잘라 저장한다', async () => {
    const g = await seedGroup();
    const u = await addMember(g.gid, '임시', 'member');
    await db.delete(memberships).where(eq(memberships.id, u.membershipId));
    session.userId = u.userId;
    expect((await joinByInvite({ token: g.inviteToken, displayName: '  철수 ' })).serverError).toBeUndefined();
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, g.gid), eq(memberships.userId, u.userId)));
    expect(m.displayName).toBe('철수');
  });

  it('공백만 있는 이름은 INVALID_NAME, 파기 표지는 RESERVED_NAME — 아무것도 저장되지 않는다', async () => {
    const g = await seedGroup();
    const u = await addMember(g.gid, '임시', 'member');
    await db.delete(memberships).where(eq(memberships.id, u.membershipId));
    session.userId = u.userId;

    expect((await joinByInvite({ token: g.inviteToken, displayName: '   ' })).serverError).toBe('INVALID_NAME');
    expect((await joinByInvite({ token: g.inviteToken, displayName: '탈퇴한 멤버' })).serverError).toBe(
      'RESERVED_NAME',
    );
    expect(
      await db.select().from(memberships).where(and(eq(memberships.groupId, g.gid), eq(memberships.userId, u.userId))),
    ).toHaveLength(0);
  });

  it('모임을 만들 때 총무 이름도 같은 규칙이다', async () => {
    const g = await seedGroup();
    session.userId = g.owner.userId;
    const before = await db.select().from(groups);
    expect((await createGroup({ name: '새모임', displayName: '탈퇴한멤버' })).serverError).toBe('RESERVED_NAME');
    expect((await createGroup({ name: '새모임', displayName: '  ' })).serverError).toBe('INVALID_NAME');
    expect(await db.select().from(groups)).toHaveLength(before.length);
  });

  it('재가입 이름도 같은 규칙이다', async () => {
    const g = await seedGroup(['철수']);
    const [chulsoo] = g.members;
    await markLeft(chulsoo, 'left');
    session.userId = chulsoo.userId;
    expect((await joinByInvite({ token: g.inviteToken, displayName: '탈퇴한 멤버' })).serverError).toBe(
      'RESERVED_NAME',
    );
    expect((await membershipState(chulsoo)).leftReason).toBe('left');
  });
});
