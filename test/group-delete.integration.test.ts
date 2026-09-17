import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { db, pool } from '@/lib/db';
import { GROUP_CHILD_DELETE_ORDER, GROUP_DELETE_TABLES } from '@/lib/db/delete';
import { getPublicLedger } from '@/lib/db/public-queries';
import {
  duesPayments,
  duesRounds,
  groups,
  ledgerEntries,
  memberships,
  settlementParticipants,
  settlementTransfers,
  settlements,
  user,
} from '@/lib/db/schema';
import { newPublicToken, newToken } from '@/lib/domain/token';
import { requireTestDatabase } from './db-guard';

/**
 * 모임 완전 삭제(Plan 04 Task 2)를 **실제 DB 왕복으로** 고정한다.
 *
 * 이 스위트가 답하는 질문은 넷이다:
 *  1. 지워야 할 것이 전부 지워지는가 — 그리고 **지우지 말아야 할 것은 그대로인가**(모임 B).
 *  2. 서버가 이름·역할을 **자기가** 다시 확인하는가(화면의 타이핑 확인은 연출이다, ADR-002).
 *  3. `groups` 행 잠금이 동시 쓰기와의 경쟁에서 삭제를 이기게 하는가(외부 리뷰 BLOCKER 3).
 *  4. **파괴 목록이 스키마와 어긋나지 않는가** — 손으로 적은 "12개 테이블"은 낡는다
 *     (외부 리뷰 IMPORTANT 10). FK 메타데이터에서 전이 폐포를 계산해 대조한다.
 *
 * ⚠️ 액션을 부르려면 요청 컨텍스트가 필요하다 — `settlement.integration.test.ts`와 같은
 * 방식으로 **Next 경계만** 모킹한다. 인가 미들웨어·zod·트랜잭션·DB는 전부 진짜다.
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

const { deleteGroup } = await import('@/actions/group');

/** 메타데이터 조회 전용 핸들 — 가드를 지난 테스트 브랜치다. 여기서는 읽기만 한다. */
const sql = await requireTestDatabase('모임 삭제 통합 테스트');

type Fixture = {
  gid: string;
  name: string;
  publicToken: string;
  ownerUserId: string;
  ownerMembershipId: string;
  memberUserId: string;
  /** 역분개 **대상**이 된 지출 — 자기참조 FK의 부모 쪽. */
  reversedEntryId: string;
  /** 그 역분개 엔트리 — 자기참조 FK의 자식 쪽. */
  reversalEntryId: string;
};

/**
 * 삭제 대상 7개 테이블 **전부**에 행이 있는 모임 하나.
 *
 * 한 테이블이라도 비어 있으면 "그 테이블을 안 지워도 통과하는" 테스트가 된다 —
 * 아래 `seedCounts`가 그 공백을 막는다(0이 하나라도 있으면 픽스처 자체가 깨진다).
 */
