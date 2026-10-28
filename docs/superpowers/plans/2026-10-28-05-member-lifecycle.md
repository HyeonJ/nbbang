# Plan 05 — 멤버 생명주기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모임을 떠나는 사람(나가기·내보내기·탈퇴)을 모델에 넣고, 회비 회차 명단을 회차 생성 시점에 고정한다.

**Architecture:** `memberships`에 `left_at`·`left_reason`을 더하고 "활동 중 = `left_at IS NULL`" 하나로 접근·목록을 판정한다. 회차 명단은 새 테이블 `dues_round_members`에 스냅샷으로 저장하고, `dues_payments`가 그 명단을 복합 FK로 가리켜 "명단 밖 납부 불가 / 납부자 명단 삭제 불가"를 DB가 고정한다. DB 쓰기 규칙은 `lib/db/membership.ts`·`lib/db/roster.ts`에 두고 액션은 얇게 감싼다(`anonymize.ts`·`delete.ts`와 같은 패턴).

**Tech Stack:** Next.js 15 (App Router, server actions) · next-safe-action 8 · Drizzle ORM 0.45 / drizzle-kit 0.31 · Neon Postgres · Vitest(unit/integration) · Playwright

**스펙:** `docs/superpowers/specs/2026-10-28-member-lifecycle-design.md` (D1~D5). 이 계획의 모든 결정은 스펙을 따른다. 스펙과 다르게 해야 할 것 같으면 **멈추고 묻는다.**

---

## 작업 규칙 (모든 태스크 공통)

- 브랜치: `feat/member-lifecycle` (스펙 커밋 `dd213bc` 위). main에 직접 커밋하지 않는다.
- **`npm run test:integration`과 `npx playwright test`를 동시에 돌리지 않는다** — 같은 test DB를 쓰고 E2E globalSetup이 TRUNCATE한다.
- `playwright.config.ts`를 프로덕션 URL에 대고 돌리지 않는다.
- `.env.*` 내용·연결 문자열을 출력하지 않는다.
- 커밋 메시지 끝에 붙인다:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6
  ```
- 주석은 이 레포 관례대로 **"왜"만** 쓴다. 과정 이력("리뷰에서 지적", "Task N에서 발견")은 커밋 메시지로 보낸다.
- 검증 명령:
  - 단위: `npm test`
  - 통합: `npm run test:integration` (globalSetup이 test DB에 migrate를 먼저 한다)
  - 타입/린트: `npx tsc --noEmit` · `npm run lint`
  - E2E: `npx playwright test` (빌드 후 `next start`로 돈다 — 설정 파일 참고)

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `lib/domain/member.ts` | 신규 | 이름 검증(`parseDisplayName`), 예약 이름 상수, 재가입 판정(`joinDecision`) — 순수 함수 |
| `lib/domain/member.test.ts` | 신규 | 위 단위 테스트 |
| `lib/domain/dues.ts` | 수정 | `RosterMember` 타입, `noticeNames`, `rosterLabel`, `roundTotals` 인자 의미 변경 |
| `lib/domain/dues.test.ts` | 수정 | 위 단위 테스트 |
| `lib/db/schema.ts` | 수정 | `memberships.left_at/left_reason` + CHECK, `dues_round_members`, `dues_payments_roster_fk` |
| `drizzle/0008_member_lifecycle.sql` (+ `meta/`) | 신규 | 스키마 + 백필 |
| `lib/db/anonymize.ts` | 수정 | 상수를 도메인에서 재수출, 탈퇴 시 멤버십 `withdrawn` 표시 |
| `lib/db/delete.ts` | 수정 | 삭제 순서에 `dues_round_members` |
| `lib/db/queries.ts` | 수정 | 활동 중 필터, `getRoundRoster`, `getLeftMembers`, `getRoundsWithCounts.rosterCount` |
| `lib/db/public-queries.ts` | 수정 | 공개 장부 멤버 목록 활동 중만 |
| `lib/db/roster.ts` | 신규 | 회차 명단 쓰기: 스냅샷·추가·빼기 |
| `lib/db/membership.ts` | 신규 | 나가기·내보내기·되살리기·재가입 쓰기 |
| `actions/clients.ts` | 수정 | `groupActionClient`가 활동 중 멤버십만 통과 |
| `actions/dues.ts` | 수정 | `createRound` 스냅샷, `markPaid` 명단 확인, `addToRound`·`removeFromRound` |
| `actions/membership.ts` | 수정 | `joinByInvite` 재가입, `leaveGroup`·`removeMember`·`restoreMember` |
| `actions/group.ts` | 수정 | `createGroup` 이름 검증 |
| `actions/settlement.ts` | 수정 | 참여자·선결제자 활동 중 확인 |
| `app/groups/page.tsx` | 수정 | 내 모임 목록 활동 중만 |
| `app/groups/[groupId]/page.tsx` | 수정 | 멤버용 "모임 나가기" 패널 |
| `app/groups/[groupId]/leave-group-panel.tsx` | 신규 | 나가기 버튼 |
| `app/groups/[groupId]/settings/page.tsx` | 수정 | 내보내기 버튼, "나간 멤버" 섹션 |
| `app/groups/[groupId]/settings/member-actions.tsx` | 신규 | 내보내기·되살리기 버튼 |
| `app/groups/[groupId]/dues/page.tsx` | 수정 | `n/m`의 m = 회차 명단 인원 |
| `app/groups/[groupId]/dues/[roundId]/page.tsx` | 수정 | 명단 기준 계산, `(나감)`, 면제·추가, overpaid 분기 삭제 |
| `app/groups/[groupId]/dues/[roundId]/roster-actions.tsx` | 신규 | 면제·명단 추가 버튼 |
| `app/invite/[token]/join-form.tsx` · `app/groups/new-group-form.tsx` | 수정 | 새 오류 코드 문구 |
| `test/member-lifecycle.integration.test.ts` | 신규 | 액션·쿼리·FK 통합 테스트 |
| `test/member-lifecycle-backfill.integration.test.ts` | 신규 | 마이그레이션 백필 SQL 검증 |
| `test/money-paths.integration.test.ts` · `test/account-delete.integration.test.ts` | 수정 | 테이블 목록, 탈퇴 → `withdrawn`, 텍스트 컬럼 분류 |
| `e2e/ledger.spec.ts` · `e2e/public-ledger.spec.ts` | 수정 | 뒤늦게 합류한 멤버를 명단에 추가 |
| `e2e/member-lifecycle.spec.ts` | 신규 | 나가기·재가입·내보내기·되살리기·면제 동선 |
| `e2e/authz.spec.ts` | 수정 | 새 액션 5종 + "나간 멤버" 컨텍스트 |
| `docs/adr/005-member-lifecycle.md` 외 문서 | 신규/수정 | ADR·용어집·스펙·요구사항 |

---

## Task 1: 도메인 순수 함수 — 이름 검증·재가입 판정·회차 명단 표기

**Files:**
- Create: `lib/domain/member.ts`, `lib/domain/member.test.ts`
- Modify: `lib/domain/dues.ts`, `lib/domain/dues.test.ts`, `lib/db/anonymize.ts:62`

- [ ] **Step 1: 실패하는 테스트 — `lib/domain/member.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  ANONYMOUS_MEMBER_NAME,
  joinDecision,
  MemberRuleError,
  parseDisplayName,
} from '@/lib/domain/member';

const thrownCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as MemberRuleError).code;
  }
  throw new Error('던질 것으로 기대했다');
};

describe('parseDisplayName', () => {
  it('앞뒤 공백을 잘라 저장한다', () => {
    expect(parseDisplayName('  철수 ')).toBe('철수');
  });

  it('공백만 있으면 INVALID_NAME', () => {
    expect(thrownCode(() => parseDisplayName('   '))).toBe('INVALID_NAME');
    expect(thrownCode(() => parseDisplayName(''))).toBe('INVALID_NAME');
  });

  it('파기 표지와 같은 이름은 RESERVED_NAME — 공백을 바꿔 끼워도 같다', () => {
    expect(thrownCode(() => parseDisplayName(ANONYMOUS_MEMBER_NAME))).toBe('RESERVED_NAME');
    expect(thrownCode(() => parseDisplayName(' 탈퇴한 멤버 '))).toBe('RESERVED_NAME');
    expect(thrownCode(() => parseDisplayName('탈퇴한멤버'))).toBe('RESERVED_NAME');
    expect(thrownCode(() => parseDisplayName('탈퇴한  멤버'))).toBe('RESERVED_NAME');
  });

  it('비슷하지만 다른 이름은 통과한다', () => {
    expect(parseDisplayName('탈퇴한 멤버2')).toBe('탈퇴한 멤버2');
  });
});

