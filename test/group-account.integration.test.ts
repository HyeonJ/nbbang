import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groups, memberships, user } from '@/lib/db/schema';
import { newPublicToken, newToken } from '@/lib/domain/token';

/**
 * 입금 계좌 문구(F6)의 저장 규칙을 **실제 DB 왕복으로** 고정한다.
 *
 * 여기서 볼 것은 세 가지다:
 *  1) 인가 — 총무만 쓴다(멤버 FORBIDDEN / 비멤버 NOT_MEMBER). ADR-002.
 *  2) `null` vs `''` — 빈 칸과 공백만 입력한 칸은 **둘 다 `null`로 접힌다**.
 *     이것이 깨지면 "계좌가 있는가"가 두 개의 진실로 갈라지고, 안내 문구에 빈 `계좌:` 줄이 나간다.
 *  3) 길이 제한 — 60자 초과는 거부되고, **trim 후** 길이로 재는지.
 *
 * `settlement.integration.test.ts`와 같은 방식으로 **Next 경계만** 모킹한다 —
 * 인가 미들웨어·zod·DB는 전부 진짜다.
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

const { updateGroupAccount } = await import('@/actions/group');

async function addMember(gid: string, displayName: string, role: 'owner' | 'member') {
  const userId = crypto.randomUUID();
  await db
    .insert(user)
    .values({ id: userId, name: displayName, email: `${userId}@test.local`, emailVerified: false });
  await db
    .insert(memberships)
    .values({ id: crypto.randomUUID(), userId, groupId: gid, role, displayName });
  return userId;
}

async function seedGroup(label: string) {
  const gid = crypto.randomUUID();
  await db
    .insert(groups)
    .values({ id: gid, name: label, inviteToken: newToken(), publicToken: newPublicToken() });
  const ownerUserId = await addMember(gid, `${label}-총무`, 'owner');
  const memberUserId = await addMember(gid, `${label}-멤버`, 'member');
  return { gid, ownerUserId, memberUserId };
}

/** 저장된 원본 값 — `null`과 `''`를 구별해야 하므로 `?? ''` 같은 접기를 하지 않는다. */
async function storedLabel(gid: string): Promise<string | null> {
  const [row] = await db
    .select({ accountLabel: groups.accountLabel })
    .from(groups)
    .where(eq(groups.id, gid));
  return row.accountLabel;
}

beforeEach(() => {
  session.userId = null;
});

describe('updateGroupAccount — 계좌 문구 저장', () => {
  it('새 모임의 계좌는 null이다 — 컬럼 기본값이 빈 문자열이 아니다', async () => {
    const g = await seedGroup('A');
    expect(await storedLabel(g.gid)).toBeNull();
  });

  it('총무가 저장하면 그대로 남고, 앞뒤 공백은 잘린다', async () => {
    const g = await seedGroup('A');
    session.userId = g.ownerUserId;

    const res = await updateGroupAccount({
      groupId: g.gid,
      accountLabel: '  카카오뱅크 3333-01-1234567 민지  ',
    });
    expect(res.serverError).toBeUndefined();
    expect(res.data?.accountLabel).toBe('카카오뱅크 3333-01-1234567 민지');
    expect(await storedLabel(g.gid)).toBe('카카오뱅크 3333-01-1234567 민지');
  });

  it('빈 문자열은 null로 접힌다 — 계좌 없음의 표현이 하나여야 한다', async () => {
    const g = await seedGroup('A');
    session.userId = g.ownerUserId;
    await updateGroupAccount({ groupId: g.gid, accountLabel: '국민 123-456' });
    expect(await storedLabel(g.gid)).toBe('국민 123-456');

    const res = await updateGroupAccount({ groupId: g.gid, accountLabel: '' });
    expect(res.data?.accountLabel).toBeNull();
    // `''`가 저장됐다면 이 단언이 빨개진다 — 안내 문구의 `if (accountLabel)` 한 줄이 그것에 의존한다.
    expect(await storedLabel(g.gid)).toBeNull();
  });

  it('공백만 입력해도 null이다 — `계좌:   `는 계좌가 아니다', async () => {
    const g = await seedGroup('A');
    session.userId = g.ownerUserId;
    await updateGroupAccount({ groupId: g.gid, accountLabel: '국민 123-456' });
    await updateGroupAccount({ groupId: g.gid, accountLabel: '     ' });
    expect(await storedLabel(g.gid)).toBeNull();
  });

  it('60자 초과는 거부되고 아무것도 쓰이지 않는다', async () => {
    const g = await seedGroup('A');
    session.userId = g.ownerUserId;
    const res = await updateGroupAccount({ groupId: g.gid, accountLabel: '가'.repeat(61) });
    expect(res.validationErrors).toBeDefined();
    expect(await storedLabel(g.gid)).toBeNull();
  });

  it('60자 + 뒤 공백은 통과한다 — 길이는 trim 뒤에 잰다', async () => {
    const g = await seedGroup('A');
    session.userId = g.ownerUserId;
    const sixty = '가'.repeat(60);
    const res = await updateGroupAccount({ groupId: g.gid, accountLabel: `${sixty}   ` });
    expect(res.validationErrors).toBeUndefined();
    expect(await storedLabel(g.gid)).toBe(sixty);
  });

  it('멤버는 FORBIDDEN이고 계좌는 변하지 않는다 (ADR-002)', async () => {
    const g = await seedGroup('A');
    session.userId = g.ownerUserId;
    await updateGroupAccount({ groupId: g.gid, accountLabel: '국민 123-456' });

    session.userId = g.memberUserId;
    const res = await updateGroupAccount({ groupId: g.gid, accountLabel: '멤버가 바꾼 계좌' });
    expect(res.serverError).toBe('FORBIDDEN');
    expect(await storedLabel(g.gid)).toBe('국민 123-456');
  });

  it('남의 모임 총무는 NOT_MEMBER다 — 모임 경계를 넘을 수 없다', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    session.userId = b.ownerUserId;
    const res = await updateGroupAccount({ groupId: a.gid, accountLabel: 'B가 바꾼 A의 계좌' });
    expect(res.serverError).toBe('NOT_MEMBER');
    expect(await storedLabel(a.gid)).toBeNull();
  });

  it('미인증은 UNAUTHENTICATED다', async () => {
    const g = await seedGroup('A');
    const res = await updateGroupAccount({ groupId: g.gid, accountLabel: '아무거나' });
    expect(res.serverError).toBe('UNAUTHENTICATED');
    expect(await storedLabel(g.gid)).toBeNull();
  });
});