async function seedGroup(name: string): Promise<Fixture> {
  const gid = crypto.randomUUID();
  const publicToken = newPublicToken();
  await db
    .insert(groups)
    .values({ id: gid, name, inviteToken: newToken(), publicToken, accountLabel: '테스트은행 1-2-3' });

  const mk = async (label: string, role: 'owner' | 'member') => {
    const userId = crypto.randomUUID();
    await db
      .insert(user)
      .values({ id: userId, name: label, email: `${userId}@test.local`, emailVerified: false });
    const membershipId = crypto.randomUUID();
    await db
      .insert(memberships)
      .values({ id: membershipId, userId, groupId: gid, role, displayName: label });
    return { userId, membershipId };
  };
  const owner = await mk(`${name}-총무`, 'owner');
  const member = await mk(`${name}-멤버`, 'member');

  // 원장 3줄: 회비 납부(납부 기록이 가리킨다) · 지출 · 그 지출의 역분개(자기참조 FK).
  const entry = async (
    type: 'DUES_PAYMENT' | 'EXPENSE' | 'REVERSAL',
    amount: number,
    reversalOf: string | null = null,
  ) => {
    const id = crypto.randomUUID();
    await db.insert(ledgerEntries).values({
      id,
      groupId: gid,
      type,
      amount,
      occurredAt: new Date('2026-02-01T00:00:00Z'),
      createdBy: owner.userId,
      reversalOf,
    });
    return id;
  };
  const duesEntryId = await entry('DUES_PAYMENT', 20_000);
  const reversedEntryId = await entry('EXPENSE', -96_000);
  const reversalEntryId = await entry('REVERSAL', 96_000, reversedEntryId);

  const roundId = crypto.randomUUID();
  await db
    .insert(duesRounds)
    .values({ id: roundId, groupId: gid, period: '2026-02', amountPerPerson: 20_000 });
  await db.insert(duesPayments).values({
    id: crypto.randomUUID(),
    groupId: gid,
    roundId,
    membershipId: owner.membershipId,
    ledgerEntryId: duesEntryId,
  });

  const settlementId = crypto.randomUUID();
  await db.insert(settlements).values({
    id: settlementId,
    groupId: gid,
    title: `${name} 회식`,
    total: 60_000,
    payerMembershipId: owner.membershipId,
    occurredAt: new Date('2026-02-10T00:00:00Z'),
    createdBy: owner.userId,
  });
  await db.insert(settlementParticipants).values([
    {
      id: crypto.randomUUID(),
      groupId: gid,
      settlementId,
      membershipId: owner.membershipId,
      displayNameAtTime: `${name}-총무`,
      shareAmount: 30_000,
      isPayer: true,
    },
    {
      id: crypto.randomUUID(),
      groupId: gid,
      settlementId,
      membershipId: member.membershipId,
      displayNameAtTime: `${name}-멤버`,
      shareAmount: 30_000,
      isPayer: false,
    },
  ]);
  await db.insert(settlementTransfers).values({
    id: crypto.randomUUID(),
    groupId: gid,
    settlementId,
    fromMembershipId: member.membershipId,
    toMembershipId: owner.membershipId,
    amount: 30_000,
  });

  return {
    gid,
    name,
    publicToken,
    ownerUserId: owner.userId,
    ownerMembershipId: owner.membershipId,
    memberUserId: member.userId,
    reversedEntryId,
    reversalEntryId,
  };
}

/**
 * 모임에 매달린 행 수를 테이블별로 센다 — **목록에서 파생**한다.
 * 손으로 테이블 이름을 적으면 목록이 늘어날 때 이 계수가 따라오지 않아
 * "새 테이블의 행이 남았다"를 못 본다.
 */
async function rowCounts(gid: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of GROUP_CHILD_DELETE_ORDER) {
    const rows = await db.select().from(table).where(eq(table.groupId, gid));
    out[getTableConfig(table).name] = rows.length;
  }
  out.groups = (await db.select().from(groups).where(eq(groups.id, gid))).length;
  return out;
}

/** 픽스처가 정말 모든 테이블을 덮었는지 — 0이 하나라도 있으면 테스트가 헛돈다. */
async function seedCounts(gid: string): Promise<Record<string, number>> {
  const counts = await rowCounts(gid);
  for (const [table, n] of Object.entries(counts)) {
    expect(n, `픽스처가 ${table}에 행을 만들지 않았다 — 그 테이블의 삭제는 검사되지 않는다`)
      .toBeGreaterThan(0);
  }
  return counts;
}

const ALL_ZERO = Object.fromEntries(GROUP_DELETE_TABLES.map((t) => [t, 0]));

