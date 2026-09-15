import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isForeignKeyViolation, isUniqueViolation } from '@/lib/db/errors';
import { getBalance } from '@/lib/db/queries';
import {
  duesPayments,
  duesRounds,
  groups,
  ledgerEntries,
  memberships,
  user,
} from '@/lib/db/schema';
import { balanceOf, reversalAmount } from '@/lib/domain/ledger';
import { newToken } from '@/lib/domain/token';
import { TEST_TABLES } from './db-guard';

/**
 * 금액 경로를 **실제 DB 왕복으로** 고정한다. 단위 테스트가 이미 순수 함수를 덮고 있으므로
 * 여기서 볼 것은 딱 두 가지다:
 *  1) 저장·합산 경로(`getBalance`의 SQL sum)가 순수 함수(`balanceOf`)와 **같은 답**을 내는가,
 *  2) 액션 레이어가 뚫렸을 때 DB 제약이 실제로 막는가 — **어느 제약이** 막는지까지.
 *
 * (2)에서 제약 **이름**을 단언하는 이유: 지금 `dues_payments`에는 23503을 낼 수 있는 FK가
 * 네 개(group/round/membership/entry) 있고 `ledger_entries`에는 23503·23505를 내는 제약이
 * 둘씩 있다. "쓰기가 실패했다"만 보는 단언은 **엉뚱한 제약이 막아도 통과**하므로, 고정하려던
 * 불변식이 사라져도 초록으로 남는다. 그래서 `isUniqueViolation`/`isForeignKeyViolation`에
 * 이름을 함께 넘긴다.
 */

type Seed = { uid: string; gid: string; mid: string };

async function seedGroup(label: string): Promise<Seed> {
  const uid = crypto.randomUUID();
  await db.insert(user).values({
    id: uid,
    name: label,
    email: `${uid}@test.local`,
    emailVerified: false,
  });
  const gid = crypto.randomUUID();
  await db
    .insert(groups)
    .values({ id: gid, name: label, inviteToken: newToken(), publicToken: newToken() });
  const mid = crypto.randomUUID();
  await db
    .insert(memberships)
    .values({ id: mid, userId: uid, groupId: gid, role: 'owner', displayName: label });
  return { uid, gid, mid };
}

/** 원장 엔트리 한 줄. 반환값은 도메인 함수(`balanceOf`)에 그대로 넣을 수 있는 모양이다. */
async function addEntry(
  seed: Seed,
  type: 'DUES_PAYMENT' | 'EXPENSE' | 'REVERSAL',
  amount: number,
  reversalOf: string | null = null,
) {
  const id = crypto.randomUUID();
  await db.insert(ledgerEntries).values({
    id,
    groupId: seed.gid,
    type,
    amount,
    occurredAt: new Date(),
    createdBy: seed.uid,
    reversalOf,
  });
  return { id, type, amount, reversalOf };
}

async function addRound(seed: Seed, period: string, amountPerPerson = 20_000) {
  const id = crypto.randomUUID();
  await db.insert(duesRounds).values({ id, groupId: seed.gid, period, amountPerPerson });
  return id;
}

/** 거부를 단언할 때 쓰는 포획기 — `rejects.toSatisfy`보다 에러 원문을 보기 쉽다. */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('거부될 것으로 기대한 쓰기가 성공했다');
}

describe('테스트 정리 목록', () => {
  it('스키마의 모든 테이블을 덮는다 — 목록이 스키마에서 파생되므로 테이블 추가를 놓칠 수 없다', () => {
    // 이 단언은 "손으로 적은 목록이 낡는" Plan 03 규칙 5의 함정을 구조적으로 닫았다는 증거다.
    // 테이블을 추가하면 이 배열이 자동으로 늘어난다 — 여기서 기대치를 함께 고치게 된다.
    expect(TEST_TABLES).toEqual([
      'account',
      'dues_payments',
      'dues_rounds',
      'groups',
      'ledger_entries',
      'memberships',
      'session',
      'user',
      'verification',
    ]);
  });
});