describe('joinDecision', () => {
  it('멤버십이 없으면 새로 만든다', () => {
    expect(joinDecision(null)).toBe('create');
  });
  it('활동 중이면 이미 멤버다', () => {
    expect(joinDecision({ leftReason: null })).toBe('already');
  });
  it('스스로 나간 사람은 같은 멤버십으로 돌아온다', () => {
    expect(joinDecision({ leftReason: 'left' })).toBe('rejoin');
  });
  it('내보내진 사람과 탈퇴자는 링크로 돌아올 수 없다', () => {
    expect(joinDecision({ leftReason: 'removed' })).toBe('blocked');
    expect(joinDecision({ leftReason: 'withdrawn' })).toBe('blocked');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --project unit lib/domain/member.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/member'` 류.

- [ ] **Step 3: 구현 — `lib/domain/member.ts`**

```ts
export class MemberRuleError extends Error {
  constructor(public code: 'INVALID_NAME' | 'RESERVED_NAME') {
    super(code);
  }
}

/**
 * 탈퇴(ADR-004) 시 표시 이름 자리에 들어가는 값. 파기의 표지이므로 살아 있는 사람이 쓰면
 * 공개 장부에서 둘을 구별할 수 없다 — 그래서 이름 입력에서 예약한다.
 * `lib/db/anonymize.ts`가 이 값을 재수출한다(도메인은 DB 모듈을 import하지 않는다).
 */
export const ANONYMOUS_MEMBER_NAME = '탈퇴한 멤버';

const squash = (s: string) => s.replace(/\s+/g, '');

export function parseDisplayName(input: string): string {
  const name = input.trim();
  if (name === '') throw new MemberRuleError('INVALID_NAME');
  // 공백만 바꿔 끼운 변형도 화면에서는 같은 표지로 읽힌다.
  if (squash(name) === squash(ANONYMOUS_MEMBER_NAME)) throw new MemberRuleError('RESERVED_NAME');
  return name;
}

export type LeftReason = 'left' | 'removed' | 'withdrawn';
export type JoinDecision = 'create' | 'already' | 'rejoin' | 'blocked';

/**
 * 초대 링크로 들어온 사람을 어떻게 다룰지 (스펙 D4).
 * 내보내진 사람이 링크로 돌아올 수 있으면 내보내기가 링크 재발급 없이는 의미가 없다.
 */
export function joinDecision(existing: { leftReason: LeftReason | null } | null): JoinDecision {
  if (!existing) return 'create';
  if (existing.leftReason === null) return 'already';
  if (existing.leftReason === 'left') return 'rejoin';
  return 'blocked';
}
```

- [ ] **Step 4: `lib/db/anonymize.ts`의 상수를 재수출로 바꾼다**

62행 `export const ANONYMOUS_MEMBER_NAME = '탈퇴한 멤버';`를 아래로 교체한다(기존 import 경로는 그대로 동작한다).

```ts
export { ANONYMOUS_MEMBER_NAME } from '@/lib/domain/member';
```

파일 안에서 이 상수를 쓰는 곳(`.set({ displayName: ANONYMOUS_MEMBER_NAME })` 등)이 있으므로 같은 파일 상단 import에도 추가한다:

```ts
import { ANONYMOUS_MEMBER_NAME } from '@/lib/domain/member';
```

- [ ] **Step 5: `lib/domain/dues.test.ts`에 실패하는 테스트 추가** (파일 끝에)

import 줄을 `import { unpaidMembers, roundTotals, parsePeriod, DuesRuleError, noticeNames, rosterLabel } from '@/lib/domain/dues';`로 바꾸고 아래를 붙인다.

```ts
describe('회차 명단 표기', () => {
  const roster = [
    { membershipId: 'm1', displayName: '민지', left: false },
    { membershipId: 'm2', displayName: '철수', left: true },
    { membershipId: 'm3', displayName: '영희', left: false },
  ];

  it('미납 안내 문구에는 활동 중인 미납자만 들어간다 — 나간 사람은 단톡방에 없다', () => {
    expect(noticeNames(unpaidMembers(roster, ['m3']) as typeof roster)).toEqual(['민지']);
  });

  it('나간 사람은 화면에서 (나감)이 붙는다', () => {
    expect(rosterLabel(roster[1])).toBe('철수 (나감)');
    expect(rosterLabel(roster[0])).toBe('민지');
  });

  it('roundTotals는 회차 명단 인원으로 계산한다', () => {
    expect(roundTotals(20_000, roster.length, ['m1'])).toEqual({
      expected: 60_000,
      collected: 20_000,
      outstanding: 40_000,
    });
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run --project unit lib/domain/dues.test.ts`
Expected: FAIL — `noticeNames is not a function` 류.

- [ ] **Step 7: `lib/domain/dues.ts` 수정**

`MemberLike` 아래에 추가:

```ts
/** 회차 명단의 한 사람. `left`는 **지금** 모임을 떠났는지다 — 명단에 있었던 사실은 그대로다(스펙 D3). */
export type RosterMember = MemberLike & { left: boolean };

/** 단톡방에 붙는 미납 문구에 넣을 이름. 나간 사람은 그 방에 없다 — 미납은 화면에만 남는다. */
export function noticeNames(unpaid: readonly RosterMember[]): string[] {
  return unpaid.filter((m) => !m.left).map((m) => m.displayName);
}

export function rosterLabel(m: RosterMember): string {
  return m.left ? `${m.displayName} (나감)` : m.displayName;
}
```

`unpaidMembers`를 제네릭으로 바꿔 `RosterMember[]`를 넣으면 `RosterMember[]`가 나오게 한다(테스트의 캐스트가 없어도 되게):

```ts
export function unpaidMembers<T extends MemberLike>(members: readonly T[], paidIds: readonly string[]): T[] {
  const paid = new Set(paidIds);
  return members.filter((m) => !paid.has(m.membershipId));
}
```

그리고 Step 5 테스트의 `as typeof roster` 캐스트를 지운다.

`unpaidMembers`의 주석에서 "명단에 없는 납부 id(탈퇴 멤버의 기록 등)는 조용히 무시한다" 문장을 지운다 — 이제 `dues_payments_roster_fk` 때문에 명단 밖 납부가 존재할 수 없다.

`roundTotals`를 아래로 교체한다(동작은 같고 인자의 의미와 주석이 바뀐다):

```ts
/**
 * 회차 3수치. 수납액은 원장 합산이 아니라 '1인 금액 × 납부 인원'이다 — 회차 화면의 수치는 회차 자체로 닫힌다.
 * `rosterSize`는 **회차 명단** 인원이다. 납부는 명단 안에서만 존재하므로(dues_payments_roster_fk)
 * 미납액은 음수가 될 수 없다.
 */
export function roundTotals(amountPerPerson: number, rosterSize: number, paidIds: readonly string[]) {
  const expected = amountPerPerson * rosterSize;
  const collected = amountPerPerson * paidIds.length;
  return { expected, collected, outstanding: expected - collected };
}
```

- [ ] **Step 8: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: 단위 전부 PASS(기존 178 + 신규), tsc 0 에러.

- [ ] **Step 9: 커밋**

```bash
git add lib/domain/member.ts lib/domain/member.test.ts lib/domain/dues.ts lib/domain/dues.test.ts lib/db/anonymize.ts
git commit -m "feat: 멤버 이름 검증·재가입 판정·회차 명단 표기 도메인 함수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
```

---

## Task 2: 스키마 · 마이그레이션 0008 · 백필

**Files:**
- Modify: `lib/db/schema.ts` (memberships, 새 테이블, dues_payments)
- Create: `drizzle/0008_member_lifecycle.sql`, `drizzle/meta/0008_snapshot.json` (`_journal.json`은 생성기가 갱신)
- Modify: `lib/db/delete.ts` (삭제 순서)
- Create: `test/member-lifecycle-backfill.integration.test.ts`
- Modify: `test/money-paths.integration.test.ts`, `test/group-delete.integration.test.ts`, `test/account-delete.integration.test.ts` (납부 픽스처가 명단 행을 먼저 넣는다 · 테이블 목록 · 텍스트 컬럼 분류)

- [ ] **Step 1: `lib/db/schema.ts` — import**

pg-core import 목록에 `check`, `primaryKey`를 넣고, drizzle-orm에서 `sql`을 가져온다(현재 schema.ts에는 drizzle-orm import가 없다).

```ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: `memberships`에 두 컬럼 + CHECK**

`joinedAt` 아래에 추가:

```ts
  /**
   * 모임을 떠난 시각. **null = 활동 중** — 접근·목록·명단 스냅샷의 판정은 이 한 컬럼으로만 한다(ADR-005).
   * 행을 지우지 않는 이유는 탈퇴와 같다: 원장·납부·정산·과거 회차 명단이 이 행을 참조한다.
   */
  leftAt: timestamp('left_at', { withTimezone: true }),
  /** 'left' 본인 · 'removed' 총무가 내보냄 · 'withdrawn' 회원 탈퇴. 되살리기·재가입 판정이 이것을 본다. */
  leftReason: text('left_reason', { enum: ['left', 'removed', 'withdrawn'] }),
```

테이블 콜백 배열 끝에 추가:

```ts
  // 둘 중 하나만 채워진 행은 "떠났는데 이유가 없다" 또는 그 반대 — 판정이 갈린다.
  check('memberships_left_consistency', sql`(${t.leftAt} is null) = (${t.leftReason} is null)`),
```

- [ ] **Step 3: `dues_round_members` 테이블** — `duesRounds` 정의 **바로 아래**, `duesPayments` 위에 둔다(`duesPayments`가 참조하므로 먼저 선언돼야 한다).

```ts
/**
 * 회차 명단 — 회차를 만들 때 활동 중이던 멤버로 **고정**된다(ADR-005 D1).
 * 이후 합류한 사람은 이 회차에 없고, 나간 사람은 남는다(그 시점의 의무). 총무가 빼거나(면제) 넣을 수 있다.
 * 납부(`dues_payments`)가 이 행을 복합 FK로 가리키므로, 명단 밖 납부와 납부자 명단 삭제를 DB가 막는다.
 */
export const duesRoundMembers = pgTable('dues_round_members', {
  groupId: text('group_id').notNull().references(() => groups.id),
  roundId: text('round_id').notNull(),
  membershipId: text('membership_id').notNull(),
}, (t) => [
  primaryKey({ name: 'dues_round_members_pk', columns: [t.roundId, t.membershipId] }),
  // dues_payments_roster_fk의 참조 대상(memberships_group_id_key와 같은 이유).
  unique('dues_round_members_group_round_membership_key').on(t.groupId, t.roundId, t.membershipId),
  foreignKey({
    columns: [t.groupId, t.roundId],
    foreignColumns: [duesRounds.groupId, duesRounds.id],
    name: 'dues_round_members_round_fk',
  }),
  foreignKey({
    columns: [t.groupId, t.membershipId],
    foreignColumns: [memberships.groupId, memberships.id],
    name: 'dues_round_members_membership_fk',
  }),
]);
```

- [ ] **Step 4: `dues_payments`에 명단 FK** — 기존 세 `foreignKey` 뒤에 추가:

```ts
  // 납부는 명단 안에서만 존재한다 — 명단 밖 insert와 납부자 명단 delete가 모두 23503이다.
  // 그래서 회차 화면의 "납부 > 명단" 상태는 표현 불가능하다.
  foreignKey({
    columns: [t.groupId, t.roundId, t.membershipId],
    foreignColumns: [duesRoundMembers.groupId, duesRoundMembers.roundId, duesRoundMembers.membershipId],
    name: 'dues_payments_roster_fk',
  }),
```

- [ ] **Step 5: 마이그레이션 생성**

Run: `npm run db:generate -- --name member_lifecycle`
Expected: `drizzle/0008_member_lifecycle.sql`과 `drizzle/meta/0008_snapshot.json` 생성, `_journal.json`에 idx 8 추가. (generate는 DB에 접속하지 않는다.)

- [ ] **Step 6: 생성된 SQL에 백필을 끼워 넣는다**

생성된 문장은 **이름·문법을 그대로 둔다**(스냅샷과 같아야 다음 generate가 어긋나지 않는다). 할 일은 둘이다.
1. `ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_roster_fk" ...` 문장을 **파일 맨 끝으로 옮긴다.** 백필 전에 걸면 기존 납부 행 전부가 위반이다.
2. 그 문장 **바로 앞**에 아래 블록을 넣는다. 마커 주석 두 줄은 백필 테스트(Step 8)가 이 구간을 잘라 실행하는 데 쓰므로 글자 그대로 둔다.

```sql
-- backfill:start
UPDATE "memberships" AS m
   SET "left_at" = u."deleted_at", "left_reason" = 'withdrawn'
  FROM "user" AS u
 WHERE u."id" = m."user_id" AND u."deleted_at" IS NOT NULL AND m."left_at" IS NULL;--> statement-breakpoint
INSERT INTO "dues_round_members" ("group_id", "round_id", "membership_id")
SELECT r."group_id", r."id", m."id"
  FROM "dues_rounds" AS r
  JOIN "memberships" AS m ON m."group_id" = r."group_id" AND m."joined_at" <= r."created_at"
                         AND (m."left_at" IS NULL OR m."left_at" > r."created_at")
UNION
SELECT p."group_id", p."round_id", p."membership_id"
  FROM "dues_payments" AS p
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- backfill:end
```

최종 파일 순서: (생성된) memberships 컬럼 추가 → CREATE TABLE dues_round_members → 그 테이블의 FK들 → memberships CHECK → **backfill 블록** → dues_payments_roster_fk. 생성기가 CHECK·FK를 다른 순서로 냈다면 그 순서는 유지하되 **roster FK만 맨 끝**, 백필은 그 바로 앞이면 된다. 각 문장 사이의 `--> statement-breakpoint` 구분자를 빠뜨리지 않는다.

- [ ] **Step 7: 드리프트 가드 확인**

Run: `DATABASE_URL=postgresql://unused npx drizzle-kit generate`
Expected: `No schema changes, nothing to migrate` — 새 파일이 생기지 않는다. 생기면 지우고 Step 1~4를 다시 본다.

- [ ] **Step 8: 백필 테스트 — `test/member-lifecycle-backfill.integration.test.ts`**

마이그레이션 SQL의 백필 구간을 **그대로** 잘라 레거시 상태에 실행하고, 그 뒤 roster FK가 성립하는지까지 본다. FK를 잠시 떼고 다시 거는 DDL은 트랜잭션 안에서 하고 끝에 롤백한다(Postgres DDL은 트랜잭션적이다). 그래서 test DB 스키마는 테스트 전후로 같다.

```ts
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
```

> `user.deletedAt`·`duesRounds.createdAt`·`memberships.joinedAt`은 insert에서 값을 줄 수 있다. `db`는 `drizzle-orm/neon-serverless`라 `execute`는 `.rows`를 가진 결과를 돌려준다.

- [ ] **Step 9: 기존 통합 테스트 픽스처를 새 FK에 맞춘다**

새 FK 때문에 **납부 행을 직접 insert하는 픽스처**는 명단 행을 먼저 넣어야 한다.

`test/money-paths.integration.test.ts` — import에 `duesRoundMembers`, drizzle-orm에서 `and`를 추가하고 `paySelf` 첫 줄에 명단 행을 넣는다:

```ts
  async function paySelf(seed: Seed, roundId: string) {
    await db
      .insert(duesRoundMembers)
      .values({ groupId: seed.gid, roundId, membershipId: seed.mid })
      .onConflictDoNothing();
    const entry = await addEntry(seed, 'DUES_PAYMENT', 20_000);
```

같은 파일의 "타 모임 ledger_entry_id" 테스트(`dues_payments_entry_fk`)는 `roundId: round, membershipId: a.mid` 조합이라 명단 행이 없으면 roster FK도 함께 위반된다. 그 테스트의 `captureError` 직전에 추가한다:

```ts
    await db.insert(duesRoundMembers).values({ groupId: a.gid, roundId: round, membershipId: a.mid });
```

"타 모임 membership_id"·"타 모임 round_id"·"납부한 멤버십 삭제" 세 테스트는 원래 FK와 새 명단 FK가 **같은 쓰기를 함께** 막는다. 보고 순서는 RI 트리거 이름(OID) 순서라 DB마다 달라 의존하지 않는다. 그래서 각 테스트는 (1) 정상 설정에서 "둘 중 하나의 제약"으로 거부됨을 단언하고, (2) `withoutConstraint`로 가리는 제약(roster FK 또는 `dues_round_members_membership_fk`)을 트랜잭션 안에서 떼고 롤백하여 원래 FK가 혼자서도 막는다는 것을 따로 증명한다. 롤백 뒤 두 제약이 제자리에 있는지도 확인한다.

같은 파일 `describe('테스트 정리 목록')`의 기대 배열에서 `'"public"."dues_payments"',` 다음 줄에 추가:

```ts
      // Plan 05 회차 명단.
      '"public"."dues_round_members"',
```

`describe('dues_payments 복합 FK — 모임 경계를 DB가 막는다')` 끝에 두 테스트를 추가한다:

```ts
  it('명단에 없는 사람의 납부는 거부된다 (dues_payments_roster_fk)', async () => {
    const a = await seedGroup('민지');
    const round = await addRound(a, '2026-01');
    const entry = await addEntry(a, 'DUES_PAYMENT', 20_000);
    const e = await captureError(() =>
      db.insert(duesPayments).values({
        id: crypto.randomUUID(),
        groupId: a.gid,
        roundId: round,
        membershipId: a.mid,
        ledgerEntryId: entry.id,
      }),
    );
    expect(isForeignKeyViolation(e, 'dues_payments_roster_fk')).toBe(true);
  });

  it('납부한 사람은 명단에서 뺄 수 없다 (dues_payments_roster_fk)', async () => {
    const a = await seedGroup('민지');
    const round = await addRound(a, '2026-01');
    await paySelf(a, round);
    const e = await captureError(() =>
      db
        .delete(duesRoundMembers)
        .where(and(eq(duesRoundMembers.roundId, round), eq(duesRoundMembers.membershipId, a.mid))),
    );
    expect(isForeignKeyViolation(e, 'dues_payments_roster_fk')).toBe(true);
  });
```

`test/group-delete.integration.test.ts` — import에 `duesRoundMembers`를 추가하고 `insert(duesPayments)` 바로 앞에:

```ts
  await db.insert(duesRoundMembers).values({ groupId: gid, roundId, membershipId: owner.membershipId });
```

`test/account-delete.integration.test.ts` — import에 `duesRoundMembers`를 추가하고 첫 `insert(duesPayments)` 앞에 한 번:

```ts
  await db.insert(duesRoundMembers).values([
    { groupId: gid, roundId, membershipId: leaverMembershipId },
    { groupId: gid, roundId, membershipId: twinMembershipId },
  ]);
```

같은 파일 5b의 `KEPT`에 추가:

```ts
      'memberships.left_reason': "'left' | 'removed' | 'withdrawn' — 사람의 식별자가 아니다",
```

- [ ] **Step 10: 삭제 순서 — `lib/db/delete.ts`**

import에 `duesRoundMembers`를 추가하고 `GROUP_CHILD_DELETE_ORDER`를 아래로 바꾼다. 납부가 명단을 가리키므로 명단은 납부 **뒤**에 지우고, 명단이 회차·멤버십을 가리키므로 그 둘보다는 **앞**에 지운다.

```ts
export const GROUP_CHILD_DELETE_ORDER: readonly GroupScopedTable[] = [
  duesPayments,
  duesRoundMembers,
  settlementTransfers,
  settlementParticipants,
  settlements,
  duesRounds,
  ledgerEntries,
  memberships,
];
```

같은 파일 위쪽 주석의 FK 목록에 한 줄을 추가한다: `` - `dues_round_members` → dues_rounds · memberships (복합 FK 2개). `dues_payments`가 이것을 가리킨다 ``. `group-delete.integration.test.ts`의 "폐포에 7개 자식 테이블" 주석 숫자를 8로 고친다.

- [ ] **Step 11: 통합 전체 실행**

Run: `npm run test:integration`
Expected: 전부 PASS. globalSetup이 0008을 test DB에 적용한다.

**변이 확인:** Step 10의 `duesRoundMembers` 줄을 빼고 다시 돌려 `group-delete`의 FK 폐포 대조가 빨개지는지 본다(대조가 새 테이블을 실제로 보고 있다는 증거). 확인 후 되돌린다.

- [ ] **Step 12: 단위·타입·린트**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 전부 통과.

- [ ] **Step 13: 커밋**

```bash
git add lib/db/schema.ts lib/db/delete.ts drizzle/ test/
git commit -m "feat: 멤버십 떠남 상태와 회차 명단 테이블 — 납부는 명단 안에서만 존재한다

마이그레이션 0008: memberships.left_at/left_reason(+CHECK), dues_round_members,
dues_payments_roster_fk. 백필은 탈퇴자를 withdrawn으로, 기존 회차 명단을
생성 시점 가입자 ∪ 납부자로 채운 뒤 FK를 건다. 백필 SQL은 파일에서 잘라
레거시 상태에 실행하는 통합 테스트로 고정.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
```

---

## Task 3: "활동 중" 판정 — 접근·목록·정산 참여자

나간 사람은 그 순간부터 모임의 페이지·액션·목록에서 사라진다. 판정은 `left_at IS NULL` 하나다.

**Files:**
- Modify: `lib/db/queries.ts` (`getGroupForMember`, `getGroupMembers`, 신규 `getLeftMembers`)
- Modify: `actions/clients.ts` (`groupActionClient`)
- Modify: `app/groups/page.tsx` (내 모임 목록)
- Modify: `lib/db/public-queries.ts` (멤버 목록)
- Modify: `actions/settlement.ts` (참여자·선결제자 확인)
- Create: `test/member-lifecycle.integration.test.ts`

- [ ] **Step 1: 통합 테스트 파일 뼈대 + 실패하는 테스트**

`test/member-lifecycle.integration.test.ts`를 만든다. 뒤 태스크(4·5·6)가 이 파일에 `describe`를 더한다.

```ts
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
    await expect(
      db
        .update(memberships)
        .set({ leftAt: new Date() })
        .where(and(eq(memberships.id, g.members[0].membershipId), eq(memberships.groupId, g.gid))),
    ).rejects.toThrow(/memberships_left_consistency/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx dotenv -e .env.test -- vitest run --project integration test/member-lifecycle.integration.test.ts`
Expected: `getLeftMembers`가 없어 import 실패 또는 접근 판정 테스트 FAIL.

- [ ] **Step 3: `lib/db/queries.ts`**

drizzle-orm import에 `isNotNull`, `isNull`을 추가한다.

`getGroupForMember`의 where를 바꾼다:

```ts
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.userId, userId),
        // 떠난 사람은 비멤버와 같다 — 모든 모임 페이지·CSV 라우트가 이 한 줄로 막힌다(ADR-005).
        isNull(memberships.leftAt),
      ),
    )
```

`getGroupMembers`의 주석과 where:

```ts
/** 모임의 **활동 중** 멤버 목록 — 총무 먼저, 이후 합류일 순. 나간 사람은 `getLeftMembers`. */
```

```ts
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt)))
```

`getGroupMembers` 아래에 추가:

```ts
/** 떠난 멤버 — 최근에 떠난 순. 설정 화면의 "나간 멤버" 섹션과 되살리기가 쓴다. */
export async function getLeftMembers(groupId: string) {
  return db
    .select({
      id: memberships.id,
      displayName: memberships.displayName,
      leftAt: memberships.leftAt,
      leftReason: memberships.leftReason,
    })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), isNotNull(memberships.leftAt)))
    .orderBy(desc(memberships.leftAt));
}
```

- [ ] **Step 4: `actions/clients.ts`의 `groupActionClient`**

drizzle-orm import에 `isNull`을 추가하고 멤버십 조회를 바꾼다:

```ts
  const m = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.groupId, parsed.data.groupId),
      eq(memberships.userId, ctx.userId),
      // 페이지 쪽 getGroupForMember와 **같은** 판정이어야 한다 — 갈리면 화면은 404인데 액션은 통과한다.
      isNull(memberships.leftAt),
    ),
  });
```

- [ ] **Step 5: `app/groups/page.tsx`**

`isNull`을 import하고(`import { and, eq, isNull } from 'drizzle-orm';` — 기존 import 줄에 맞춘다) where를 바꾼다:

```ts
    .where(and(eq(memberships.userId, session.user.id), isNull(memberships.leftAt)));
```

- [ ] **Step 6: `lib/db/public-queries.ts`의 멤버 목록**

`and`, `isNull`을 import하고:

```ts
      .where(and(eq(memberships.groupId, group.id), isNull(memberships.leftAt)))
```

- [ ] **Step 7: `actions/settlement.ts`의 참여자 확인**

`isNull`을 import하고 참여자·선결제자 조회(`.where(and(eq(memberships.groupId, ctx.groupId), inArray(memberships.id, ids)))`)를 바꾼다:

```ts
      .where(
        and(
          eq(memberships.groupId, ctx.groupId),
          inArray(memberships.id, ids),
          // 나간 사람에게 새 채무를 지울 수 없다. 과거 정산은 스냅샷이라 영향이 없다(ADR-003).
          isNull(memberships.leftAt),
        ),
      );
```

- [ ] **Step 8: 통과 확인**

Run: `npm run test:integration && npx tsc --noEmit && npm run lint`
Expected: 전부 PASS.

**변이 확인:** `getGroupForMember`의 `isNull(memberships.leftAt)` 줄을 빼고 돌려 "페이지 접근" 테스트가 빨개지는 것을, `groupActionClient`의 같은 줄을 빼고 "액션 접근" 테스트가 빨개지는 것을 본다. 확인 후 되돌린다.

- [ ] **Step 9: 커밋**

```bash
git add lib/db/queries.ts lib/db/public-queries.ts actions/clients.ts actions/settlement.ts app/groups/page.tsx test/member-lifecycle.integration.test.ts
git commit -m "feat: 떠난 멤버는 모임 접근·목록·정산 참여자에서 빠진다

활동 중 = left_at IS NULL 하나로 판정한다. 페이지(getGroupForMember)와
액션(groupActionClient)이 같은 조건을 쓴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
```

---

## Task 4: 회차 명단 — 생성 시 스냅샷, 명단 기준 납부, 면제·추가

**Files:**
- Create: `lib/db/roster.ts`
- Modify: `lib/db/queries.ts` (`getRoundRoster`, `getRoundsWithCounts.rosterCount`)
- Modify: `actions/dues.ts` (`createRound`, `markPaid`, 신규 `addToRound`·`removeFromRound`)
- Modify: `app/groups/[groupId]/dues/[roundId]/page.tsx`, `app/groups/[groupId]/dues/page.tsx`, `app/groups/[groupId]/dues/[roundId]/payment-toggle.tsx`
- Create: `app/groups/[groupId]/dues/[roundId]/roster-actions.tsx`
- Modify: `test/member-lifecycle.integration.test.ts`

- [ ] **Step 1: 실패하는 테스트 — 통합 테스트 파일에 추가**

import를 늘린다:

```ts
import { getGroupForMember, getGroupMembers, getLeftMembers, getRoundRoster, getRoundsWithCounts } from '@/lib/db/queries';
import { duesPayments, duesRoundMembers, groups, ledgerEntries, memberships, settlements, user } from '@/lib/db/schema';
```

액션 import 아래에 추가:

```ts
const { createRound, markPaid, addToRound, removeFromRound } = await import('@/actions/dues');
```

파일 끝에 추가:

```ts
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
    await markPaid({ groupId: g.gid, roundId, membershipId: chulsoo.membershipId });

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
```

- [ ] **Step 2: 실패 확인**

Run: `npx dotenv -e .env.test -- vitest run --project integration test/member-lifecycle.integration.test.ts`
Expected: import 실패(`getRoundRoster`·`addToRound` 없음).

- [ ] **Step 3: `lib/db/roster.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isForeignKeyViolation } from '@/lib/db/errors';
import { duesRoundMembers, memberships } from '@/lib/db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 회차 명단 쓰기(ADR-005 D1·D3). 회차가 같은 모임의 것인지는 호출자가 `getRound(groupId, …)`로
 * 먼저 확인한다 — 여기의 복합 FK가 모임 경계를 다시 막지만, 그것은 500이지 도메인 코드가 아니다.
 */

/** 회차를 만드는 **같은 트랜잭션** 안에서 부른다 — 회차만 있고 명단이 없는 순간이 생기지 않게. */
export async function snapshotRoster(tx: Tx, groupId: string, roundId: string): Promise<void> {
  const active = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt)));
  if (active.length === 0) return;
  await tx
    .insert(duesRoundMembers)
    .values(active.map((m) => ({ groupId, roundId, membershipId: m.id })));
}

export type AddResult = 'added' | 'already' | 'not_active';

export async function addToRoster(groupId: string, roundId: string, membershipId: string): Promise<AddResult> {
  const member = await db.query.memberships.findFirst({
    where: and(eq(memberships.id, membershipId), eq(memberships.groupId, groupId), isNull(memberships.leftAt)),
  });
  // 떠난 사람을 새 회차 의무에 넣지 않는다 — 나간 뒤의 회차는 그 사람의 것이 아니다.
  if (!member) return 'not_active';
  const inserted = await db
    .insert(duesRoundMembers)
    .values({ groupId, roundId, membershipId })
    .onConflictDoNothing()
    .returning({ membershipId: duesRoundMembers.membershipId });
  return inserted.length === 0 ? 'already' : 'added';
}

export type RemoveResult = 'removed' | 'not_in_roster' | 'paid';

export async function removeFromRoster(
  groupId: string,
  roundId: string,
  membershipId: string,
): Promise<RemoveResult> {
  try {
    const deleted = await db
      .delete(duesRoundMembers)
      .where(
        and(
          eq(duesRoundMembers.groupId, groupId),
          eq(duesRoundMembers.roundId, roundId),
          eq(duesRoundMembers.membershipId, membershipId),
        ),
      )
      .returning({ membershipId: duesRoundMembers.membershipId });
    return deleted.length === 0 ? 'not_in_roster' : 'removed';
  } catch (e) {
    // 납부 기록이 이 명단 행을 가리킨다. 사전 확인 대신 FK에 맡기는 이유: 확인과 삭제 사이에
    // 납부 체크가 끼어들 수 있고, FK는 그 경합까지 막는다.
    if (isForeignKeyViolation(e, 'dues_payments_roster_fk')) return 'paid';
    throw e;
  }
}
```

- [ ] **Step 4: `lib/db/queries.ts` — 명단 조회와 회차 목록 인원**

import에 `duesRoundMembers`를 추가한다.

`getRoundPaidMembershipIds` 아래에 추가:

```ts
/**
 * 회차 명단 — 총무 먼저, 이후 합류일 순(미납 문구 순서가 매번 같아야 한다).
 * `left`는 **지금** 떠난 상태인지다. roundId의 모임 스코프는 호출자가 getRound로 먼저 확인한다.
 */
export async function getRoundRoster(roundId: string) {
  return db
    .select({
      membershipId: duesRoundMembers.membershipId,
      displayName: memberships.displayName,
      left: sql<boolean>`${memberships.leftAt} is not null`,
    })
    .from(duesRoundMembers)
    .innerJoin(memberships, eq(memberships.id, duesRoundMembers.membershipId))
    .where(eq(duesRoundMembers.roundId, roundId))
    .orderBy(
      sql`case when ${memberships.role} = 'owner' then 0 else 1 end`,
      asc(memberships.joinedAt),
    );
}
```

`getRoundsWithCounts`의 select에 추가한다(납부 수와 같은 쿼리에서 — N+1 금지):

```ts
      rosterCount: sql<number>`(select count(*)::int from ${duesRoundMembers} where ${duesRoundMembers.roundId} = ${duesRounds.id})`,
```

- [ ] **Step 5: `actions/dues.ts`**

import에 추가:

```ts
import { isForeignKeyViolation, isUniqueViolation } from '@/lib/db/errors';
import { addToRoster, removeFromRoster, snapshotRoster } from '@/lib/db/roster';
```

(기존 `isUniqueViolation` 단독 import 줄은 위 줄로 바꾼다.)

`createRound`의 `await db.insert(duesRounds).values({...});`를 트랜잭션으로 감싼다:

```ts
      await db.transaction(async (tx) => {
        await tx.insert(duesRounds).values({
          id,
          groupId: ctx.groupId,
          period,
          amountPerPerson: parsedInput.amountPerPerson,
        });
        // 명단은 이 순간의 활동 중 멤버로 고정된다(ADR-005 D1).
        await snapshotRoster(tx, ctx.groupId, id);
      });
```

(바깥 `try { … } catch (e) { if (isUniqueViolation(e)) … }`는 그대로 둔다.)

`markPaid`의 catch 블록 맨 앞에 추가한다:

```ts
      // 명단 밖 사람이다. 판정은 dues_payments_roster_fk가 한다 — 사전 조회는 면제와의 경합을 막지 못한다.
      // 트랜잭션이므로 원장 엔트리도 함께 롤백된다.
      if (isForeignKeyViolation(e, 'dues_payments_roster_fk')) throw new ActionError('NOT_IN_ROSTER');
```

파일 끝(`revalidatePayment` 위)에 두 액션을 추가한다:

```ts
const rosterInput = z.object({ groupId: z.string(), roundId: z.string(), membershipId: z.string() });

/** 회차 명단에 활동 중 멤버를 넣는다 — 월 중간 합류자 등(ADR-005 D3). 이미 있으면 멱등 성공. */
export const addToRound = groupActionClient
  .inputSchema(rosterInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const round = await getRound(ctx.groupId, parsedInput.roundId);
    if (!round) throw new ActionError('ROUND_NOT_FOUND');
    const result = await addToRoster(ctx.groupId, round.id, parsedInput.membershipId);
    if (result === 'not_active') throw new ActionError('NOT_MEMBER');
    revalidatePayment(ctx.groupId, round.id);
    return { already: result === 'already' };
  });

/** 회차 명단에서 뺀다(면제). 납부한 사람은 먼저 납부를 취소해야 한다. */
export const removeFromRound = groupActionClient
  .inputSchema(rosterInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const round = await getRound(ctx.groupId, parsedInput.roundId);
    if (!round) throw new ActionError('ROUND_NOT_FOUND');
    const result = await removeFromRoster(ctx.groupId, round.id, parsedInput.membershipId);
    if (result === 'not_in_roster') throw new ActionError('NOT_IN_ROSTER');
    if (result === 'paid') throw new ActionError('PAID_MEMBER');
    revalidatePayment(ctx.groupId, round.id);
    return { removed: true };
  });
```

> 면제·추가는 사용자 id를 기록하지 않는 쓰기라 `assertActiveUser`가 필요 없다(`createRound`와 같다). 탈퇴한 총무는 세션 단계에서 이미 막힌다.

- [ ] **Step 6: 통합 테스트 통과 확인**

Run: `npx dotenv -e .env.test -- vitest run --project integration test/member-lifecycle.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: `roster-actions.tsx` — 면제·추가 버튼**

`app/groups/[groupId]/dues/[roundId]/roster-actions.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { addToRound, removeFromRound } from '@/actions/dues';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
  FORBIDDEN: '총무만 명단을 고칠 수 있습니다.',
  ROUND_NOT_FOUND: '회차를 찾을 수 없습니다.',
  NOT_MEMBER: '모임의 활동 중인 멤버가 아닙니다.',
  NOT_IN_ROSTER: '이미 명단에 없습니다.',
  PAID_MEMBER: '납부한 사람은 뺄 수 없습니다. 납부를 먼저 취소하세요.',
};

type Props = { groupId: string; roundId: string; membershipId: string; displayName: string };

/** 실패 코드 → 문구. 세션 만료는 문구 대신 로그인으로 보낸다(payment-toggle과 같은 처리). */
function messageOf(code: string | undefined): string | null {
  if (!code || code === 'UNAUTHENTICATED') return null;
  return ERRORS[code] ?? '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

function useLoginRedirect(groupId: string, roundId: string) {
  const router = useRouter();
  return ({ error }: { error: { serverError?: string } }) => {
    if (error.serverError === 'UNAUTHENTICATED') router.push(`/login?next=/groups/${groupId}/dues/${roundId}`);
  };
}

/** 면제 — 이 회차의 의무에서 뺀다. 되돌리려면 명단에 다시 넣으면 된다. */
export function RosterRemoveButton({ groupId, roundId, membershipId, displayName }: Props) {
  const { execute, isPending, result } = useAction(removeFromRound, { onError: useLoginRedirect(groupId, roundId) });
  const message = messageOf(result.serverError);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="roster-remove"
        aria-label={`${displayName} 면제`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          if (!window.confirm(`${displayName}을(를) 이 회차 명단에서 뺄까요? 예상 금액이 줄어듭니다.`)) return;
          execute({ groupId, roundId, membershipId });
        }}
      >
        {isPending ? '빼는 중…' : '면제'}
      </Button>
      {message && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {message}
        </p>
      )}
    </>
  );
}

export function RosterAddButton({ groupId, roundId, membershipId, displayName }: Props) {
  const { execute, isPending, result } = useAction(addToRound, { onError: useLoginRedirect(groupId, roundId) });
  const message = messageOf(result.serverError);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="roster-add"
        aria-label={`${displayName} 명단에 추가`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          execute({ groupId, roundId, membershipId });
        }}
      >
        {isPending ? '추가 중…' : '추가'}
      </Button>
      {message && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {message}
        </p>
      )}
    </>
  );
}
```

`payment-toggle.tsx`의 `ERRORS`에 한 줄 추가:

```ts
  NOT_IN_ROSTER: '이 회차 명단에 없는 사람입니다.',
