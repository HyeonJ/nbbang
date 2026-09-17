import { describe, it, expect, vi, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import {
  ANONYMOUS_MEMBER_NAME,
  ANONYMOUS_USER_NAME,
  ERASED_IDENTIFIER_COLUMNS,
  ERASED_ROW_TABLES,
} from '@/lib/db/anonymize';
import {
  account,
  duesPayments,
  duesRounds,
  groups,
  ledgerEntries,
  memberships,
  session,
  settlementParticipants,
  settlementTransfers,
  settlements,
  user,
  verification,
} from '@/lib/db/schema';
import { newPublicToken, newToken } from '@/lib/domain/token';
import { requireTestDatabase } from './db-guard';

/**
 * 회원 탈퇴(Plan 04 Task 3)를 **실제 DB 왕복으로** 고정한다. ADR-004의 결정이 코드에서
 * 그대로 성립하는지가 이 스위트의 주제다.
 *
 * ── 이 파일만 `@/lib/auth`를 **모킹하지 않는다** ─────────────────────────────
 * 다른 통합 테스트는 세션을 `{ user: { id } }`로 흉내 낸다. 여기서는 그럴 수 없다 —
 * 이 태스크가 주장하는 것 중 셋이 **Better Auth 자체의 행동**이기 때문이다:
 *  · `account` 행(비밀번호 해시)이 정말 생겼다가 정말 사라지는가
 *  · 탈퇴 후 **같은 이메일로 재가입**이 되는가(이메일을 안 비우면 422로 막힌다 — 실측)
 *  · `deleted_at`이 찍힌 사용자의 **세션 쿠키가 더 이상 해석되지 않는가**
 * 모킹하면 셋 다 "내가 만든 가짜가 내가 기대한 값을 돌려줬다"가 된다. 그래서 진짜
 * `signUpEmail`으로 가입하고 진짜 `Set-Cookie`를 받아 진짜 `getSession`에 넣는다.
 * 모킹하는 것은 Next 경계(`next/headers`·`next/cache`)뿐이다.
 */

const reqHeaders = vi.hoisted(() => ({ value: new Headers() }));

vi.mock('next/headers', () => ({ headers: async () => reqHeaders.value }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { auth } = await import('@/lib/auth');
const { getActiveSession } = await import('@/lib/session');
const { deleteAccount } = await import('@/actions/account');
const { DELETE_ACCOUNT_CONFIRM } = await import('@/lib/domain/account');
const { createExpense } = await import('@/actions/ledger');

/** 메타데이터 조회 전용 핸들 — 가드를 지난 테스트 브랜치다. 여기서는 읽기만 한다. */
const sql = await requireTestDatabase('회원 탈퇴 통합 테스트');

type Actor = { userId: string; email: string; cookie: string };

/** 진짜 가입 — `user` + `account`(비밀번호 해시) + `session` 세 행이 여기서 생긴다. */
async function signUp(name: string, tag: string): Promise<Actor> {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const res = await auth.api.signUpEmail({
    body: { name, email, password: 'password123!' },
    asResponse: true,
  });
  expect(res.status, `가입 실패(${tag}): ${await res.clone().text()}`).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  expect(cookie, `세션 쿠키를 못 받았다(${tag})`).toBeTruthy();
  return { userId: body.user.id, email, cookie };
}

/** 이후의 액션·세션 조회가 이 사람으로 돈다. */
function as(actor: Actor | null) {
  reqHeaders.value = actor ? new Headers({ cookie: actor.cookie }) : new Headers();
}

type Fixture = {
  gid: string;
  owner: Actor;
  /** 탈퇴하는 사람. 표시 이름 '민지'. */
  leaver: Actor;
  /** **같은 표시 이름 '민지'** 를 가진 다른 사람 — 이름 매칭 구현을 빨갛게 만드는 픽스처. */
  twin: Actor;
  ownerMembershipId: string;
  leaverMembershipId: string;
  twinMembershipId: string;
  roundId: string;
  /** 탈퇴자가 **적은** 지출. `created_by`와 자유 텍스트 메모가 모두 탈퇴자를 가리킨다. */
  leaverEntryId: string;
  settlementId: string;
};

/**
 * 탈퇴가 건드리는 것과 건드리면 **안 되는** 것이 모두 들어 있는 모임 하나.
 *
 * 자유 텍스트 덫을 셋 심는다 — 원장 메모·입금 계좌 문구·정산 제목에 탈퇴자의 이름과 이메일이
 * 들어간다. ADR-004 결정 2(b)가 "자유 텍스트는 파기 대상이 아니다"라고 적었으므로, 그것들이
 * **그대로 남아 있음**을 단언해야 범위의 좁힘이 우연이 아니라 의도임이 테스트에 남는다.
 */
async function seed(): Promise<Fixture> {
  const owner = await signUp('영희', 'owner');
  const leaver = await signUp('민지', 'leaver');
  const twin = await signUp('민지', 'twin');

  const gid = crypto.randomUUID();
  await db.insert(groups).values({
    id: gid,
    name: '탈퇴모임',
    inviteToken: newToken(),
    publicToken: newPublicToken(),
    // 자유 텍스트 덫 ①
    accountLabel: `카카오뱅크 3333-01-1234567 민지`,
  });

  const mk = async (actor: Actor, role: 'owner' | 'member', displayName: string) => {
    const id = crypto.randomUUID();
    await db.insert(memberships).values({ id, userId: actor.userId, groupId: gid, role, displayName });
    return id;
  };
  const ownerMembershipId = await mk(owner, 'owner', '영희');
  // 두 사람이 **같은 표시 이름**이다. 이름으로 익명화하면 둘 다 바뀐다.
  const leaverMembershipId = await mk(leaver, 'member', '민지');
  const twinMembershipId = await mk(twin, 'member', '민지');

  const entry = async (
    type: 'DUES_PAYMENT' | 'EXPENSE',
    amount: number,
    createdBy: string,
    memo: string,
  ) => {
    const id = crypto.randomUUID();
    await db.insert(ledgerEntries).values({
      id,
      groupId: gid,
      type,
      amount,
      occurredAt: new Date('2026-02-01T03:00:00Z'),
      category: type === 'DUES_PAYMENT' ? '회비' : '식비',
      memo,
      createdBy,
    });
    return id;
  };
  const duesEntryId = await entry('DUES_PAYMENT', 20_000, owner.userId, '2026-02 민지');
  // 자유 텍스트 덫 ② — 메모에 탈퇴자의 이메일이 통째로 들어 있다.
  const leaverEntryId = await entry('EXPENSE', -30_000, leaver.userId, `민지(${leaver.email}) 결제`);

  const roundId = crypto.randomUUID();
  await db.insert(duesRounds).values({ id: roundId, groupId: gid, period: '2026-02', amountPerPerson: 20_000 });
  // 탈퇴자가 **낸** 회차. 멤버십 행을 지우면 이 체크가 사라져 과거 회차가 "미납"이 된다.
  await db.insert(duesPayments).values({
    id: crypto.randomUUID(),
    groupId: gid,
    roundId,
    membershipId: leaverMembershipId,
    ledgerEntryId: duesEntryId,
  });

  const settlementId = crypto.randomUUID();
  await db.insert(settlements).values({
    id: settlementId,
    groupId: gid,
    // 자유 텍스트 덫 ③
    title: '민지 환송회',
    total: 60_000,
    payerMembershipId: ownerMembershipId,
    occurredAt: new Date('2026-02-10T03:00:00Z'),
    createdBy: owner.userId,
  });
  await db.insert(settlementParticipants).values([
    { id: crypto.randomUUID(), groupId: gid, settlementId, membershipId: ownerMembershipId, displayNameAtTime: '영희', shareAmount: 20_000, isPayer: true },
    { id: crypto.randomUUID(), groupId: gid, settlementId, membershipId: leaverMembershipId, displayNameAtTime: '민지', shareAmount: 20_000, isPayer: false },
    { id: crypto.randomUUID(), groupId: gid, settlementId, membershipId: twinMembershipId, displayNameAtTime: '민지', shareAmount: 20_000, isPayer: false },
  ]);
  await db.insert(settlementTransfers).values([
    { id: crypto.randomUUID(), groupId: gid, settlementId, fromMembershipId: leaverMembershipId, toMembershipId: ownerMembershipId, amount: 20_000 },
    { id: crypto.randomUUID(), groupId: gid, settlementId, fromMembershipId: twinMembershipId, toMembershipId: ownerMembershipId, amount: 20_000 },
  ]);

  return {
    gid, owner, leaver, twin,
    ownerMembershipId, leaverMembershipId, twinMembershipId,
    roundId, leaverEntryId, settlementId,
  };
}

/** 탈퇴가 **건드리면 안 되는** 것 전부를 한 값으로 — 거부 케이스가 이것으로 불변을 단언한다. */
async function moneyState(gid: string) {
  const [row] = (await sql`
    select
      (select coalesce(sum(amount), 0)::int from ledger_entries where group_id = ${gid}) as balance,
      (select count(*)::int from ledger_entries where group_id = ${gid}) as entries,
      (select count(*)::int from dues_payments  where group_id = ${gid}) as payments,
      (select count(*)::int from memberships    where group_id = ${gid}) as members,
      (select count(*)::int from settlement_participants where group_id = ${gid}) as participants,
      (select coalesce(sum(share_amount), 0)::int from settlement_participants where group_id = ${gid}) as shares,
      (select count(*)::int from settlement_transfers where group_id = ${gid}) as transfers,
      (select coalesce(sum(amount), 0)::int from settlement_transfers where group_id = ${gid}) as transferred,
      (select string_agg(display_name, ',' order by id) from memberships where group_id = ${gid}) as member_names,
      (select string_agg(display_name_at_time, ',' order by id) from settlement_participants where group_id = ${gid}) as participant_names`) as Record<string, unknown>[];
  return row;
}

async function withdraw(actor: Actor, confirm: string = DELETE_ACCOUNT_CONFIRM) {
  as(actor);
  return deleteAccount({ confirm });
}

beforeEach(() => {
  as(null);
});

describe('회원 탈퇴 — 식별자 파기', () => {
  it('1. 멤버가 탈퇴하면 계정이 익명화되고 account·session·verification이 0행이 된다', async () => {
    const fx = await seed();

    // 파기 전에는 셋 다 실재한다 — 이 줄이 없으면 아래 0이 "원래 없던 것"과 구별되지 않는다.
    expect(await db.select().from(account).where(eq(account.userId, fx.leaver.userId))).toHaveLength(1);
    expect((await db.select().from(session).where(eq(session.userId, fx.leaver.userId))).length).toBeGreaterThan(0);
    // verification은 이 앱이 쓰지 않아 비어 있다 — **강제로 만들어** 삭제를 실제로 검사한다
    // (도달 불가라고 주장하는 상태는 강제로 만들어 증명한다).
    await db.insert(verification).values([
      { id: crypto.randomUUID(), identifier: fx.leaver.email, value: 'token-by-email', expiresAt: new Date(Date.now() + 60_000) },
      { id: crypto.randomUUID(), identifier: 'opaque-identifier', value: fx.leaver.userId, expiresAt: new Date(Date.now() + 60_000) },
      // 남의 행 — 탈퇴가 이것까지 쓸어가면 안 된다.
      { id: crypto.randomUUID(), identifier: fx.twin.email, value: fx.twin.userId, expiresAt: new Date(Date.now() + 60_000) },
    ]);

    const res = await withdraw(fx.leaver);
    expect(res?.serverError, `탈퇴가 거부됐다: ${res?.serverError}`).toBeUndefined();
    expect(res?.data).toEqual({ deleted: true });

    const [u] = await db.select().from(user).where(eq(user.id, fx.leaver.userId));
    expect(u, 'user 행이 사라졌다 — 탈퇴는 행 삭제가 아니다').toBeTruthy();
    expect(u.email).toMatch(/^deleted-[0-9a-f-]{36}@deleted\.invalid$/);
    expect(u.name).toBe(ANONYMOUS_USER_NAME);
    expect(u.image).toBeNull();
    expect(u.emailVerified).toBe(false);
    expect(u.deletedAt).toBeInstanceOf(Date);

    expect(await db.select().from(account).where(eq(account.userId, fx.leaver.userId))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, fx.leaver.userId))).toHaveLength(0);
    const v = await db.select().from(verification);
    expect(v.map((r) => r.identifier), '탈퇴자의 verification 행이 남았거나 남의 행이 지워졌다')
      .toEqual([fx.twin.email]);
  });

  it('2. 모임 잔액·원장 행 수가 변하지 않는다 — created_by도 그대로다 (ADR-001)', async () => {
    const fx = await seed();
    const before = await moneyState(fx.gid);

    expect((await withdraw(fx.leaver))?.serverError).toBeUndefined();

    const after = await moneyState(fx.gid);
    expect(after.balance, '잔액이 변했다').toBe(before.balance);
    expect(after.entries, '원장 행 수가 변했다').toBe(before.entries);
    expect(after.balance).toBe(-10_000);

    // **내부 UUID는 보존된다** — ADR-004 결정 2(a)가 정직하게 적은 한계가 여기 있다.
    // "누가 이 금액을 기록했는가"는 남고, 그래서 이것은 "연결 불가능한 익명화"가 아니다.
    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, fx.leaverEntryId));
    expect(entry.createdBy, '탈퇴로 created_by가 바뀌었다 — ADR-004는 보존한다고 적었다')
      .toBe(fx.leaver.userId);
  });

  it('3. 탈퇴자가 냈던 회차의 납부 체크가 그대로 남는다 — 멤버십 행을 지우지 않기 때문', async () => {
    const fx = await seed();
    expect((await withdraw(fx.leaver))?.serverError).toBeUndefined();

    // 멤버십 행이 남아 있어야 납부 기록이 가리킬 곳이 있다. 지웠다면 이 회차는
    // 탈퇴자에게 "미납"으로 보인다 — 없던 사실이 생긴다.
    const [m] = await db.select().from(memberships).where(eq(memberships.id, fx.leaverMembershipId));
    expect(m, '멤버십 행이 사라졌다 — 납부 체크가 함께 사라진다').toBeTruthy();
    expect(m.displayName).toBe(ANONYMOUS_MEMBER_NAME);
    expect(m.role, '역할이 바뀌었다').toBe('member');

    const paid = await db
      .select()
      .from(duesPayments)
      .where(and(eq(duesPayments.roundId, fx.roundId), eq(duesPayments.membershipId, fx.leaverMembershipId)));
    expect(paid, '탈퇴로 과거 납부 기록이 사라졌다 — 낸 사람이 안 낸 사람이 됐다').toHaveLength(1);
  });

  it('4. 정산은 금액·인원·이체 구조가 불변이고 **탈퇴자 행의 이름만** 바뀐다 — 동명이인은 그대로', async () => {
    const fx = await seed();
    const before = await moneyState(fx.gid);

    expect((await withdraw(fx.leaver))?.serverError).toBeUndefined();

    const after = await moneyState(fx.gid);
    for (const key of ['participants', 'shares', 'transfers', 'transferred'] as const) {
      expect(after[key], `정산의 ${key}가 변했다 — 파기는 금액·구조를 건드리지 않는다`).toBe(before[key]);
    }

    const parts = await db
      .select()
      .from(settlementParticipants)
      .where(eq(settlementParticipants.settlementId, fx.settlementId));
    const byMembership = new Map(parts.map((p) => [p.membershipId, p]));
    expect(byMembership.get(fx.leaverMembershipId)!.displayNameAtTime).toBe(ANONYMOUS_MEMBER_NAME);
    // **여기가 `membershipId` 키잉의 증거다.** 두 사람의 표시 이름이 똑같이 '민지'였으므로,
    // 이름 문자열로 찾는 구현이면 이 줄이 '탈퇴한 멤버'가 되어 빨개진다.
    expect(
      byMembership.get(fx.twinMembershipId)!.displayNameAtTime,
      '동명이인의 정산 스냅샷까지 익명화됐다 — 이름 문자열로 찾고 있다',
    ).toBe('민지');
    expect(byMembership.get(fx.ownerMembershipId)!.displayNameAtTime).toBe('영희');
    // 멤버십 쪽도 같다 — 동명이인의 표시 이름은 살아 있어야 한다.
    const [twinM] = await db.select().from(memberships).where(eq(memberships.id, fx.twinMembershipId));
    expect(twinM.displayName, '동명이인의 멤버십 이름까지 익명화됐다').toBe('민지');
    // 부담액·선결제자 지목은 한 글자도 바뀌지 않는다.
    expect(parts.map((p) => p.shareAmount).sort()).toEqual([20_000, 20_000, 20_000]);
    expect(parts.filter((p) => p.isPayer).map((p) => p.membershipId)).toEqual([fx.ownerMembershipId]);
  });

  it('5. **구조화된 식별자 컬럼**에 원래 이메일·표시명이 남지 않는다 — 자유 텍스트(원장 메모·계좌 문구·정산 제목)는 파기 범위가 아니다', async () => {
    const fx = await seed();
    const { email } = fx.leaver;

    expect((await withdraw(fx.leaver))?.serverError).toBeUndefined();

    // ── 파기되는 쪽: ERASED_IDENTIFIER_COLUMNS + ERASED_ROW_TABLES ────────────
    for (const [table, column] of ERASED_IDENTIFIER_COLUMNS) {
      const [{ hits }] = (await sql.query(
        `select count(*)::int as hits from "${table}"
          where ${column} is not null and position($1 in ${column}) > 0`,
        [email],
      )) as { hits: number }[];
      expect(hits, `${table}.${column}에 탈퇴자의 이메일이 남아 있다`).toBe(0);
    }
    // 표시명은 동명이인이 들고 있으므로 "어디에도 없다"가 아니라 **탈퇴자의 행에 없다**가 주장이다.
    const [m] = await db.select().from(memberships).where(eq(memberships.id, fx.leaverMembershipId));
    expect(m.displayName).toBe(ANONYMOUS_MEMBER_NAME);
    const [u] = await db.select().from(user).where(eq(user.id, fx.leaver.userId));
    expect(u.name).toBe(ANONYMOUS_USER_NAME);
    expect(u.email).not.toBe(email);
    for (const table of ERASED_ROW_TABLES) {
      const [{ hits }] = (await sql.query(
        `select count(*)::int as hits from "${table}" where ${
          table === 'verification' ? 'value' : 'user_id'
        } = $1`,
        [fx.leaver.userId],
      )) as { hits: number }[];
      expect(hits, `${table}에 탈퇴자의 행이 남아 있다`).toBe(0);
    }

    // ── 파기되지 **않는** 쪽: 자유 텍스트 (ADR-004 결정 2b) ───────────────────
    // 이 세 단언이 있어야 위의 주장이 "DB 어디에도 없다"로 잘못 읽히지 않는다.
    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, fx.leaverEntryId));
    expect(entry.memo, '원장 메모가 파기됐다 — 자유 텍스트는 범위 밖이라고 ADR에 적었다').toContain(email);
    const [g] = await db.select().from(groups).where(eq(groups.id, fx.gid));
    expect(g.accountLabel).toContain('민지');
    const [s] = await db.select().from(settlements).where(eq(settlements.id, fx.settlementId));
    expect(s.title).toBe('민지 환송회');
  });

  /**
   * 파기 목록이 스키마와 어긋나지 않는가 — `group-delete`의 FK 폐포 대조와 같은 계열이다.
   *
   * 여기에는 FK 같은 구조적 오라클이 없으므로(무엇이 "식별자"인지는 판단이다) 분류를
   * **전수로** 강제한다: 탈퇴가 다루는 여섯 테이블의 텍스트 컬럼 하나하나가
   * ① 행째 삭제되거나 ② 값이 덮어써지거나 ③ **"식별자가 아니다"로 명시 분류**돼야 한다.
   * 컬럼이 추가되면 셋 중 어디에도 없으므로 이 테스트가 **먼저** 빨개진다 —
   * 새 식별자가 조용히 파기 밖에 남기 전에.
   */
  it('5b. 탈퇴가 다루는 여섯 테이블의 텍스트 컬럼이 전부 분류돼 있다 (파기 목록 대조)', async () => {
    /** 식별자가 아니라서 **일부러 남기는** 컬럼 + 이유. */
    const KEPT: Record<string, string> = {
      'user.id': '내부 UUID — FK 셋이 참조한다. 보존이 ADR-004 결정 2(a)의 명시된 한계다',
      'memberships.id': '멤버십 식별자 — dues_payments·정산 3종이 이 값으로 매달려 있다',
      'memberships.user_id': 'user.id와 같은 값. 지우면 FK가 깨진다(notNull)',
      'memberships.group_id': '어느 모임인지 — 사람의 식별자가 아니다',
      'memberships.role': "'owner' | 'member' — 사람의 식별자가 아니다",
      'settlement_participants.id': '스냅샷 행 식별자',
      'settlement_participants.group_id': '어느 모임인지',
      'settlement_participants.settlement_id': '어느 정산인지',
      'settlement_participants.membership_id': '익명화의 **키**다 — 이것을 지우면 찾을 수 없다',
    };

    const TABLES = [...ERASED_ROW_TABLES, 'user', 'memberships', 'settlement_participants'];
    const columns = (await sql.query(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1)
          and data_type in ('text', 'character varying')
        order by table_name, column_name`,
      [TABLES],
    )) as { table_name: string; column_name: string }[];
    expect(columns.length, '텍스트 컬럼을 하나도 못 찾았다 — 대조가 헛돌고 있다').toBeGreaterThan(0);

    const overwritten = new Set(ERASED_IDENTIFIER_COLUMNS.map(([t, c]) => `${t}.${c}`));
    const rowDeleted = new Set(ERASED_ROW_TABLES);
    const unclassified = columns
      .map((c) => `${c.table_name}.${c.column_name}`)
      .filter(
        (key) =>
          !rowDeleted.has(key.split('.')[0]) && !overwritten.has(key) && !(key in KEPT),
      );
    expect(
      unclassified,
      '분류되지 않은 텍스트 컬럼이 있다 — lib/db/anonymize.ts의 목록에 넣거나 이 테스트의 KEPT에 이유와 함께 적어라',
    ).toEqual([]);
  });

  it('6. 총무는 탈퇴할 수 없다 — OWNS_GROUPS이고 아무것도 바뀌지 않는다', async () => {
    const fx = await seed();
    const before = await moneyState(fx.gid);

    const res = await withdraw(fx.owner);
    expect(res?.serverError).toBe('OWNS_GROUPS');

    // 트랜잭션이 통째로 롤백된다 — "이름만 먼저 익명화된" 중간 상태가 남지 않는다.
    expect(await moneyState(fx.gid)).toEqual(before);
    const [u] = await db.select().from(user).where(eq(user.id, fx.owner.userId));
    expect(u.email).toBe(fx.owner.email);
    expect(u.name).toBe('영희');
    expect(u.deletedAt).toBeNull();
    expect(await db.select().from(account).where(eq(account.userId, fx.owner.userId))).toHaveLength(1);

    // 확인 문구가 틀려도 같다 — 화면의 타이핑 확인은 연출이고 판정은 서버가 한다(ADR-002).
    expect((await withdraw(fx.leaver, '탈퇴할게요'))?.serverError).toBe('CONFIRM_MISMATCH');
    expect(await moneyState(fx.gid)).toEqual(before);
    // 반대쪽 경계: 앞뒤 공백만 다른 입력은 **통과한다**(양쪽 trim).
    expect((await withdraw(fx.leaver, `  ${DELETE_ACCOUNT_CONFIRM}  `))?.serverError).toBeUndefined();
  });

  it('7. 탈퇴한 이메일로 다시 가입할 수 있다 — 단 새 user.id를 받는 다른 사람이다', async () => {
    const fx = await seed();
    const { email } = fx.leaver;
    expect((await withdraw(fx.leaver))?.serverError).toBeUndefined();

    const res = await auth.api.signUpEmail({
      body: { name: '민지', email, password: 'password123!' },
      asResponse: true,
    });
    // 이메일을 비우지 않았다면 여기서 422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL이 온다(실측).
    expect(res.status, `재가입이 막혔다: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id, '재가입이 같은 계정을 되살렸다 — 탈퇴는 되돌릴 수 없어야 한다')
      .not.toBe(fx.leaver.userId);

    // 옛 멤버십은 돌아오지 않는다 — 재가입자는 그 모임의 멤버가 아니다.
    expect(await db.select().from(memberships).where(eq(memberships.userId, body.user.id))).toHaveLength(0);
    const [old] = await db.select().from(memberships).where(eq(memberships.id, fx.leaverMembershipId));
    expect(old.displayName).toBe(ANONYMOUS_MEMBER_NAME);
  });

  it('8. 탈퇴하면 기존 세션 쿠키가 더 이상 해석되지 않는다 — 세션 행을 지워도, 안 지워도', async () => {
    const fx = await seed();
    const cookie = fx.leaver.cookie;

    as(fx.leaver);
    expect((await getActiveSession())?.user.id, '준비 실패 — 탈퇴 전에 세션이 안 읽힌다')
      .toBe(fx.leaver.userId);

    expect((await withdraw(fx.leaver))?.serverError).toBeUndefined();
    reqHeaders.value = new Headers({ cookie });
    expect(await getActiveSession(), '탈퇴 후에도 옛 쿠키로 세션이 잡힌다').toBeNull();

    /**
     * **두 번째 방어선을 강제로 시험한다.** 위의 null은 `session` 행이 지워졌기 때문일 수도
     * 있다 — 그러면 `deleted_at` 검사는 한 번도 실행되지 않은 채 초록이다(공허한 초록).
     * 그래서 세션 행이 **살아 있는** 탈퇴자를 손으로 만들어 본다. Better Auth는 이 상태의
     * 세션을 그대로 돌려주므로(실측), 여기서 null이 나오면 그것은 `lib/session.ts`가 한 일이다.
     */
    const ghost = await signUp('유령', 'ghost');
    await db.update(user).set({ deletedAt: new Date() }).where(eq(user.id, ghost.userId));
    reqHeaders.value = new Headers({ cookie: ghost.cookie });
    expect(
      (await auth.api.getSession({ headers: reqHeaders.value }))?.user.id,
      'Better Auth가 스스로 막고 있다 — 그렇다면 이 검사는 아무것도 지키지 않는다',
    ).toBe(ghost.userId);
    expect(await getActiveSession(), 'deleted_at이 찍혔는데 세션이 해석됐다').toBeNull();
  });
});