describe('잔액 = 원장 합산 (DB 왕복)', () => {
  it('엔트리가 없으면 0이다 — 잔액 컬럼은 존재하지 않는다 (ADR-001)', async () => {
    const a = await seedGroup('빈모임');
    expect(await getBalance(a.gid)).toBe(0);
  });

  it('getBalance가 balanceOf(entries)와 정확히 일치한다', async () => {
    const a = await seedGroup('민지');
    const entries = [
      await addEntry(a, 'DUES_PAYMENT', 20_000),
      await addEntry(a, 'DUES_PAYMENT', 20_000),
      await addEntry(a, 'EXPENSE', -96_000),
      await addEntry(a, 'EXPENSE', -1),
    ];
    // 순수 함수와 SQL sum이 같은 답을 내야 한다 — pg의 sum()은 numeric(문자열)을 돌려주므로
    // 여기서 어긋나면 Number() 복원이나 부호 처리가 깨진 것이다.
    expect(await getBalance(a.gid)).toBe(balanceOf(entries));
    expect(await getBalance(a.gid)).toBe(-56_001);
  });

  it('다른 모임의 엔트리는 합산에 섞이지 않는다', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    await addEntry(a, 'DUES_PAYMENT', 10_000);
    await addEntry(b, 'DUES_PAYMENT', 777_000);
    expect(await getBalance(a.gid)).toBe(10_000);
    expect(await getBalance(b.gid)).toBe(777_000);
  });

  it('역분개는 잔액을 정확히 원복한다 — 상쇄가 아니라 두 줄로 남는다', async () => {
    const a = await seedGroup('민지');
    const target = await addEntry(a, 'EXPENSE', -96_000);
    expect(await getBalance(a.gid)).toBe(-96_000);

    await addEntry(a, 'REVERSAL', reversalAmount(target), target.id);
    expect(await getBalance(a.gid)).toBe(0);

    // 원본은 지워지지 않는다(ADR-001) — 잔액이 0인 것은 두 줄의 합이 0이기 때문이다.
    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.groupId, a.gid));
    expect(rows).toHaveLength(2);
  });
});

describe('원장 제약 — 어느 제약이 막는지까지 고정한다', () => {
  it('같은 엔트리를 두 번 역분개할 수 없다 (ledger_entries_reversal_of_unique)', async () => {
    const a = await seedGroup('민지');
    const target = await addEntry(a, 'EXPENSE', -5_000);
    await addEntry(a, 'REVERSAL', 5_000, target.id);

    const e = await captureError(() => addEntry(a, 'REVERSAL', 5_000, target.id));
    expect(isUniqueViolation(e, 'ledger_entries_reversal_of_unique')).toBe(true);
    // "한 번만 역분개"를 지키는 것은 유니크다 — 복합 FK가 아니다. 둘은 다른 불변식이다.
    expect(isForeignKeyViolation(e)).toBe(false);
    expect(await getBalance(a.gid)).toBe(0);
  });

  it('타 모임 엔트리를 역분개 대상으로 지목할 수 없다 (ledger_entries_reversal_fk)', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    const foreign = await addEntry(b, 'EXPENSE', -5_000);

    const e = await captureError(() => addEntry(a, 'REVERSAL', 5_000, foreign.id));
    expect(isForeignKeyViolation(e, 'ledger_entries_reversal_fk')).toBe(true);
    expect(await getBalance(a.gid)).toBe(0);
    // 남의 모임 잔액도 건드리지 않았다.
    expect(await getBalance(b.gid)).toBe(-5_000);
  });

  it('존재하지 않는 엔트리도 역분개 대상이 될 수 없다 (같은 FK)', async () => {
    const a = await seedGroup('민지');
    const e = await captureError(() => addEntry(a, 'REVERSAL', 5_000, crypto.randomUUID()));
    expect(isForeignKeyViolation(e, 'ledger_entries_reversal_fk')).toBe(true);
  });

  it('reversal_of가 NULL인 엔트리는 그 FK에 걸리지 않는다 (MATCH SIMPLE)', async () => {
    const a = await seedGroup('민지');
    await addEntry(a, 'EXPENSE', -1_000);
    expect(await getBalance(a.gid)).toBe(-1_000);
  });
});