/**
 * 잠금을 기다리고 있는 백엔드의 쿼리를 찾아 돌려준다. 없으면 `null`.
 *
 * 동시성 단언을 **시계가 아니라 DB 상태**로 하기 위한 장치다. `pg_stat_activity`는 잠금 대기를
 * `wait_event_type = 'Lock'`으로 노출하므로, "느려서 안 끝났다"와 "잠겨서 못 간다"가 구별된다.
 * 자기 자신과 통계 조회는 제외한다 — 안 그러면 이 함수가 자기를 보고 참을 돌려줄 수 있다.
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

beforeEach(() => {
  session.userId = null;
});

describe('모임 완전 삭제', () => {
  it('총무가 지우면 그 모임 소유 행이 전부 0이 된다', async () => {
    const a = await seedGroup('지울모임');
    await seedCounts(a.gid);

    session.userId = a.ownerUserId;
    const res = await deleteGroup({ groupId: a.gid, name: a.name });
    expect(res?.serverError, `삭제가 거부됐다: ${res?.serverError}`).toBeUndefined();
    expect(res?.data).toEqual({ deleted: true });

    expect(await rowCounts(a.gid)).toEqual(ALL_ZERO);
  });

  /**
   * **고전적 삭제 버그를 잡는 자리.** 위 테스트는 "너무 적게 지운다"만 본다 —
   * `delete from ledger_entries`처럼 where 절을 빠뜨린 구현도 그 테스트는 통과한다.
   */
  it('다른 모임 B의 행 수는 하나도 변하지 않는다', async () => {
    const a = await seedGroup('A모임');
    const b = await seedGroup('B모임');
    const before = await seedCounts(b.gid);

    session.userId = a.ownerUserId;
    expect((await deleteGroup({ groupId: a.gid, name: a.name }))?.serverError).toBeUndefined();

    expect(await rowCounts(a.gid)).toEqual(ALL_ZERO);
    expect(await rowCounts(b.gid), 'A를 지웠는데 B의 행이 사라졌다').toEqual(before);
    // 계수뿐 아니라 B의 장부 내용 자체가 그대로여야 한다.
    const ledger = await getPublicLedger(b.publicToken);
    expect(ledger?.groupName).toBe('B모임');
    expect(ledger?.entries).toHaveLength(3);
  });

  it('이름이 틀리면 NAME_MISMATCH이고 아무 행도 삭제되지 않는다', async () => {
    const a = await seedGroup('지울모임');
    const before = await seedCounts(a.gid);

    session.userId = a.ownerUserId;
    const res = await deleteGroup({ groupId: a.gid, name: '지울모임2' });
    expect(res?.serverError).toBe('NAME_MISMATCH');
    // 트랜잭션이 통째로 롤백된다 — "앞의 세 테이블만 지워진" 중간 상태가 남지 않는다.
    expect(await rowCounts(a.gid)).toEqual(before);

    // 반대쪽 경계: 앞뒤 공백만 다른 입력은 **통과한다**(양쪽 trim). 보이지 않는 글자 때문에
    // 지울 수 없는 모임이 생기지 않는다는 뜻이고, "이름을 알아야 한다"는 성질은 그대로다.
    expect((await deleteGroup({ groupId: a.gid, name: '  지울모임  ' }))?.serverError).toBeUndefined();
    expect(await rowCounts(a.gid)).toEqual(ALL_ZERO);
  });

  it('총무가 아닌 멤버가 부르면 FORBIDDEN이고 행이 불변이다', async () => {
    const a = await seedGroup('지울모임');
    const before = await seedCounts(a.gid);

    session.userId = a.memberUserId;
    const res = await deleteGroup({ groupId: a.gid, name: a.name });
    expect(res?.serverError).toBe('FORBIDDEN');
    expect(await rowCounts(a.gid)).toEqual(before);
  });

  /**
   * 자기참조 FK(`ledger_entries_reversal_fk`)는 **한 문장으로 부모·자식을 함께 지우면 통과한다**
   * — `NO ACTION`은 문장 **종료 시** 검사하기 때문이다.
   *
   * 이 성질을 따로 못 박는 이유: 다음 사람이 그 FK를 `RESTRICT`(= 즉시 검사)로 바꾸면
   * 삭제가 23503으로 깨지는데, 그 변경은 스키마 파일에서 한 단어짜리라 리뷰에서 눈에 띄지 않는다.
   * 여기서 **한 문장 삭제라는 사실 자체**를 확인한다 — 목록을 거치지 않고 직접 실행해서,
   * 깨졌을 때 원인이 액션이 아니라 제약에 있음이 드러나게 한다.
   */
  it('역분개가 달린 원장이 한 문장 삭제로 통과한다 (NO ACTION은 문장 종료 시 검사)', async () => {
    const a = await seedGroup('역분개모임');
    // 원장을 참조하는 납부 기록만 먼저 치운다 — 이 테스트가 보려는 것은 원장의 자기참조뿐이다.
    await db.delete(duesPayments).where(eq(duesPayments.groupId, a.gid));

    const rows = await db
      .delete(ledgerEntries)
      .where(eq(ledgerEntries.groupId, a.gid))
      .returning({ id: ledgerEntries.id });
    const ids = rows.map((r) => r.id);
    expect(ids).toHaveLength(3);
    // 부모(정정 대상)와 자식(정정 엔트리)이 **같은 문장**에서 함께 사라졌다.
    expect(ids).toContain(a.reversedEntryId);
    expect(ids).toContain(a.reversalEntryId);
  });

  it('삭제 후 공개 토큰으로 조회하면 null이다 — 링크가 즉시 죽는다', async () => {
    const a = await seedGroup('공개모임');
    expect((await getPublicLedger(a.publicToken))?.groupName).toBe('공개모임');

    session.userId = a.ownerUserId;
    expect((await deleteGroup({ groupId: a.gid, name: a.name }))?.serverError).toBeUndefined();

    // `/g/:token` 페이지는 이 null을 받아 notFound()로 떨어진다 → 404.
    expect(await getPublicLedger(a.publicToken)).toBeNull();
  });

  /**
   * **행 잠금이 실제로 일을 한다**(외부 리뷰 BLOCKER 3).
   *
   * 시나리오: 다른 세션이 같은 모임에 원장을 넣고 **아직 커밋하지 않은** 상태에서 삭제가 들어온다.
   * 자식 insert는 부모 행(`groups`)에 `FOR KEY SHARE`를 걸고, `for update`는 그것과 충돌하므로
   * 삭제는 **첫 문장에서** 멈춘다. 경쟁 세션이 끝나면 그제야 시작해 **방금 들어온 행까지** 쓸어간다.
   *
   * ── 왜 시간으로 재지 않는가 (이 단언은 한 번 헛돌았다) ────────────────────────
   * 처음에는 "700ms 안에 안 끝나면 잠긴 것"으로 적었다. 그 단언은 `for update`를 **떼어내도
   * 초록이었다** — Neon 왕복 10번이면 삭제 한 번이 원래 1초를 넘기므로 "잠겼다"와 "느리다"가
   * 구별되지 않았고, 700ms 뒤 커밋하면 경쟁 행이 **삭제 루프가 원장에 닿기 전에** 보이게 되어
   * 잠금 없이도 결과까지 같아졌다. 시간은 증거가 아니다.
   *
   * 그래서 DB에게 직접 묻는다: **지금 잠금을 기다리는 쿼리가 무엇인가.** 잠금이 있으면
   * `select … for update`가 기다리고, 없으면 (자식들을 다 지운 뒤) `delete from groups`가
   * 기다린다. 대기 지점이 곧 판정이다 — 이 차이는 시계와 무관하다.
   */
  it('동시 쓰기와 겹치면 삭제는 첫 잠금에서 기다린다 — 그리고 그 행까지 지운다', async () => {
    const a = await seedGroup('경쟁모임');
    const racingEntryId = crypto.randomUUID();

    const client = await pool.connect();
    // 이 테스트가 **실패로** 빠져나갈 때가 위험하다: 경쟁 트랜잭션을 열어 둔 채 커넥션을 풀에
    // 돌려주면 그것이 잠금을 쥔 채 남아 다음 테스트의 TRUNCATE와 조회를 막는다(실제로 겪었다 —
    // 잠금 변이 실험에서 이 테스트가 깨지자 뒤따르는 메타데이터 테스트가 함께 죽었다).
    // 그래서 정리는 `finally`에서 **롤백 → 반납 → 매달린 삭제 회수** 순서로 한다.
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('begin');
      // 이 insert가 groups 행에 FOR KEY SHARE를 건다(FK 검사). 커밋하지 않는다.
      await client.query(
        `insert into ledger_entries (id, group_id, type, amount, occurred_at, created_by)
         values ($1, $2, 'EXPENSE', $3, now(), $4)`,
        [racingEntryId, a.gid, -5_000, a.ownerUserId],
      );

      session.userId = a.ownerUserId;
      pending = deleteGroup({ groupId: a.gid, name: a.name });

      const blocked = await waitForLockWait();
      expect(blocked, '잠금을 기다리는 쿼리가 없다 — 삭제가 경쟁 쓰기를 그냥 지나쳤다').not.toBeNull();
      // 기다리는 지점이 **첫 문장**이어야 한다. `delete from groups`에서 기다린다면 그것은
      // 자식들을 이미 지운 뒤라는 뜻이고, 곧 잠금이 없다는 뜻이다.
      expect(blocked!.query.toLowerCase(), `대기 지점이 첫 잠금이 아니다: ${blocked!.query}`)
        .toContain('for update');
      expect(blocked!.query.toLowerCase()).toContain('groups');

      await client.query('commit');
      const res = (await pending) as { serverError?: string } | undefined;
      expect(res?.serverError, `잠금 뒤 삭제가 실패했다: ${res?.serverError}`).toBeUndefined();
    } finally {
      // 커밋 뒤라면 무의미한 롤백이고, 실패로 왔다면 잠금을 푸는 유일한 수단이다.
      await client.query('rollback').catch(() => {});
      client.release();
      // 롤백으로 풀려난 삭제를 여기서 끝까지 회수한다 — 매달린 트랜잭션을 남기지 않는다.
      await pending?.catch(() => {});
    }

    // 기다리는 동안 커밋된 행까지 사라졌다 — 삭제가 이겼다.
    expect(await rowCounts(a.gid)).toEqual(ALL_ZERO);
    expect(
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, racingEntryId)),
    ).toHaveLength(0);
  });
});