```

- [ ] **Step 8: 회차 화면 — `app/groups/[groupId]/dues/[roundId]/page.tsx`**

import를 바꾼다:

```ts
import {
  getGroupForMember,
  getGroupMembers,
  getRound,
  getRoundPaidMembershipIds,
  getRoundRoster,
} from '@/lib/db/queries';
import { noticeNames, rosterLabel, roundTotals, unpaidMembers } from '@/lib/domain/dues';
import { RosterAddButton, RosterRemoveButton } from './roster-actions';
```

(기존 `@/lib/db/queries`·`@/lib/domain/dues` import 줄을 위 내용으로 교체한다. 다른 import는 그대로.)

`const [members, paidIds] = …`부터 `const overpaid = outstanding < 0;`까지를 아래로 교체한다:

```ts
  const [roster, paidIds, members] = await Promise.all([
    getRoundRoster(round.id),
    getRoundPaidMembershipIds(round.id),
    getGroupMembers(groupId),
  ]);

  // 수치·미납·납부는 모두 **회차 명단**에서 나온다 — 지금 명단이 아니다(ADR-005 D1).
  // 납부는 명단 안에서만 존재하므로(dues_payments_roster_fk) 미납액이 음수가 될 수 없다.
  const paidSet = new Set(paidIds);
  const unpaid = unpaidMembers(roster, paidIds);
  const paid = roster.filter((m) => paidSet.has(m.membershipId));
  const { expected, collected, outstanding } = roundTotals(round.amountPerPerson, roster.length, paidIds);

  // 명단 추가 후보 — 활동 중인데 이 회차 명단에 없는 사람(월 중간 합류자 등).
  const inRoster = new Set(roster.map((m) => m.membershipId));
  const addable = members.filter((m) => !inRoster.has(m.id));

  // 단톡방 문구에는 활동 중인 미납자만 — 나간 사람은 그 방에 없다. 나간 미납자는 화면에만 남는다.
  const names = noticeNames(unpaid);