describe('dues_payments 복합 FK — 모임 경계를 DB가 막는다', () => {
  /** 같은 모임의 정상 납부 한 쌍(원장 엔트리 + 납부 기록). 아래 거부 테스트의 대조군이다. */
  async function paySelf(seed: Seed, roundId: string) {
    const entry = await addEntry(seed, 'DUES_PAYMENT', 20_000);
    const id = crypto.randomUUID();
    await db.insert(duesPayments).values({
      id,
      groupId: seed.gid,
      roundId,
      membershipId: seed.mid,
      ledgerEntryId: entry.id,
    });
    return { paymentId: id, entryId: entry.id };
  }

  it('정상 경로(모두 같은 모임)는 성공한다 — 아래 거부들이 엉뚱한 이유로 실패한 게 아님을 보인다', async () => {
    const a = await seedGroup('민지');
    const round = await addRound(a, '2026-01');
    await paySelf(a, round);
    expect(await getBalance(a.gid)).toBe(20_000);
    const rows = await db.select().from(duesPayments).where(eq(duesPayments.groupId, a.gid));
    expect(rows).toHaveLength(1);
  });

  it('타 모임 membership_id는 거부된다 (dues_payments_membership_fk)', async () => {
    // ⚠️ Plan 02 Task 9는 **바로 이 insert가 성공하는 것**을 이용해 음수 미납 상태를 재현했다.
    // 이제 그 경로는 DB가 닫았다 — 그 재현 기법은 설계상 더 이상 불가능하다.
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    const round = await addRound(a, '2026-01');
    const entry = await addEntry(a, 'DUES_PAYMENT', 20_000);

    const e = await captureError(() =>
      db.insert(duesPayments).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        roundId: round,
        membershipId: b.mid, // 타 모임 멤버십
        ledgerEntryId: entry.id,
      }),
    );
    expect(isForeignKeyViolation(e, 'dues_payments_membership_fk')).toBe(true);
    expect(await db.select().from(duesPayments)).toHaveLength(0);
  });

  it('타 모임 round_id는 거부된다 (dues_payments_round_fk)', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    const foreignRound = await addRound(b, '2026-01');
    const entry = await addEntry(a, 'DUES_PAYMENT', 20_000);

    const e = await captureError(() =>
      db.insert(duesPayments).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        roundId: foreignRound,
        membershipId: a.mid,
        ledgerEntryId: entry.id,
      }),
    );
    expect(isForeignKeyViolation(e, 'dues_payments_round_fk')).toBe(true);
    expect(await db.select().from(duesPayments)).toHaveLength(0);
  });

  it('타 모임 ledger_entry_id는 거부된다 (dues_payments_entry_fk)', async () => {
    const a = await seedGroup('A');
    const b = await seedGroup('B');
    const round = await addRound(a, '2026-01');
    const foreignEntry = await addEntry(b, 'DUES_PAYMENT', 20_000);

    const e = await captureError(() =>
      db.insert(duesPayments).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        roundId: round,
        membershipId: a.mid,
        ledgerEntryId: foreignEntry.id,
      }),
    );
    expect(isForeignKeyViolation(e, 'dues_payments_entry_fk')).toBe(true);
    expect(await db.select().from(duesPayments)).toHaveLength(0);
  });

  it('같은 회차·멤버에 납부가 두 번 남을 수 없다 (dues_payments_round_membership)', async () => {
    const a = await seedGroup('민지');
    const round = await addRound(a, '2026-01');
    await paySelf(a, round);

    const e = await captureError(() => paySelf(a, round));
    expect(isUniqueViolation(e, 'dues_payments_round_membership')).toBe(true);
  });

  it('한 모임에 같은 기간 회차는 하나뿐이다 (dues_rounds_group_period)', async () => {
    const a = await seedGroup('민지');
    await addRound(a, '2026-01');
    const e = await captureError(() => addRound(a, '2026-01'));
    expect(isUniqueViolation(e, 'dues_rounds_group_period')).toBe(true);
  });

  it('납부 기록이 남아 있는 멤버십은 지울 수 없다 — 그래서 "명단보다 납부가 많은" 상태가 만들어지지 않는다', async () => {
    // Plan 02 Task 9가 재현했던 음수 미납(overpaid) 상태는 이제 **두 방향 모두** 막혀 있다:
    // ① 타 모임 membership_id 주입은 dues_payments_membership_fk가 거부하고(위 테스트),
    // ② 납부한 멤버십을 지워 명단을 줄이는 것은 이 FK가 거부한다(ON DELETE no action).
    // 즉 회차 화면의 overpaid 분기는 DB 레벨에서 도달 불가다.
    const a = await seedGroup('민지');
    const round = await addRound(a, '2026-01');
    await paySelf(a, round);

    const e = await captureError(() =>
      db.delete(memberships).where(eq(memberships.id, a.mid)),
    );
    expect(isForeignKeyViolation(e, 'dues_payments_membership_fk')).toBe(true);
  });
});
