import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  duesPayments,
  duesRoundMembers,
  duesRounds,
  groups,
  ledgerEntries,
  memberships,
  user,
} from '@/lib/db/schema';
import { newToken } from '@/lib/domain/token';

/**
 * 마이그레이션 0008의 백필을 **파일에서 잘라** 실행한다 — 테스트가 SQL을 따로 베껴 두면
 * 파일이 바뀌어도 초록으로 남는다.
 */
const file = fs.readdirSync('drizzle').find((f) => /^0008_.*member_lifecycle\.sql$/.test(f));
if (!file) throw new Error('drizzle/0008_*member_lifecycle.sql이 없다');
const migration = fs.readFileSync(path.join('drizzle', file), 'utf8');
const block = /-- backfill:start\r?\n([\s\S]*?)-- backfill:end/.exec(migration)?.[1];
if (!block) throw new Error('백필 마커를 찾지 못했다');
const BACKFILL = block
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean);

class Rollback extends Error {}

const at = (iso: string) => new Date(iso);

type Outcome = {
  roster: { roundId: string; membershipId: string }[];
  states: { id: string; leftAt: Date | null; leftReason: string | null }[];
  ids: Record<'owner' | 'withdrawn' | 'latePayer' | 'newcomer' | 'r1' | 'r2', string>;
};

describe('마이그레이션 0008 백필', () => {
  it('탈퇴자를 withdrawn으로 표시하고, 회차 명단 = 생성 시점 가입자 ∪ 납부자 — 그 뒤 roster FK가 성립한다', async () => {
    let outcome: Outcome | null = null;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw('ALTER TABLE "dues_payments" DROP CONSTRAINT "dues_payments_roster_fk"'));

        const gid = crypto.randomUUID();
        await tx
          .insert(groups)
          .values({ id: gid, name: '레거시', inviteToken: newToken(), publicToken: newToken() });

        const mkUser = async (deletedAt: Date | null) => {
          const id = crypto.randomUUID();
          await tx
            .insert(user)
            .values({ id, name: 'u', email: `${id}@test.local`, emailVerified: false, deletedAt });
          return id;
        };
        const mkMember = async (userId: string, role: 'owner' | 'member', joinedAt: Date) => {
          const id = crypto.randomUUID();
          await tx.insert(memberships).values({ id, userId, groupId: gid, role, displayName: 'x', joinedAt });
          return id;
        };
        const ownerUser = await mkUser(null);
        const owner = await mkMember(ownerUser, 'owner', at('2026-01-01T00:00:00Z'));
        const withdrawn = await mkMember(await mkUser(at('2026-05-01T00:00:00Z')), 'member', at('2026-01-02T00:00:00Z'));
        // 1월 회차 **뒤에** 합류했지만 1월 회차 납부 기록이 있다(수동 데이터·시계 오차) — 합집합의 둘째 항.
        const latePayer = await mkMember(await mkUser(null), 'member', at('2026-02-10T00:00:00Z'));
        // 모든 회차 뒤에 합류 — 어느 명단에도 없어야 한다.
        const newcomer = await mkMember(await mkUser(null), 'member', at('2026-06-01T00:00:00Z'));

        const r1 = crypto.randomUUID();
        const r2 = crypto.randomUUID();
        await tx.insert(duesRounds).values([
          { id: r1, groupId: gid, period: '2026-01', amountPerPerson: 10_000, createdAt: at('2026-01-15T00:00:00Z') },
          { id: r2, groupId: gid, period: '2026-03', amountPerPerson: 10_000, createdAt: at('2026-03-15T00:00:00Z') },
        ]);
        const entryId = crypto.randomUUID();
        await tx.insert(ledgerEntries).values({
          id: entryId,
          groupId: gid,
          type: 'DUES_PAYMENT',
          amount: 10_000,
          occurredAt: new Date(),
          createdBy: ownerUser,
        });
        await tx.insert(duesPayments).values({
          id: crypto.randomUUID(),
          groupId: gid,
          roundId: r1,
          membershipId: latePayer,
          ledgerEntryId: entryId,
        });

        for (const stmt of BACKFILL) await tx.execute(sql.raw(stmt));

        // FK를 다시 건다 — 백필이 납부자를 명단에 넣지 못했다면 여기서 23503이다.
        await tx.execute(
          sql.raw(
            'ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_roster_fk" ' +
              'FOREIGN KEY ("group_id","round_id","membership_id") ' +
              'REFERENCES "public"."dues_round_members"("group_id","round_id","membership_id")',
          ),
        );

        outcome = {
          roster: await tx
            .select({ roundId: duesRoundMembers.roundId, membershipId: duesRoundMembers.membershipId })
            .from(duesRoundMembers)
            .where(eq(duesRoundMembers.groupId, gid)),
          states: await tx
            .select({ id: memberships.id, leftAt: memberships.leftAt, leftReason: memberships.leftReason })
            .from(memberships)
            .where(eq(memberships.groupId, gid)),
          ids: { owner, withdrawn, latePayer, newcomer, r1, r2 },
        };
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    const { roster, states, ids } = outcome!;
    const of = (roundId: string) =>
      roster
        .filter((r) => r.roundId === roundId)
        .map((r) => r.membershipId)
        .sort();

    expect(of(ids.r1)).toEqual([ids.owner, ids.withdrawn, ids.latePayer].sort());
    expect(of(ids.r2)).toEqual([ids.owner, ids.withdrawn, ids.latePayer].sort());
    expect(roster.some((r) => r.membershipId === ids.newcomer), '모든 회차 뒤 합류자가 명단에 들어갔다').toBe(false);

    const w = states.find((s) => s.id === ids.withdrawn)!;
    expect(w.leftReason).toBe('withdrawn');
    expect(w.leftAt?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    for (const id of [ids.owner, ids.latePayer, ids.newcomer]) {
      expect(states.find((s) => s.id === id)!.leftReason, `${id}가 떠난 것으로 표시됐다`).toBeNull();
    }

    // 롤백됐는지 — FK가 제자리에 있어야 다른 테스트가 의미를 갖는다.
    const [fk] = (
      await db.execute(sql.raw(`select count(*)::int as n from pg_constraint where conname = 'dues_payments_roster_fk'`))
    ).rows as { n: number }[];
    expect(fk.n).toBe(1);
  });
});