```

`notice` 계산의 이름 부분을 바꾼다:

```ts
  const notice = [
    `${round.period} 회비(${formatAmount(round.amountPerPerson)}원) 미납: ${names.join(', ')}`,
    ...(accountLabel ? [`계좌: ${accountLabel}`] : []),
  ].join('\n');
```

'미납' Stat의 값을 `<Amount value={outstanding} size="md" unit tone="plain" />`로 바꾸고, 그 아래 `{overpaid ? (<p role="alert" …>…</p>) : null}` 블록을 통째로 지운다.

미납 행 렌더(`unpaid.map((m) => (`…)를 아래로 교체한다:

```tsx
              unpaid.map((m) => (
                <Row key={m.membershipId} testId="payment-row">
                  <Cell>{rosterLabel(m)}</Cell>
                  <Cell align="right">
                    {isOwner ? (
                      <span className="inline-flex items-start gap-2">
                        <RosterRemoveButton
                          groupId={groupId}
                          roundId={round.id}
                          membershipId={m.membershipId}
                          displayName={m.displayName}
                        />
                        <PaymentToggle
                          groupId={groupId}
                          roundId={round.id}
                          membershipId={m.membershipId}
                          displayName={m.displayName}
                          paid={false}
                        />
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted">미납</span>
                    )}
                  </Cell>
                </Row>
              ))
```

납부 완료 행의 `<Cell>{m.displayName}</Cell>`도 `<Cell>{rosterLabel(m)}</Cell>`로 바꾼다.

`</details>` 바로 뒤, 미납 안내 문구 섹션 **앞**에 명단 추가 섹션을 넣는다(총무만, 후보가 있을 때만):

```tsx
      {isOwner && addable.length > 0 ? (
        <section className="mt-7 border-t-2 border-ink pt-4" data-testid="roster-addable">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
            명단에 없는 멤버
          </h2>
          <p className="mt-2 text-[12px] leading-[1.7] text-muted">
            회차를 만든 뒤 합류한 사람입니다. 이 회차에도 내야 하면 추가하세요.
          </p>
          <div className="mt-3">
            <DataTable>
              {addable.map((m) => (
                <Row key={m.id} testId="roster-addable-row">
                  <Cell>{m.displayName}</Cell>
                  <Cell align="right">
                    <RosterAddButton
                      groupId={groupId}
                      roundId={round.id}
                      membershipId={m.id}
                      displayName={m.displayName}
                    />
                  </Cell>
                </Row>
              ))}
            </DataTable>
          </div>
        </section>
      ) : null}
```

미납 안내 문구 섹션의 조건 `{unpaid.length > 0 ? (`를 `{names.length > 0 ? (`로 바꾼다 — 미납자가 전부 나간 사람이면 붙일 문구가 없다.

- [ ] **Step 9: 회비 목록 — `app/groups/[groupId]/dues/page.tsx`**

`getGroupMembers` import와 호출을 지운다:

```ts
import { getGroupForMember, getRoundsWithCounts } from '@/lib/db/queries';
```

```ts
  const rounds = await getRoundsWithCounts(groupId);
```

`const memberCount = members.length;` 줄을 지우고, 납부 칸을 바꾼다:

```tsx
                    {/* 납부 n/N — N은 그 회차의 명단 인원이다(ADR-005 D1). */}
                    <span className="num" data-testid="round-paid-count">
                      {r.paidCount}/{r.rosterCount}
                    </span>
```

- [ ] **Step 10: 전체 확인**

Run: `npm test && npm run test:integration && npx tsc --noEmit && npm run lint && npm run build`
Expected: 전부 통과.

**변이 확인:** `snapshotRoster` 호출을 지우고 돌려 "만드는 순간의 활동 중 멤버만" 테스트가 빨개지는 것을 본다. 확인 후 되돌린다.

- [ ] **Step 11: 커밋**

```bash
git add lib/db/roster.ts lib/db/queries.ts actions/dues.ts "app/groups/[groupId]/dues" test/member-lifecycle.integration.test.ts
git commit -m "feat: 회차 명단을 생성 시점에 고정하고 총무가 면제·추가한다

수치·미납·안내 문구가 지금 명단이 아니라 회차 명단에서 나온다. 안내 문구에는
활동 중인 미납자만 들어가고, 나간 미납자는 화면에 (나감)으로 남는다.
납부 > 명단 상태가 표현 불가능해져 overpaid 분기를 지웠다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
```

---

## Task 5: 나가기 · 내보내기 · 되살리기 · 재가입 · 탈퇴 연결

**Files:**
- Create: `lib/db/membership.ts`
- Modify: `actions/membership.ts` (`joinByInvite` 재작성, 신규 `leaveGroup`·`removeMember`·`restoreMember`)
- Modify: `lib/db/anonymize.ts` (탈퇴 시 `withdrawn`)
- Modify: `test/member-lifecycle.integration.test.ts`, `test/account-delete.integration.test.ts`

- [ ] **Step 1: 실패하는 테스트 — 생명주기 통합 테스트에 추가**

액션 import 아래에 추가:

```ts
const { joinByInvite, leaveGroup, removeMember, restoreMember } = await import('@/actions/membership');
```

헬퍼(파일 위쪽 `markLeft` 아래)에 추가:

```ts
async function membershipState(m: Member) {
  const [row] = await db
    .select({ leftAt: memberships.leftAt, leftReason: memberships.leftReason, displayName: memberships.displayName })
    .from(memberships)
    .where(eq(memberships.id, m.membershipId));
  return row;
}
```

파일 끝에 추가:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx dotenv -e .env.test -- vitest run --project integration test/member-lifecycle.integration.test.ts`
Expected: `leaveGroup` 등 import 실패.

- [ ] **Step 3: `lib/db/membership.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { memberships } from '@/lib/db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 멤버십 상태 전이(ADR-005). 모두 **비교-후-갱신**이다 — WHERE에 기대하는 이전 상태를 넣고
 * 갱신된 행 수로 성공을 판정한다. 읽고 나서 쓰는 사이에 다른 요청이 상태를 바꿔도
 * (예: 되살리는 동안 탈퇴가 `withdrawn`으로 덮음) 잘못된 전이가 일어나지 않는다.
 * 반드시 `assertActiveUser`와 같은 트랜잭션 안에서 부른다(ADR-004 동시성).
 */

/** 활동 중 → left. 총무 여부는 호출자가 먼저 본다. */
export async function markLeftSelf(tx: Tx, membershipId: string): Promise<boolean> {
  const rows = await tx
    .update(memberships)
    .set({ leftAt: new Date(), leftReason: 'left' })
    .where(and(eq(memberships.id, membershipId), isNull(memberships.leftAt)))
    .returning({ id: memberships.id });
  return rows.length > 0;
}

/** 활동 중인 **멤버**(총무 아님) → removed. 총무 자신·남의 모임·이미 떠난 사람은 0행이다. */
export async function markRemoved(tx: Tx, groupId: string, membershipId: string): Promise<boolean> {
  const rows = await tx
    .update(memberships)
    .set({ leftAt: new Date(), leftReason: 'removed' })
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.groupId, groupId),
        eq(memberships.role, 'member'),
        isNull(memberships.leftAt),
      ),
    )
    .returning({ id: memberships.id });
  return rows.length > 0;
}

/** removed → 활동 중. `left`·`withdrawn`은 되살리지 않는다(스스로 나간 사람은 링크로 돌아온다). */
export async function restoreRemoved(tx: Tx, groupId: string, membershipId: string): Promise<boolean> {
  const rows = await tx
    .update(memberships)
    .set({ leftAt: null, leftReason: null })
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.groupId, groupId),
        eq(memberships.leftReason, 'removed'),
      ),
    )
    .returning({ id: memberships.id });
  return rows.length > 0;
}

/** left → 활동 중 + 새 이름. 초대 링크 재가입 전용. */
export async function rejoinLeft(tx: Tx, membershipId: string, displayName: string): Promise<boolean> {
  const rows = await tx
    .update(memberships)
    .set({ leftAt: null, leftReason: null, displayName })
    .where(and(eq(memberships.id, membershipId), eq(memberships.leftReason, 'left')))
    .returning({ id: memberships.id });
  return rows.length > 0;
}
```

- [ ] **Step 4: `actions/membership.ts`**

파일 전체를 아래로 바꾼다(기존 `joinByInvite`의 생성 경로와 유니크 경합 처리는 그대로 옮겨 온다).

```ts
'use server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { ActionError, assertOwner, authActionClient, groupActionClient } from './clients';
import { db } from '@/lib/db';
import { assertActiveUser } from '@/lib/db/anonymize';
import { isUniqueViolation } from '@/lib/db/errors';
import { markLeftSelf, markRemoved, rejoinLeft, restoreRemoved } from '@/lib/db/membership';
import { groups, memberships } from '@/lib/db/schema';
import { joinDecision } from '@/lib/domain/member';

export const joinByInvite = authActionClient
  .inputSchema(z.object({ token: z.string(), displayName: z.string().min(1).max(20) }))
  .action(async ({ parsedInput, ctx }) => {
    const group = await db.query.groups.findFirst({ where: eq(groups.inviteToken, parsedInput.token) });
    if (!group) throw new ActionError('INVALID_INVITE');
    const existing = await db.query.memberships.findFirst({
      where: and(eq(memberships.groupId, group.id), eq(memberships.userId, ctx.userId)),
    });
    const decision = joinDecision(existing ? { leftReason: existing.leftReason } : null);

    if (decision === 'already') return { groupId: group.id, already: true };
    // 내보내진 사람이 링크로 돌아오면 내보내기가 링크 재발급 없이는 의미가 없다(ADR-005 D4).
    if (decision === 'blocked') throw new ActionError('REMOVED_FROM_GROUP');

    if (decision === 'rejoin') {
      const rejoined = await db.transaction(async (tx) => {
        await assertActiveUser(tx, ctx.userId);
        return rejoinLeft(tx, existing!.id, parsedInput.displayName);
      });
      if (!rejoined) {
        // 읽은 뒤 상태가 바뀌었다 — 동시 재가입(이미 돌아옴)이거나 총무가 그 사이에 바꿨다.
        const now = await db.query.memberships.findFirst({ where: eq(memberships.id, existing!.id) });
        if (now?.leftReason == null) return { groupId: group.id, already: true };
        throw new ActionError('REMOVED_FROM_GROUP');
      }
      revalidatePath('/groups');
      return { groupId: group.id, already: false };
    }

    try {
      // 합류도 `memberships.user_id`에 사용자 id를 **기록하는** 쓰기다 — 탈퇴 확인이 이
      // insert와 같은 트랜잭션 안에 있어야 한다(ADR-004 동시성).
      await db.transaction(async (tx) => {
        await assertActiveUser(tx, ctx.userId);
        await tx.insert(memberships).values({
          id: crypto.randomUUID(), userId: ctx.userId, groupId: group.id,
          role: 'member', displayName: parsedInput.displayName,
        });
      });
    } catch (e) {
      // 동시 합류 레이스: 유니크 인덱스(memberships_user_group)가 최종 방어선.
      // 진 쪽도 "이미 멤버"와 같은 결과로 본다.
      if (isUniqueViolation(e)) {
        revalidatePath('/groups');
        return { groupId: group.id, already: true };
      }
      throw e;
    }
    revalidatePath('/groups');
    return { groupId: group.id, already: false };
  });

/** 멤버 본인이 모임을 떠난다. 총무는 떠날 수 없다 — 위임이 먼저다(요구사항 P1). */
export const leaveGroup = groupActionClient
  .inputSchema(z.object({ groupId: z.string() }))
  .action(async ({ ctx }) => {
    if (ctx.role === 'owner') throw new ActionError('OWNER_CANNOT_LEAVE');
    const left = await db.transaction(async (tx) => {
      await assertActiveUser(tx, ctx.userId);
      return markLeftSelf(tx, ctx.membershipId);
    });
    // 미들웨어 통과 뒤 다른 요청이 먼저 떠나게 했다(동시 클릭·내보내기).
    if (!left) throw new ActionError('NOT_MEMBER');
    revalidatePath('/groups');
    return { left: true };
  });

const memberInput = z.object({ groupId: z.string(), membershipId: z.string() });

/** 총무가 멤버를 내보낸다. 기록은 남고 접근만 끊긴다. 총무 자신은 대상이 아니다. */
export const removeMember = groupActionClient
  .inputSchema(memberInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const removed = await db.transaction(async (tx) => {
      await assertActiveUser(tx, ctx.userId);
      return markRemoved(tx, ctx.groupId, parsedInput.membershipId);
    });
    if (!removed) throw new ActionError('NOT_MEMBER');
    revalidatePath(`/groups/${ctx.groupId}/settings`);
    return { removed: true };
  });

/** 내보낸 멤버를 되살린다. 스스로 나간 사람·탈퇴자는 대상이 아니다. */
export const restoreMember = groupActionClient
  .inputSchema(memberInput)
  .action(async ({ parsedInput, ctx }) => {
    assertOwner(ctx.role);
    const restored = await db.transaction(async (tx) => {
      await assertActiveUser(tx, ctx.userId);
      return restoreRemoved(tx, ctx.groupId, parsedInput.membershipId);
    });
    if (!restored) throw new ActionError('NOT_REMOVED');
    revalidatePath(`/groups/${ctx.groupId}/settings`);
    return { restored: true };
  });
```

> `groupActionClient`의 ctx에 `membershipId`가 이미 있다(`actions/clients.ts`). `existing!`의 `!`는 `decision`이 `rejoin`이면 `existing`이 있다는 `joinDecision`의 계약에서 온다.

- [ ] **Step 5: 통과 확인**

Run: `npx dotenv -e .env.test -- vitest run --project integration test/member-lifecycle.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: 탈퇴 연결 — 실패하는 테스트 (`test/account-delete.integration.test.ts`)**

액션 import 줄들 아래에 추가:

```ts
const { restoreMember } = await import('@/actions/membership');
```

테스트 3 다음에 추가:

```ts
  it('3b. 탈퇴하면 모든 멤버십이 withdrawn이 된다 — 이미 내보내진 것도 덮어 되살릴 수 없게 한다', async () => {
    const fx = await seed();
    // 두 번째 모임: 탈퇴자는 거기서 이미 내보내진 상태다.
    const gid2 = crypto.randomUUID();
    await db.insert(groups).values({ id: gid2, name: '둘째모임', inviteToken: newToken(), publicToken: newPublicToken() });
    await db.insert(memberships).values({
      id: crypto.randomUUID(), userId: fx.owner.userId, groupId: gid2, role: 'owner', displayName: '영희',
    });
    const removedAt = new Date('2026-03-01T00:00:00Z');
    const removedId = crypto.randomUUID();
    await db.insert(memberships).values({
      id: removedId, userId: fx.leaver.userId, groupId: gid2, role: 'member', displayName: '민지',
      leftAt: removedAt, leftReason: 'removed',
    });

    expect((await withdraw(fx.leaver))?.serverError).toBeUndefined();

    const mine = await db.select().from(memberships).where(eq(memberships.userId, fx.leaver.userId));
    expect(mine).toHaveLength(2);
    expect(mine.every((m) => m.leftReason === 'withdrawn'), '탈퇴자의 멤버십이 withdrawn이 아니다').toBe(true);
    expect(mine.find((m) => m.id === fx.leaverMembershipId)!.leftAt).toBeInstanceOf(Date);
    // 이미 떠난 시각은 보존한다 — 언제 모임을 떠났는가는 탈퇴로 바뀌는 사실이 아니다.
    expect(mine.find((m) => m.id === removedId)!.leftAt?.toISOString()).toBe(removedAt.toISOString());

    // 이름이 파기된 멤버십을 총무가 되살릴 수 없다.
    as(fx.owner);
    expect((await restoreMember({ groupId: gid2, membershipId: removedId }))?.serverError).toBe('NOT_REMOVED');
  });
```

(`groups`·`newToken`·`newPublicToken`은 이 파일이 이미 import한다. 없으면 추가한다.)

Run: `npx dotenv -e .env.test -- vitest run --project integration test/account-delete.integration.test.ts`
Expected: 3b FAIL — `leftReason`이 null.

- [ ] **Step 7: `lib/db/anonymize.ts` — 멤버십 표시 이름 갱신에 상태를 함께 쓴다**

`anonymizeUserRows`의 `tx.update(memberships).set({ displayName: ANONYMOUS_MEMBER_NAME })`를 아래로 바꾼다(drizzle-orm에서 `sql`을 import한다):

```ts
    await tx
      .update(memberships)
      .set({
        displayName: ANONYMOUS_MEMBER_NAME,
        // 탈퇴는 모든 모임을 떠나는 것이다(ADR-005). 이미 떠난 시각은 보존하고, 사유는
        // `withdrawn`으로 **덮는다** — `removed`로 남으면 총무가 이름이 파기된 멤버십을 되살릴 수 있다.
        leftReason: 'withdrawn',
        leftAt: sql`coalesce(${memberships.leftAt}, now())`,
      })
      .where(eq(memberships.userId, userId));
```

- [ ] **Step 8: 통과 확인**

Run: `npm run test:integration && npx tsc --noEmit && npm run lint`
Expected: 전부 PASS. 기존 `moneyState`는 `display_name`만 비교하므로 영향이 없다.

**변이 확인:** `restoreRemoved`의 `eq(memberships.leftReason, 'removed')`를 `isNotNull(memberships.leftAt)`로 바꿔 3b와 "스스로 나간 사람은 되살릴 수 없다"가 빨개지는 것을 본다. 확인 후 되돌린다.

- [ ] **Step 9: 커밋**

```bash
git add lib/db/membership.ts lib/db/anonymize.ts actions/membership.ts test/
git commit -m "feat: 나가기·내보내기·되살리기와 초대 링크 재가입

스스로 나간 사람은 같은 멤버십으로 돌아오고, 내보내진 사람은 링크로 돌아올 수
없다. 탈퇴는 모든 멤버십을 withdrawn으로 덮어 되살리기를 막는다. 상태 전이는
모두 비교-후-갱신이다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
```

---

## Task 6: 이름 입력 검증 — 공백만·예약 이름 거절

**Files:**
- Modify: `actions/clients.ts` (헬퍼), `actions/group.ts` (`createGroup`), `actions/membership.ts` (`joinByInvite`)
- Modify: `app/groups/new-group-form.tsx`, `app/invite/[token]/join-form.tsx`
- Modify: `test/member-lifecycle.integration.test.ts`

- [ ] **Step 1: 실패하는 테스트 — 생명주기 통합 테스트 끝에 추가**

액션 import에 `createGroup`을 추가한다:

```ts
const { createGroup } = await import('@/actions/group');
```

```ts
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
```

> 첫 두 테스트는 "멤버십 없는 사용자"가 필요해 `addMember` 후 멤버십 행만 지운다. 납부·정산이 없는 새 행이라 지울 수 있다.

- [ ] **Step 2: 실패 확인**

Run: `npx dotenv -e .env.test -- vitest run --project integration test/member-lifecycle.integration.test.ts`
Expected: 새 describe FAIL(이름이 그대로 저장되거나 성공함).

- [ ] **Step 3: `actions/clients.ts`에 헬퍼**

```ts
import { MemberRuleError, parseDisplayName } from '@/lib/domain/member';

/** 표시 이름 검증을 액션 코드로 옮긴다. 화면이 코드별 문구를 고르므로 zod가 아니라 여기서 본다. */
export function displayNameOrThrow(input: string): string {
  try {
    return parseDisplayName(input);
  } catch (e) {
    throw e instanceof MemberRuleError ? new ActionError(e.code) : e;
  }
}
```

- [ ] **Step 4: 두 액션에 적용**

`actions/group.ts` — import에 `displayNameOrThrow`를 추가하고 `createGroup` 본문 첫 줄에:

```ts
    const displayName = displayNameOrThrow(parsedInput.displayName);
```

그리고 memberships insert의 `displayName: parsedInput.displayName`을 `displayName`으로 바꾼다.

`actions/membership.ts` — import에 `displayNameOrThrow`를 추가하고 `joinByInvite` 본문 첫 줄에:

```ts
    const displayName = displayNameOrThrow(parsedInput.displayName);
```

그리고 `rejoinLeft(tx, existing!.id, parsedInput.displayName)`와 insert의 `displayName: parsedInput.displayName`을 모두 `displayName`으로 바꾼다. 이름 검사가 **초대 토큰 확인보다 먼저**라 잘못된 토큰+잘못된 이름이면 이름 오류가 먼저 나온다 — 화면에서 고칠 수 있는 쪽을 먼저 알려주는 것이라 그대로 둔다.

- [ ] **Step 5: 화면 문구**

`app/invite/[token]/join-form.tsx`의 `errorMessage`를 아래로 바꾼다:

```tsx
  const ERRORS: Record<string, string> = {
    INVALID_INVITE: '만료되었거나 잘못된 초대 링크입니다.',
    INVALID_NAME: '이름을 입력해 주세요.',
    RESERVED_NAME: '이 이름은 쓸 수 없습니다. 다른 이름을 입력해 주세요.',
    REMOVED_FROM_GROUP: '이 모임에서 내보내져 링크로 다시 들어올 수 없습니다. 총무에게 문의해 주세요.',
  };
  const serverError = result.serverError;
  const errorMessage =
    serverError && serverError !== 'UNAUTHENTICATED'
      ? (ERRORS[serverError] ?? '합류에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      : null;
```

(`ERRORS`는 컴포넌트 밖 모듈 상수로 둔다 — 다른 폼과 같은 위치.)

`app/groups/new-group-form.tsx`의 오류 문단을 바꾼다:

```tsx
      {result.serverError && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {NAME_ERRORS[result.serverError] ?? '모임 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.'}
        </p>
      )}
```

파일 상단(컴포넌트 밖)에:

```tsx
const NAME_ERRORS: Record<string, string> = {
  INVALID_NAME: '모임에서 쓸 내 이름을 입력해 주세요.',
  RESERVED_NAME: '이 이름은 쓸 수 없습니다. 다른 이름을 입력해 주세요.',
};
```

- [ ] **Step 6: 확인**

Run: `npm run test:integration && npx tsc --noEmit && npm run lint`
Expected: 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add actions/clients.ts actions/group.ts actions/membership.ts app/groups/new-group-form.tsx "app/invite/[token]/join-form.tsx" test/member-lifecycle.integration.test.ts
git commit -m "feat: 표시 이름의 공백만 입력과 파기 표지 이름을 거절한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
```

---

## Task 7: 화면 — 나가기 패널, 내보내기·되살리기, 나간 멤버 목록

**Files:**
- Create: `app/groups/[groupId]/leave-group-panel.tsx`
- Modify: `app/groups/[groupId]/page.tsx`
- Create: `app/groups/[groupId]/settings/member-actions.tsx`
- Modify: `app/groups/[groupId]/settings/page.tsx`

이 태스크의 동작 검증은 Task 8의 E2E가 한다. 여기서는 빌드·타입·린트를 통과시키고 화면을 한 번 띄워 본다.

- [ ] **Step 1: `app/groups/[groupId]/leave-group-panel.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { leaveGroup } from '@/actions/membership';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
  OWNER_CANNOT_LEAVE: '총무는 모임을 나갈 수 없습니다.',
  NOT_MEMBER: '이미 모임을 나갔습니다.',
};

/**
 * 멤버 본인의 나가기. 되돌릴 수 있는 동작이라(초대 링크로 다시 들어온다) 타이핑 확인 대신
 * `confirm` 한 번이다 — 되돌릴 수 없는 모임 삭제·탈퇴와 다른 무게.
 */
export default function LeaveGroupPanel({ groupId, groupName }: { groupId: string; groupName: string }) {
  const router = useRouter();
  const { execute, isPending, result } = useAction(leaveGroup, {
    onSuccess() {
      router.replace('/groups');
      router.refresh();
    },
    onError({ error }) {
      if (error.serverError === 'UNAUTHENTICATED') router.push(`/login?next=/groups/${groupId}`);
    },
  });
  const code = result.serverError;
  const errorMessage =
    code && code !== 'UNAUTHENTICATED' ? (ERRORS[code] ?? '나가기에 실패했습니다. 잠시 후 다시 시도해 주세요.') : null;

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-[1.7]">
        나가면 이 모임의 장부를 더 볼 수 없습니다. 남긴 기록은 그대로이고, 이미 명단에 있던 회차의 미납도
        남습니다. 초대 링크로 다시 들어올 수 있습니다.
      </p>
      <Button
        variant="outline"
        type="button"
        data-testid="leave-group"
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          if (!window.confirm(`${groupName}에서 나갈까요?`)) return;
          execute({ groupId });
        }}
      >
        {isPending ? '나가는 중…' : '모임 나가기'}
      </Button>
      {errorMessage && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 대시보드에 붙인다 — `app/groups/[groupId]/page.tsx`**

import에 `import LeaveGroupPanel from './leave-group-panel';`를 추가하고, `</main>` 바로 앞에:

```tsx
      {/* 멤버 전용. 총무는 떠날 수 없다(위임은 P1) — 설정의 위험 구역이 총무의 자리다. */}
      {membership.role !== 'owner' ? (
        <section className="pt-14">
          <h2 className="font-display text-[12px] font-bold tracking-[0.14em] text-ink uppercase">모임 나가기</h2>
          <div className="mt-4 border-t-2 border-ink pt-5">
            <LeaveGroupPanel groupId={groupId} groupName={group.name} />
          </div>
        </section>
      ) : null}
```

- [ ] **Step 3: `app/groups/[groupId]/settings/member-actions.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { removeMember, restoreMember } from '@/actions/membership';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
  FORBIDDEN: '총무만 할 수 있습니다.',
  NOT_MEMBER: '이미 모임에 없는 멤버입니다.',
  NOT_REMOVED: '내보낸 멤버만 되살릴 수 있습니다.',
};

type Props = { groupId: string; membershipId: string; displayName: string };

function messageOf(code: string | undefined): string | null {
  if (!code || code === 'UNAUTHENTICATED') return null;
  return ERRORS[code] ?? '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

function useLoginRedirect(groupId: string) {
  const router = useRouter();
  return ({ error }: { error: { serverError?: string } }) => {
    if (error.serverError === 'UNAUTHENTICATED') router.push(`/login?next=/groups/${groupId}/settings`);
  };
}

/** 내보내기 — 기록은 남고 접근만 끊긴다. 되살릴 수 있으므로 confirm 한 번. */
export function RemoveMemberButton({ groupId, membershipId, displayName }: Props) {
  const { execute, isPending, result } = useAction(removeMember, { onError: useLoginRedirect(groupId) });
  const message = messageOf(result.serverError);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="remove-member"
        aria-label={`${displayName} 내보내기`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          if (!window.confirm(`${displayName}을(를) 내보낼까요? 기록은 남고, 초대 링크로는 다시 들어올 수 없습니다.`)) {
            return;
          }
          execute({ groupId, membershipId });
        }}
      >
        {isPending ? '내보내는 중…' : '내보내기'}
      </Button>
      {message && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {message}
        </p>
      )}
    </>
  );
}

export function RestoreMemberButton({ groupId, membershipId, displayName }: Props) {
  const { execute, isPending, result } = useAction(restoreMember, { onError: useLoginRedirect(groupId) });
  const message = messageOf(result.serverError);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="restore-member"
        aria-label={`${displayName} 되살리기`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          execute({ groupId, membershipId });
        }}
      >
        {isPending ? '되살리는 중…' : '되살리기'}
      </Button>
      {message && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {message}
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 4: 설정 화면 — `app/groups/[groupId]/settings/page.tsx`**

import를 바꾼다:

```ts
import { getGroupForMember, getGroupMembers, getLeftMembers } from '@/lib/db/queries';
import { RemoveMemberButton, RestoreMemberButton } from './member-actions';
```

`const members = await getGroupMembers(groupId);`를 바꾼다:

```ts
  const [members, leftMembers] = await Promise.all([getGroupMembers(groupId), getLeftMembers(groupId)]);
```

멤버 행의 오른쪽 칸을 바꾼다(날짜 옆에 내보내기 — 총무 자신 행에는 없다):

```tsx
                <Cell align="right">
                  <span className="inline-flex items-start gap-3">
                    <span className="num text-[13px] font-medium text-muted">{formatDateKst(m.joinedAt)}</span>
                    {m.role !== 'owner' ? (
                      <RemoveMemberButton groupId={groupId} membershipId={m.id} displayName={m.displayName} />
                    ) : null}
                  </span>
                </Cell>
```

멤버 섹션(`</section>`) 바로 뒤에 "나간 멤버" 섹션을 넣는다(있을 때만):

```tsx
      {leftMembers.length > 0 ? (
        <section className="pt-10">
          <h2 className="font-display text-[12px] font-bold tracking-[0.14em] text-ink uppercase">
            나간 멤버 {leftMembers.length}명
          </h2>
          <div className="mt-4">
            <DataTable>
              {leftMembers.map((m) => (
                <Row key={m.id} testId="left-member-row">
                  <Cell>
                    <span className="font-bold">{m.displayName}</span>
                    <span className="text-[12px] text-muted"> · {LEFT_REASON_LABEL[m.leftReason!]}</span>
                  </Cell>
                  <Cell align="right">
                    <span className="inline-flex items-start gap-3">
                      <span className="num text-[13px] font-medium text-muted">{formatDateKst(m.leftAt!)}</span>
                      {/* 스스로 나간 사람은 초대 링크로 돌아온다. 탈퇴자는 이름이 파기돼 되살릴 대상이 아니다. */}
                      {m.leftReason === 'removed' ? (
                        <RestoreMemberButton groupId={groupId} membershipId={m.id} displayName={m.displayName} />
                      ) : null}
                    </span>
                  </Cell>
                </Row>
              ))}
            </DataTable>
          </div>
        </section>
      ) : null}
```

파일 상단(컴포넌트 밖)에:

```ts
const LEFT_REASON_LABEL: Record<'left' | 'removed' | 'withdrawn', string> = {
  left: '스스로 나감',
  removed: '내보냄',
  withdrawn: '탈퇴',
};
```

> `getLeftMembers`는 `isNotNull(leftAt)`로 거르고 CHECK 제약이 둘을 함께 채우게 하므로 `!`가 안전하다. `formatDateKst`의 인자 타입이 `Date`인지 확인한다(`lib/format.ts`).

- [ ] **Step 5: 빌드·화면 확인**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 통과.

`npm run dev`로 띄워 로컬 dev DB에서 총무 설정 화면·멤버 대시보드·회차 화면을 한 번 본다(나가기 버튼, 내보내기 버튼, 나간 멤버 섹션, 명단에 없는 멤버 섹션, `(나감)` 표기). 스크린샷은 남기지 않아도 된다. **dev DB에도 0008이 필요하다** — `npm run db:migrate`(.env.local = dev 브랜치)로 적용한다. 프로덕션에는 이 단계에서 적용하지 않는다(CI deploy 잡이 한다).

- [ ] **Step 6: 커밋**

```bash
git add "app/groups/[groupId]/leave-group-panel.tsx" "app/groups/[groupId]/page.tsx" "app/groups/[groupId]/settings"
git commit -m "feat: 모임 나가기 패널과 설정의 내보내기·되살리기·나간 멤버 목록

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
```

---

## Task 8: E2E — 기존 스펙을 새 의미에 맞추고, 생명주기 동선과 인가 매트릭스를 더한다

**Files:**
- Modify: `e2e/ledger.spec.ts`, `e2e/public-ledger.spec.ts`, `e2e/account-delete.spec.ts`
- Create: `e2e/member-lifecycle.spec.ts`
- Modify: `e2e/authz.spec.ts`

E2E는 `npx playwright test`로 돈다(빌드 + `next start`, test DB). **통합 테스트와 동시에 돌리지 않는다.**

- [ ] **Step 1: 기존 스펙을 먼저 돌려 깨지는 곳을 확인한다**

Run: `npx playwright test e2e/ledger.spec.ts e2e/public-ledger.spec.ts e2e/account-delete.spec.ts`
Expected: 세 곳이 FAIL — 이 실패가 의미 변경의 증거다.
- ledger.spec: 회차를 만든 **뒤** 합류한 철수가 1월 회차 명단에 없다(`1/2`가 아니라 `1/1`).
- public-ledger.spec: 같은 이유로 `탈퇴할멤버 납부 체크` 버튼이 없다. 그리고 탈퇴자가 공개 장부 멤버 목록에서 빠진다.
- account-delete.spec: 탈퇴자가 설정의 멤버 목록에서 빠지고 "나간 멤버"로 옮겨 간다.

- [ ] **Step 2: `e2e/ledger.spec.ts`**

철수 합류가 끝나는 줄(`await expect(mp).toHaveURL(/\/groups\/[^/]+$/);`, 철수 `join-submit` 직후) 바로 뒤에 넣는다:

```ts
  // 회차 명단은 만들 때 고정된다(ADR-005) — 뒤늦게 합류한 철수는 총무가 넣어야 1월 회차의 미납자다.
  await op.goto(`/groups/${groupId}/dues/${roundId}`);
  await op.getByRole('button', { name: '철수 명단에 추가' }).click();
  await expect(op.getByTestId('roster-addable')).toHaveCount(0);
```

`// 명단이 2명으로 늘었으니 납부는 1/2 — 예상 총액도 40,000으로 따라 오른다.` 주석을 `// 총무가 철수를 회차 명단에 넣었으니 납부는 1/2 — 예상 총액도 40,000이다.`로 바꾼다. 나머지 단언(`1/2`, `40,000`, payment-row 2, `미납: 철수`)은 그대로 통과해야 한다.

- [ ] **Step 3: `e2e/public-ledger.spec.ts`**

탈퇴할 멤버의 납부 체크 직전(`await ownerPage.goto(\`/groups/${fx.groupId}/dues/${roundId}\`);` 다음 줄)에 넣는다:

```ts
    // 회차를 만든 뒤 합류했으므로 명단에 넣어야 그 회차의 납부를 받을 수 있다(ADR-005).
    await ownerPage.getByRole('button', { name: `${LEAVER_NAME} 명단에 추가` }).click();
```

"쿠키 없는 방문자가 링크만으로 장부를 본다" 테스트의 멤버 단언 세 줄(`toHaveCount(2)` … `'탈퇴자의 멤버 자리가 사라졌거나 이름이 그대로다'`)을 아래로 바꾼다:

```ts
    // 공개 장부의 멤버 목록은 **활동 중인** 멤버다 — 탈퇴는 모임을 떠나는 것이다(ADR-005).
    // 탈퇴자가 낸 회비는 원장 줄로 남는다(아래 '2026-01 탈퇴한 멤버' 단언) — 기록은 지워지지 않는다.
    await expect(page.getByTestId('public-member')).toHaveCount(1);
    await expect(page.getByTestId('public-member').first()).toContainText('민지');
    await expect(page.getByTestId('public-member').filter({ hasText: '탈퇴한 멤버' })).toHaveCount(0);
```

- [ ] **Step 4: `e2e/account-delete.spec.ts`**

"남은 총무의 화면에서 탈퇴자는 이름만 바뀐 채 그 자리에 있다" 테스트를 아래로 바꾼다(헤더 주석 4번 항목의 문구도 `남은 멤버가 보는 화면에서 탈퇴자가 '나간 멤버'로 옮겨 가는가`로 고친다):

```ts
  test('남은 총무의 화면에서 탈퇴자는 나간 멤버로 옮겨 가고 이름만 바뀐다', async () => {
    const page = await ownerCtx.newPage();
    await page.goto(`/groups/${fx.gid}/settings`);
    // 활동 중 멤버 목록에서는 빠진다 — 탈퇴는 모든 모임을 떠나는 것이다(ADR-005).
    await expect(page.getByTestId('member-row')).toHaveCount(1);
    // 멤버십 행은 **지우지 않으므로** 나간 멤버로 남는다 — 지웠다면 과거 납부가 함께 사라진다(ADR-004).
    const left = page.getByTestId('left-member-row');
    await expect(left, '탈퇴자가 나간 멤버에 없다').toHaveCount(1);
    await expect(left).toContainText('탈퇴한 멤버');
    await expect(left).toContainText('· 탈퇴');
    // 이름이 파기된 멤버십은 되살릴 수 없다 — 버튼 자체가 없다.
    await expect(left.getByTestId('restore-member')).toHaveCount(0);
    await expect(left, '나간 멤버 행에 원래 이름이 남았다').not.toContainText('민지');
    await page.close();
  });
```

- [ ] **Step 5: 세 스펙 통과 확인**

Run: `npx playwright test e2e/ledger.spec.ts e2e/public-ledger.spec.ts e2e/account-delete.spec.ts`
Expected: PASS.

- [ ] **Step 6: `e2e/member-lifecycle.spec.ts` — 사람이 겪는 동선**

```ts
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createGroup, exactAmount, INVITE_JOIN_URL, newClientContext, signUp, testEmail } from './helpers';

/**
 * 멤버 생명주기(ADR-005)를 사람이 겪는 순서로 한 번 지나간다.
 * 거부 코드의 전수 확인은 authz.spec이 하고, 규칙의 경계는 통합 테스트가 한다.
 * 여기서 보는 것은 **화면이 그 규칙을 사람에게 어떻게 보이는가**다.
 */

test.describe.configure({ mode: 'serial' });

let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let op: Page;
let mp: Page;
const fx = { groupId: '', roundId: '', invite: '' };

async function joinWithName(page: Page, invite: string, name: string) {
  await page.goto(invite);
  await page.getByTestId('join-display-name').fill(name);
  await page.getByTestId('join-submit').click();
}

test.describe('멤버 생명주기', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    ownerCtx = await newClientContext(browser);
    op = await ownerCtx.newPage();
    op.on('dialog', (d) => d.accept());
    await op.goto('/login');
    await signUp(op, { name: '민지', email: testEmail('lifecycle', 'owner') });
    await expect(op).toHaveURL(/\/groups$/);
    fx.groupId = await createGroup(op, '생명주기모임', '민지');

    // 1월 회차는 총무 혼자일 때 만든다 — 명단 = [민지].
    await op.goto(`/groups/${fx.groupId}/dues`);
    await op.getByTestId('round-period').fill('2026-01');
    await op.getByTestId('round-amount').fill('20000');
    await op.getByTestId('round-create').click();
    await expect(op).toHaveURL(/\/dues\/[^/]+$/);
    fx.roundId = new URL(op.url()).pathname.split('/').pop()!;
    await op.getByTestId('payment-toggle').click();
    await expect(op.getByTestId('round-total-collected')).toHaveText(exactAmount('20,000'));

    await op.goto(`/groups/${fx.groupId}/settings`);
    await expect(op.getByTestId('invite-link')).toContainText('/invite/');
    fx.invite = (await op.getByTestId('invite-link').innerText()).trim();

    memberCtx = await newClientContext(browser);
    mp = await memberCtx.newPage();
    mp.on('dialog', (d) => d.accept());
    await mp.goto(fx.invite);
    await mp.getByTestId('join-login-link').click();
    await signUp(mp, { name: '철수', email: testEmail('lifecycle', 'member') });
    await expect(mp).toHaveURL(INVITE_JOIN_URL);
    await mp.getByTestId('join-display-name').fill('철수');
    await mp.getByTestId('join-submit').click();
    await expect(mp).toHaveURL(/\/groups\/[^/]+$/);
  });

  test.afterAll(async () => {
    await Promise.all([ownerCtx?.close(), memberCtx?.close()]);
  });

  test('회차 뒤에 합류한 사람은 그 회차 명단에 없고, 총무가 넣으면 미납자가 된다', async () => {
    await op.goto(`/groups/${fx.groupId}/dues/${fx.roundId}`);
    await expect(op.getByTestId('round-total-expected')).toHaveText(exactAmount('20,000'));
    await expect(op.getByTestId('roster-addable-row')).toHaveCount(1);

    await op.getByRole('button', { name: '철수 명단에 추가' }).click();
    await expect(op.getByTestId('round-total-expected')).toHaveText(exactAmount('40,000'));
    await expect(op.getByTestId('roster-addable')).toHaveCount(0);
    await expect(op.getByTestId('unpaid-text')).toHaveText('2026-01 회비(20,000원) 미납: 철수');
  });

  test('멤버가 나가면 모임이 목록에서 사라지고 모임 화면은 404다', async () => {
    await mp.goto(`/groups/${fx.groupId}`);
    await mp.getByTestId('leave-group').click();
    await expect(mp).toHaveURL(/\/groups$/);
    await expect(mp.getByText('생명주기모임')).toHaveCount(0);

    const res = await mp.goto(`/groups/${fx.groupId}`);
    expect(res?.status(), '나간 사람에게 모임 화면이 열린다').toBe(404);
  });

  test('나간 미납자는 회차 화면에 (나감)으로 남고 안내 문구에서는 빠진다 — 면제하면 예상이 준다', async () => {
    await op.goto(`/groups/${fx.groupId}/dues/${fx.roundId}`);
    await expect(op.getByTestId('payment-row').filter({ hasText: '철수 (나감)' })).toHaveCount(1);
    // 미납자가 나간 사람뿐이라 단톡방에 붙일 문구가 없다.
    await expect(op.getByTestId('unpaid-text')).toHaveCount(0);

    await op.getByRole('button', { name: '철수 면제' }).click();
    await expect(op.getByTestId('round-total-expected')).toHaveText(exactAmount('20,000'));
    await expect(op.getByTestId('payment-row').filter({ hasText: '철수' })).toHaveCount(0);
  });

  test('스스로 나간 사람은 초대 링크로 돌아오고 새 이름을 쓴다', async () => {
    await joinWithName(mp, fx.invite, '철수2');
    await expect(mp).toHaveURL(new RegExp(`/groups/${fx.groupId}$`));

    await op.goto(`/groups/${fx.groupId}/settings`);
    await expect(op.getByTestId('member-row').filter({ hasText: '철수2' })).toHaveCount(1);
    await expect(op.getByTestId('left-member-row')).toHaveCount(0);
  });

  test('내보내진 사람은 링크로 돌아올 수 없고, 총무가 되살리면 돌아온다', async () => {
    await op.goto(`/groups/${fx.groupId}/settings`);
    await op.getByRole('button', { name: '철수2 내보내기' }).click();
    const left = op.getByTestId('left-member-row');
    await expect(left).toHaveCount(1);
    await expect(left).toContainText('내보냄');

    await joinWithName(mp, fx.invite, '철수3');
    await expect(mp.getByRole('alert')).toContainText('내보내져');
    expect((await mp.goto(`/groups/${fx.groupId}`))?.status()).toBe(404);

    await op.getByRole('button', { name: '철수2 되살리기' }).click();
    await expect(op.getByTestId('left-member-row')).toHaveCount(0);
    await expect(op.getByTestId('member-row').filter({ hasText: '철수2' })).toHaveCount(1);
    expect((await mp.goto(`/groups/${fx.groupId}`))?.status()).toBe(200);
  });

  test('총무 화면에는 나가기가 없고, 총무 자신의 행에는 내보내기가 없다', async () => {
    await op.goto(`/groups/${fx.groupId}`);
    await expect(op.getByTestId('leave-group')).toHaveCount(0);
    await op.goto(`/groups/${fx.groupId}/settings`);
    await expect(op.getByTestId('member-row').filter({ hasText: '민지' }).getByTestId('remove-member')).toHaveCount(0);
  });
});
```

> `testEmail`·`signUp`·`createGroup`·`newClientContext`의 시그니처는 `e2e/helpers.ts`를 따른다(`testEmail(scope, role)`, `signUp(page, { name, email })`, `createGroup(page, name, displayName)`).

Run: `npx playwright test e2e/member-lifecycle.spec.ts`
Expected: PASS.

- [ ] **Step 7: `e2e/authz.spec.ts` — 새 액션 5종과 "나간 멤버" 컨텍스트**

**7-1. 타입과 소재.** `ActionName`에 다섯을 더한다:

```ts
  | 'deleteGroup'
  | 'addToRound'
  | 'removeFromRound'
  | 'removeMember'
  | 'restoreMember'
  | 'leaveGroup';
```

`fx`에 추가:

```ts
  /** 합류했다가 스스로 나간 A의 멤버십 — "나간 멤버" 컨텍스트의 주인. */
  leftMembershipA: '',
```

컨텍스트 선언부에 추가:

```ts
/**
 * 다섯 번째 역할: **나간 멤버**(Plan 05). 세션은 살아 있고 멤버십 행도 남아 있지만
 * 활동 중이 아니다. 행이 남아 있으므로 "멤버십 존재"로 판정하는 코드는 이 사람을 멤버로
 * 통과시킨다 — 그래서 별도 역할이다. 모든 액션이 NOT_MEMBER여야 한다.
 */
let leftCtx: BrowserContext;
```

**7-2. 상태 계수.** `writeCounts`의 select에 두 줄을 추가하고 반환 타입에 `roster: number; memberStates: string;`을 더한다:

```ts
      (select count(*)::int from dues_round_members where group_id in (${fx.gidA}, ${fx.gidB})) as roster,
      -- 내보내기·되살리기·나가기는 행을 늘리지 않고 상태를 바꾼다(재발급의 토큰과 같은 이유).
      (select string_agg(id || ':' || coalesce(left_reason, '-'), ',' order by id)
         from memberships where group_id in (${fx.gidA}, ${fx.gidB})) as "memberStates",
```

**7-3. 포획.** `beforeAll`에서 "멤버: 초대 링크로 A에 합류" 블록이 끝난 직후(비멤버 블록 앞)에 넣는다. 초대 링크 재발급보다 **앞**이어야 한다 — 같은 `invite`를 쓴다.

```ts
    // ── 나간 멤버: 합류 → 총무가 명단 편집·내보내기·되살리기로 id 포획 → 본인이 나감 ──────
    // 이 사람이 포획의 대상이자 다섯 번째 역할이다. 마지막에 스스로 나가면서 leaveGroup id를 준다.
    leftCtx = await newClientContext(browser);
    const lp = await leftCtx.newPage();
    lp.on('dialog', (d) => d.accept());
    await lp.goto(invite);
    await lp.getByTestId('join-login-link').click();
    await signUp(lp, { name: '탈주', email: testEmail('authz', 'leaver') });
    await expect(lp).toHaveURL(INVITE_JOIN_URL);
    await lp.getByTestId('join-display-name').fill('탈주');
    await lp.getByTestId('join-submit').click();
    await expect(lp).toHaveURL(/\/groups\/[^/]+$/);

    // 회차 A는 총무 혼자일 때 만들었으므로 탈주·철수 모두 '명단에 없는 멤버'다.
    await op.goto(`/groups/${fx.gidA}/dues/${fx.roundIdA}`);
    ids.addToRound = await captureActionId(op, () =>
      op.getByRole('button', { name: '탈주 명단에 추가' }).click(),
    );
    await expect(op.getByRole('button', { name: '탈주 면제' })).toBeVisible();
    ids.removeFromRound = await captureActionId(op, () =>
      op.getByRole('button', { name: '탈주 면제' }).click(),
    );
    await expect(op.getByRole('button', { name: '탈주 명단에 추가' })).toBeVisible();

    await op.goto(`/groups/${fx.gidA}/settings`);
    ids.removeMember = await captureActionId(op, () =>
      op.getByRole('button', { name: '탈주 내보내기' }).click(),
    );
    await expect(op.getByTestId('left-member-row')).toHaveCount(1);
    ids.restoreMember = await captureActionId(op, () =>
      op.getByRole('button', { name: '탈주 되살리기' }).click(),
    );
    await expect(op.getByTestId('left-member-row')).toHaveCount(0);

    await lp.goto(`/groups/${fx.gidA}`);
    ids.leaveGroup = await captureActionId(lp, () => lp.getByTestId('leave-group').click());
    await expect(lp).toHaveURL(/\/groups$/);
```

**7-4. 소재 회수.** 멤버십 회수 쿼리를 이름과 상태까지 읽게 바꾼다(A에 멤버가 둘이라 `role`만으로는 모호하다):

```ts
    const mems = (await sql`select id, group_id, role, display_name, left_reason from memberships`) as {
      id: string;
      group_id: string;
      role: string;
      display_name: string;
      left_reason: string | null;
    }[];
    fx.ownerMembershipA = mems.find((m) => m.group_id === fx.gidA && m.role === 'owner')!.id;
    fx.memberMembershipA = mems.find((m) => m.group_id === fx.gidA && m.display_name === '철수')!.id;
    fx.leftMembershipA = mems.find((m) => m.group_id === fx.gidA && m.left_reason === 'left')!.id;
    fx.membershipB = mems.find((m) => m.group_id === fx.gidB)!.id;
```

`afterAll`의 `Promise.all`에 `leftCtx?.close(),`를 더한다.

**7-5. 정상 입력.** `validInputs`의 `deleteGroup` 항목 **앞**에 넣는다(삭제가 마지막이어야 거부가 새도 앞 항목의 판정이 오염되지 않는다):

```ts
      // 명단 편집 2종 — 거부가 새면 roster 계수가 움직인다.
      ['addToRound', { groupId: fx.gidA, roundId: fx.roundIdA, membershipId: fx.memberMembershipA }],
      ['removeFromRound', { groupId: fx.gidA, roundId: fx.roundIdA, membershipId: fx.ownerMembershipA }],
      // 멤버십 상태 2종 — 거부가 새면 memberStates가 움직인다.
      ['removeMember', { groupId: fx.gidA, membershipId: fx.memberMembershipA }],
      ['restoreMember', { groupId: fx.gidA, membershipId: fx.leftMembershipA }],
```

`leaveGroup`은 여기 넣지 않는다 — 멤버에게는 **허용된** 쓰기다(아래 별도 테스트).

역할별 세 테스트와 공개 방문자 테스트의 제목에서 `8종`을 `12종`으로 바꾼다.

**7-6. 새 테스트 둘.** "공개 장부 링크 보유자" 테스트 뒤에 넣는다:

```ts
  test('나간 멤버는 쓰기 12종과 나가기 모두 NOT_MEMBER이고, 모임 화면·CSV는 404다', async () => {
    const baseline = await writeCounts();
    for (const [action, input] of validInputs()) {
      await expectDenied(leftCtx, action, input, 'NOT_MEMBER', baseline);
    }
    await expectDenied(leftCtx, 'leaveGroup', { groupId: fx.gidA }, 'NOT_MEMBER', baseline);

    const page = await leftCtx.newPage();
    expect((await page.goto(`/groups/${fx.gidA}`))?.status(), '나간 멤버에게 모임 화면이 열린다').toBe(404);
    await page.close();
    expect((await leftCtx.request.get(`${ORIGIN}/api/groups/${fx.gidA}/export`)).status()).toBe(404);
  });

  test('나가기는 본인 소속에만 — 비멤버 NOT_MEMBER, 미인증·공개 UNAUTHENTICATED, 총무 OWNER_CANNOT_LEAVE', async () => {
    const baseline = await writeCounts();
    const input = { groupId: fx.gidA };
    await expectDenied(outsiderCtx, 'leaveGroup', input, 'NOT_MEMBER', baseline);
    await expectDenied(anonCtx, 'leaveGroup', input, 'UNAUTHENTICATED', baseline);
    await expectDenied(publicVisitorCtx, 'leaveGroup', input, 'UNAUTHENTICATED', baseline);
    await expectDenied(ownerCtx, 'leaveGroup', input, 'OWNER_CANNOT_LEAVE', baseline);
  });
```

**7-7. 모임 경계.** "총무여도 모임 경계를 넘을 수 없다" 테스트 끝에 추가한다. `removeMember`·`restoreMember`의 두 줄은 남의 모임 id에 대한 **코드만** 고정한다 — B의 멤버십은 총무 것뿐이라 role·left_reason 조건에서 이미 떨어지므로 WHERE의 group_id 술어는 여기서 증명되지 않는다. 그 술어는 통합 테스트 '다른 모임의 멤버십은 건드릴 수 없다'(`test/member-lifecycle.integration.test.ts`, 변이 확인 포함)가 증명한다:

```ts
    // 명단 편집 — 남의 회차는 getRound에서, 남의 멤버십은 활동 중 조회에서 떨어진다.
    await expectDenied(
      ownerCtx,
      'addToRound',
      { groupId: fx.gidA, roundId: fx.roundIdB, membershipId: fx.memberMembershipA },
      'ROUND_NOT_FOUND',
      baseline,
    );
    await expectDenied(
      ownerCtx,
      'addToRound',
      { groupId: fx.gidA, roundId: fx.roundIdA, membershipId: fx.membershipB },
      'NOT_MEMBER',
      baseline,
    );
    // 멤버십 상태 — 비교-후-갱신의 WHERE에 group_id가 있다.
    await expectDenied(
      ownerCtx,
      'removeMember',
      { groupId: fx.gidA, membershipId: fx.membershipB },
      'NOT_MEMBER',
      baseline,
    );
    await expectDenied(
      ownerCtx,
      'restoreMember',
      { groupId: fx.gidA, membershipId: fx.membershipB },
      'NOT_REMOVED',
      baseline,
    );
```

**7-8. 성공 대조군.** "같은 재생 경로로 총무는 비파괴 7종 전부 성공한다" 테스트를 고친다. 제목을 `비파괴 11종`으로, `unmarkPaid` 성공 다음에 추가:

```ts
    // 명단 편집 2종 — 넣고 다시 빼서 순증 0. 새 회차는 철수가 활동 중일 때 만들어져 이미 명단에 있다.
    await expectAllowed(ownerCtx, 'removeFromRound', {
      groupId: fx.gidA,
      roundId,
      membershipId: fx.memberMembershipA,
    });
    await expectAllowed(ownerCtx, 'addToRound', {
      groupId: fx.gidA,
      roundId,
      membershipId: fx.memberMembershipA,
    });
    // 멤버십 상태 2종 — 내보냈다가 되살려서 순변화 0.
    await expectAllowed(ownerCtx, 'removeMember', { groupId: fx.gidA, membershipId: fx.memberMembershipA });
    await expectAllowed(ownerCtx, 'restoreMember', { groupId: fx.gidA, membershipId: fx.memberMembershipA });
```

계수 비교를 바꾼다:

```ts
    const { tokens: tokensBefore, memberStates: statesBefore, ...countsBefore } = before;
    const { tokens: tokensAfter, memberStates: statesAfter, ...countsAfter } = await writeCounts();
    // 지출 1 + 정정 1 + 납부 1 + 납부취소 역분개 1 = 원장 4줄. 회차 1개.
    // 새 회차의 명단은 그 순간의 활동 중 멤버 = 총무·철수 2명(탈주는 이미 나갔다). 빼고 넣어 순증 0.
    expect(countsAfter).toEqual({
      entries: countsBefore.entries + 4,
      payments: countsBefore.payments,
      rounds: countsBefore.rounds + 1,
      roster: countsBefore.roster + 2,
    });
    // 내보내고 되살렸으므로 상태 문자열이 처음과 같다 — 거부 케이스의 동일성 단언과 짝이다.
    expect(statesAfter).toBe(statesBefore);
```

(이 테스트의 기존 주석에 남은 "일곱 액션"·"비파괴 7종" 표현을 11로 고친다.)

**7-9. 실행.**

Run: `npx playwright test e2e/authz.spec.ts`
Expected: PASS.

**변이 확인:** `actions/clients.ts`의 `isNull(memberships.leftAt)`를 빼고(빌드 필요) authz를 돌려 "나간 멤버" 테스트가 빨개지는 것을 본다 — 나간 멤버가 `NOT_MEMBER` 대신 `FORBIDDEN`(쓰기 12종)이나 성공(나가기)을 받는다. 확인 후 되돌린다.

- [ ] **Step 8: E2E 전체**

Run: `npx playwright test`
Expected: 전부 PASS(기존 33 + 생명주기 6 + authz 신규 2).

- [ ] **Step 9: 커밋**

```bash
git add e2e/
git commit -m "test: 멤버 생명주기 E2E와 인가 매트릭스 확장 — 나간 멤버 역할, 새 액션 5종

기존 스펙 셋은 회차 명단 고정·활동 중 목록이라는 새 의미에 맞췄다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
```

---

## Task 9: 문서 · 최종 검증 · PR

**Files:**
- Create: `docs/adr/005-member-lifecycle.md`
- Modify: `docs/glossary.md`, `docs/superpowers/specs/2026-09-11-nbbang-design.md`(§2 데이터 모델·결정 이력), `docs/requirements.md`(§8 P0), `docs/adr/004-deletion-semantics.md`(관련 링크 한 줄)

- [ ] **Step 1: ADR-005**

`docs/adr/005-member-lifecycle.md`:

```markdown
# ADR-005: 멤버 생명주기 — 떠남은 상태, 회차 명단은 스냅샷

- 상태: 채택 (2026-10-28)
- 관련: ADR-001(불변 원장), ADR-003(정산 스냅샷), ADR-004(탈퇴 — 식별자 파기)
- 설계: `docs/superpowers/specs/2026-10-28-member-lifecycle-design.md`

## 맥락

모델에 "모임을 떠나는 사람"이 없었다. 떠나는 방법은 회원 탈퇴뿐이었고 그때도 멤버십 행은
남았다(ADR-004). 그 결과 탈퇴자가 이후 모든 회차의 미납자로 잡혔고, 회차 명단이 회차의 것이
아니라 "지금" 명단이어서 3월 가입자가 1월 회차의 미납자로 보였다.

## 결정

1. **떠남은 상태다.** `memberships.left_at`(null = 활동 중)과 `left_reason`('left' | 'removed' |
   'withdrawn'). 행은 지우지 않는다 — 원장·납부·정산·과거 회차 명단이 참조한다.
2. **활동 중 판정은 `left_at IS NULL` 하나다.** 페이지 접근(`getGroupForMember`)과 액션 접근
   (`groupActionClient`)이 같은 조건을 쓴다. 갈리면 화면은 404인데 액션은 통과한다.
3. **회차 명단은 생성 시점의 스냅샷이다**(`dues_round_members`). 이후 합류자는 없고 나간 사람은
   남는다. 총무가 빼거나(면제) 활동 중 멤버를 넣는다.
4. **납부는 명단 안에서만 존재한다.** `dues_payments_roster_fk`가 명단 밖 납부와 납부자 명단
   삭제를 모두 막는다. 그래서 "납부 > 명단"은 표현 불가능한 상태다.
5. **재가입:** 스스로 나간 사람은 같은 멤버십으로 돌아온다. 내보내진 사람은 링크로 돌아올 수
   없고 총무가 되살린다. 탈퇴는 모든 멤버십을 `withdrawn`으로 덮는다 — 되살릴 수 없다.
6. **상태 전이는 비교-후-갱신이다.** WHERE에 기대하는 이전 상태를 넣고 갱신 행 수로 판정한다.

## 기각한 대안

- 이벤트 로그(`membership_events`): 이력이 필요한 화면이 없고, 모든 "활동 중" 판정이 집계가 된다.
- `role`에 상태 값 추가: 권한과 소속이 한 컬럼에 섞이고 떠난 시각·원래 역할이 남지 않는다.
- 회차 명단을 기간으로 계산(joined_at/left_at vs 회차 월): 월 중간 가입 규칙을 코드가 정해야 하고
  총무가 예외를 줄 수 없다.
- 나가면 미납 회차에서 자동 제외: 나가기로 빚이 지워지고 총무는 그 사실을 모른다.

## 결과

- 미납 안내 문구에는 활동 중인 미납자만 들어간다. 나간 미납자는 회차 화면에 `(나감)`으로 남는다.
- 총무는 떠날 수 없다. 위임(요구사항 P1)이 먼저다.
- 나갈 때 정산 채무는 확인하지 않는다 — 정산은 지급 상태를 추적하지 않는다(ADR-003).
```

- [ ] **Step 2: 용어집 — `docs/glossary.md`**

기존 형식(표 또는 목록)에 맞춰 다섯 항목을 더한다. 내용:

- **나가기** — 멤버 본인이 모임을 떠난다. `left_reason = 'left'`. 초대 링크로 같은 멤버십으로 돌아올 수 있다.
- **내보내기** — 총무가 멤버를 떠나게 한다. `left_reason = 'removed'`. 링크로는 돌아올 수 없고 총무가 되살린다.
- **되살리기** — 내보낸 멤버를 다시 활동 중으로 돌린다. 스스로 나간 사람·탈퇴자는 대상이 아니다.
- **회차 명단** — 회차를 만들 때 고정되는 "이 회차에 내야 하는 사람" 목록(`dues_round_members`). 미납·예상 금액의 기준.
- **면제** — 총무가 회차 명단에서 사람을 뺀다. 납부한 사람은 뺄 수 없다.

기존 **탈퇴** 항목 끝에 한 문장을 더한다: "탈퇴하면 모든 멤버십이 `withdrawn`으로 떠난 상태가 된다(ADR-005)."

- [ ] **Step 3: 스펙 §2 · 결정 이력 — `docs/superpowers/specs/2026-09-11-nbbang-design.md`**

§2 데이터 모델의 `memberships` 설명에 `left_at`·`left_reason`(+CHECK)을, 테이블 목록에 `dues_round_members`(회차 명단, PK (round_id, membership_id), 복합 FK 2개)를, `dues_payments` 설명에 `dues_payments_roster_fk`를 더한다. 결정 이력 표에 행을 하나 더한다:

`| 2026-10-28 | Plan 05 멤버 생명주기 — 떠남은 상태(left_at/left_reason), 회차 명단 스냅샷, 납부는 명단 안에서만(ADR-005) |`

(표의 열 구성은 기존 행에 맞춘다.)

- [ ] **Step 4: 요구사항 §8 — `docs/requirements.md`**

P0 멤버 생명주기 항목을 완료로 표시한다(기존 완료 항목의 표기 방식을 따른다 — 예: 취소선 또는 `✅ 2026-10-28 Plan 05`). ADR-004 끝의 "관련" 목록에 `ADR-005(멤버 생명주기 — 탈퇴는 모든 멤버십을 withdrawn으로)`를 더한다.

- [ ] **Step 5: 최종 검증 (순서대로, 동시 실행 금지)**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:integration
npm run build
npx playwright test
DATABASE_URL=postgresql://unused npx drizzle-kit generate
```

Expected: 전부 통과, 마지막은 `No schema changes`. 각 명령의 통과 수(단위·통합·E2E)를 PR 본문에 적는다.

- [ ] **Step 6: 커밋 · PR**

```bash
git add docs/
git commit -m "docs: ADR-005 멤버 생명주기, 용어집·스펙·요구사항 반영

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6"
git push -u origin feat/member-lifecycle
gh pr create --title "feat: 멤버 생명주기 — 나가기·내보내기·회차 명단 스냅샷 (Plan 05)" --body-file <작성한 본문 파일>
```

PR 본문에 들어갈 것: 요약(스펙 D1~D5), **프로덕션 마이그레이션 주의**(0008은 백필을 포함한다 — 기존 회차 명단이 "생성 시점 가입자 ∪ 납부자"로 채워지고 탈퇴자 4명은 `withdrawn`이 된다), 테스트 수, 변이 확인 목록, 그리고 끝에:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_013dutPfPYu49sU4Ngb8ZPA6
```

머지는 사용자 확인 후 한다(main 푸시 = CI deploy 잡이 프로덕션에 마이그레이션·배포).

- [ ] **Step 7: 머지 후 프로덕션 확인** (사용자가 머지한 뒤)

- main CI(check·e2e·deploy) 초록 확인.
- 프로덕션 `/`·`/login`·`/privacy` 200, `/g/does-not-exist-000` 404.
- 프로덕션 DB에서 읽기 전용으로 확인한다(연결 문자열을 출력하지 않는 node 스크립트): `memberships` 중 `left_reason = 'withdrawn'` 행 수가 `user.deleted_at IS NOT NULL` 사용자의 멤버십 수와 같고, `dues_payments` 전 행이 `dues_round_members`에 짝이 있다(FK가 있으므로 0건 위반이 당연하지만, 마이그레이션이 실제로 적용됐다는 확인이다).

---

## 자기 점검 (계획 작성 시)

**스펙 대조**

| 스펙 | 태스크 |
|---|---|
| D1 회차 명단 스냅샷 | T2(테이블·백필), T4(`snapshotRoster`) |
| D2 나가기·내보내기, 총무는 못 나감 | T5, T7(화면) |
| D3 미납 유지 + 면제·추가, 납부자는 못 뺌 | T2(roster FK), T4 |
| D4 재가입 복원 / 내보낸 사람 차단 / 되살리기 | T1(`joinDecision`), T5 |
| D5 저장 모델 | T2 |
| §4 활동 중 적용 자리 7곳 | T3(6곳), T4(`markPaid`) |
| §5.1 안내 문구 활동 중만, `(나감)`, `n/m` | T1, T4 |
| §5.4 탈퇴 → withdrawn(덮어쓰기) | T5 |
| §5.5 이름 검증 | T1, T6 |
| §6 동시성(비교-후-갱신, FK) | T4(`removeFromRoster`), T5(`lib/db/membership.ts`) |
| §8 변이 확인 2건 이상 | T2·T3·T4·T5·T8 각 1건 |
| §9 문서 | T9 |

**의미가 바뀌어 고치는 기존 테스트** — 숨기지 않고 커밋에 남긴다: `ledger.spec`(뒤늦은 합류자 명단 추가), `public-ledger.spec`(명단 추가 · 공개 멤버 목록에서 탈퇴자 제외), `account-delete.spec`(탈퇴자가 나간 멤버로 이동), 통합 픽스처 3개(납부 전 명단 행).