/**
 * 잠금을 기다리고 있는 백엔드의 쿼리를 찾아 돌려준다. 없으면 `null`.
 *
 * 동시성 단언을 **시계가 아니라 DB 상태**로 한다(`group-delete`가 같은 함정에 한 번 빠졌다 —
 * 시간 기반 단언은 `for update`를 떼어내도 초록이었다). `pg_stat_activity`의
 * `wait_event_type = 'Lock'`이 "느리다"와 "잠겨서 못 간다"를 구별해 준다.
 */
async function waitForLockWait(timeoutMs = 20_000): Promise<{ query: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await sql.query(`
      select query
        from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query not like '%pg_stat_activity%'
    `)) as { query: string }[];
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

/**
 * **탈퇴와 쓰기가 겹칠 때** (외부 리뷰 IMPORTANT 12).
 *
 * 두 방향을 따로 본다. 한쪽만 보면 반대쪽이 열린 채로 초록이 된다.
 */
describe('회원 탈퇴 — 동시성', () => {
  it('9a. 탈퇴는 진행 중인 쓰기를 기다린다 — 첫 문장(for update)에서 멈춘다', async () => {
    const fx = await seed();

    const client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('begin');
      // 쓰기 액션이 자기 트랜잭션에서 하는 것과 **같은 문장**이다(`assertActiveUser`).
      await client.query('select deleted_at from "user" where id = $1 for key share', [fx.leaver.userId]);

      as(fx.leaver);
      pending = deleteAccount({ confirm: DELETE_ACCOUNT_CONFIRM });

      const blocked = await waitForLockWait();
      expect(blocked, '잠금을 기다리는 쿼리가 없다 — 탈퇴가 진행 중인 쓰기를 그냥 지나쳤다').not.toBeNull();
      // 대기 지점이 **첫 문장**이어야 한다. 뒤쪽(update)에서 기다린다면 이미 무언가를 읽고
      // 판단한 뒤라는 뜻이고, 그 판단은 낡은 스냅샷 위에서 이뤄진 것이다.
      expect(blocked!.query.toLowerCase(), `대기 지점이 첫 잠금이 아니다: ${blocked!.query}`)
        .toContain('for update');
      expect(blocked!.query.toLowerCase()).toContain('"user"');

      await client.query('commit');
      const res = (await pending) as { serverError?: string } | undefined;
      expect(res?.serverError, `잠금 뒤 탈퇴가 실패했다: ${res?.serverError}`).toBeUndefined();
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
      await pending?.catch(() => {});
    }

    const [u] = await db.select().from(user).where(eq(user.id, fx.leaver.userId));
    expect(u.deletedAt).toBeInstanceOf(Date);
  });

  it('9b. 탈퇴가 진행 중이면 원장 생성은 기다렸다가 ACCOUNT_DELETED로 거절된다 — 새 엔트리가 생기지 않는다', async () => {
    const fx = await seed();
    const before = await moneyState(fx.gid);

    /**
     * 탈퇴 쪽을 **손으로** 연출한다. 진짜 `deleteAccount`는 열어 둔 채로 붙잡을 수 없고
     * (커밋하면 트랜잭션이 끝난다), 여기서 보려는 것은 탈퇴의 자격 검사가 아니라 **쓰기 쪽의
     * 재확인**이기 때문이다. 손으로 여는 두 문장은 `deleteAccount`의 첫 두 문장과 같고,
     * 그 액션이 정말 그렇게 시작한다는 것은 9a가 DB에게 물어 확인한다.
     *
     * 그래서 여기서는 총무(영희)를 탈퇴 대상으로 써도 된다 — 자격(OWNS_GROUPS)은 이 테스트의
     * 주제가 아니고, 덕분에 `createExpense`(총무 전용)를 그대로 쓸 수 있다.
     */
    const client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('begin');
      await client.query('select email from "user" where id = $1 for update', [fx.owner.userId]);
      await client.query('update "user" set deleted_at = now() where id = $1', [fx.owner.userId]);

      as(fx.owner);
      // 이 시점에 세션 검사는 **통과한다** — 탈퇴가 아직 커밋되지 않아 `deleted_at`이
      // 이 트랜잭션 밖에서는 보이지 않는다(READ COMMITTED). 그래서 인가 계층만으로는
      // 부족하고, 트랜잭션 안의 재확인이 필요하다. 그 창이 바로 이 줄이다.
      expect((await getActiveSession())?.user.id, '세션 검사가 먼저 막았다 — 이 테스트가 헛돈다')
        .toBe(fx.owner.userId);

      pending = createExpense({ groupId: fx.gid, amount: 50_000, occurredOn: '2026-03-01' });

      const blocked = await waitForLockWait();
      expect(blocked, '잠금을 기다리는 쿼리가 없다 — 쓰기가 탈퇴를 그냥 지나쳤다').not.toBeNull();
      expect(blocked!.query.toLowerCase(), `대기 지점이 탈퇴 확인이 아니다: ${blocked!.query}`)
        .toContain('for key share');

      await client.query('commit');
      const res = (await pending) as { serverError?: string } | undefined;
      expect(res?.serverError, '탈퇴한 사용자로 원장이 쓰였다').toBe('ACCOUNT_DELETED');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
      await pending?.catch(() => {});
    }

    // 트랜잭션이 통째로 롤백됐다 — 엔트리도, 잔액도 그대로다.
    expect(await moneyState(fx.gid), '거절됐는데 원장이 늘었다').toEqual(before);
    expect(
      await db.select().from(ledgerEntries).where(
        and(eq(ledgerEntries.groupId, fx.gid), eq(ledgerEntries.amount, -50_000)),
      ),
    ).toHaveLength(0);
  });
});