/**
 * 파괴 목록을 **스키마가 아니라 DB에게** 물어 대조한다(외부 리뷰 IMPORTANT 10).
 *
 * "12개 테이블"처럼 손으로 적은 숫자는 낡는다. 여기서는 `pg_constraint`를 재귀적으로 타고
 * `groups`를 **직접·간접으로 참조하는 모든 테이블**을 구한다. 간접이 중요하다 —
 * `settlement_participants`·`settlement_transfers`는 `groups`를 직접 참조하지 않고
 * `settlements`·`memberships`를 거쳐 매달려 있어서, 직접 참조만 세는 대조는 그 둘을 놓친다.
 *
 * 누군가 모임에 매달리는 테이블을 추가하면 이 테스트가 **먼저** 빨개진다 —
 * 삭제가 조용히 행을 남기기 전에.
 */
describe('파괴 목록 대조 (FK 메타데이터)', () => {
  /** `groups`의 참조 전이 폐포. `groups` 자신을 포함한다. */
  async function referencingClosure(): Promise<string[]> {
    const rows = (await sql.query(`
      with recursive closure(oid) as (
        select 'public.groups'::regclass::oid
        union
        select c.conrelid
          from pg_constraint c
          join closure cl on c.confrelid = cl.oid
         where c.contype = 'f'
      )
      select cls.relname as table_name
        from closure cl
        join pg_class cls on cls.oid = cl.oid
    `)) as { table_name: string }[];
    return rows.map((r) => r.table_name).sort();
  }

  it('목록이 groups를 직·간접 참조하는 테이블 전체와 정확히 일치한다', async () => {
    expect([...GROUP_DELETE_TABLES].sort()).toEqual(await referencingClosure());
  });

  /**
   * 집합이 맞아도 **순서**가 틀리면 삭제는 23503으로 죽는다. 순서 역시 손으로 지키는 대신
   * FK 방향에서 검사한다 — 자식은 반드시 부모보다 앞에 있어야 한다.
   * (자기참조는 제외한다: 한 문장이 부모·자식을 함께 지우므로 순서의 문제가 아니다.)
   */
  it('삭제 순서가 FK 방향과 모순되지 않는다 — 자식이 부모보다 먼저다', async () => {
    const edges = (await sql.query(`
      select child.relname as child, parent.relname as parent
        from pg_constraint c
        join pg_class child on child.oid = c.conrelid
        join pg_class parent on parent.oid = c.confrelid
       where c.contype = 'f'
    `)) as { child: string; parent: string }[];

    const order = new Map(GROUP_DELETE_TABLES.map((t, i) => [t, i]));
    const inScope = edges.filter(
      (e) => e.child !== e.parent && order.has(e.child) && order.has(e.parent),
    );
    // 폐포에 7개 자식 테이블이 있으므로 검사할 간선이 없을 리 없다 — 0건이면 쿼리가 틀린 것이다.
    expect(inScope.length, 'FK 간선을 하나도 못 찾았다 — 대조가 헛돌고 있다').toBeGreaterThan(0);

    const violations = inScope.filter((e) => order.get(e.child)! > order.get(e.parent)!);
    expect(
      violations.map((e) => `${e.child} → ${e.parent}`),
      'GROUP_CHILD_DELETE_ORDER에서 자식이 부모보다 뒤에 있다',
    ).toEqual([]);
  });
});
