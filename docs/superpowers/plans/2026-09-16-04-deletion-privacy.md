# Plan 04 — 실사용 전 하드닝: 레이트 리밋 · 삭제 · 탈퇴 · 처리방침

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 사람을 받기 전에 반드시 있어야 하는 것 — 공개 링크 레이트 리밋, 모임 완전 삭제, 회원 탈퇴, 개인정보처리방침 — 넷을 채운다.

**Architecture:** 새 기능이 아니라 기존 구조의 마감이다. 레이트 리밋은 이미 있는 Neon에 카운터 테이블 하나로 올린다(새 의존성 0). 삭제는 `onDelete`가 어디에도 없는 현 스키마에 맞춰 **트랜잭션 안에서 순서대로 명시 삭제**한다. 탈퇴는 `user.id`를 `notNull`로 참조하는 컬럼이 셋이라 **행 삭제가 불가능**하므로 **되돌릴 수 없는 익명화**로 구현하고, 그 결정을 ADR-004로 남긴다. 처리방침은 법적 형식을 갖춘 정적 페이지이자, 동시에 **탈퇴가 무엇을 지우는지에 대한 명세**다.

**Tech Stack:** 기존과 동일 — Next 15.5 App Router · Drizzle · Neon(`neon-serverless` Pool, 트랜잭션 가능) · next-safe-action · Playwright · Vitest.

---

## 이 플랜을 실행하는 사람이 반드시 지킬 규칙

Plan 03에서 값이 나온 지점이 전부 이 규칙에서 나왔다. 그대로 적용한다.

1. **플랜의 코드 조각은 명세가 아니라 의도다.** 현실과 어긋나면 **현실을 따르고 보고한다.** Plan 03에서 이 플랜의 전신은 죽은 캐시 지시어, 매달린 컬럼 참조, 서로 모순되는 두 문장, 2컬럼/1컬럼 불일치를 냈다. 이 문서도 틀렸을 수 있다.
2. **도달 불가라고 주장하는 상태는 강제로 만들어 증명한다** — 임시 에러 코드, DB 직접 주입, 트랜잭션 안에서의 제약 위반.
3. **한 번도 실패한 적 없는 단언은 증거가 아니다.** 새로 만든 방어에는 **변이 증명**을 붙인다. 방어를 끄면 빨개지는 것을 실제로 보고, 되돌리고, 관측한 실패 메시지를 보고한다. 스펙이 둘이면 **스펙마다** 한다.
4. **공허한 초록을 의심한다.** Task 11이 찾아낸 것: ADR-003 단언 전부가 빈 원장에서 "0으로 0을 확인"하고 있었다. 새 단언을 쓸 때마다 **"이게 통과하는 잘못된 구현이 있는가"**를 자문한다.
5. **`test:integration`과 `e2e`를 동시에 돌리지 않는다.** 둘 다 같은 test 브랜치를 TRUNCATE하고, 중단된 쪽의 유휴 커넥션이 다음 스위트의 TRUNCATE를 막아 vitest가 조용히 멈춘다. 복구는 유휴 백엔드에 `pg_terminate_backend`.
6. **푸시가 워크플로 런을 만들지 않는 일이 있다.** 런이 실제로 존재하는지 확인하고, 없으면 후속 커밋으로 되살린다.
7. 스키마 변경은 `npm run db:generate` → **생성된 SQL을 눈으로 읽고** → dev·test 적용. 프로덕션은 CI `deploy` 잡이 한다.
8. `.env.*`는 절대 출력·커밋하지 않는다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/db/schema.ts` | `rate_limits` 테이블, `user.deletedAt` 추가 |
| `lib/rate-limit.ts` | 고정 윈도 카운터 — **원자적 upsert 한 번**, fail-open 판단 포함 |
| `lib/client-ip.ts` | 헤더에서 클라이언트 IP 추출 (Vercel `x-forwarded-for` 규약) |
| `app/g/[token]/page.tsx` | 레이트 리밋 적용 지점 |
| `app/api/cron/cleanup/route.ts` | 만료된 레이트 리밋 행 정리 (`CRON_SECRET` 보호) |
| `actions/group.ts` | `deleteGroup` — 이름 확인 + 트랜잭션 순서 삭제 |
| `actions/account.ts` | `deleteAccount` — 익명화 |
| `lib/db/delete.ts` | **무엇을 파괴하는지가 코드에 적혀 있는** 삭제 순서 한 곳 |
| `app/privacy/page.tsx` | 개인정보처리방침 |
| `docs/adr/004-deletion-semantics.md` | 탈퇴가 ADR-003의 스냅샷 불변성과 충돌하는 지점의 결정 |

---

## Task 1: 공개 장부 레이트 리밋

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/client-ip.ts`, `lib/client-ip.test.ts`
- Create: `lib/rate-limit.ts`
- Create: `test/rate-limit.integration.test.ts`
- Modify: `app/g/[token]/page.tsx`
- Create: `app/api/cron/cleanup/route.ts`, `vercel.json` (crons)
- Modify: `e2e/public-ledger.spec.ts`

### 설계 근거 (구현자가 알아야 할 것)

- **위협 모형**: 토큰은 128비트라 열거는 불가능하다. 실제 위험은 ① 유출된 링크가 반복 긁히는 것 ② Vercel 함수 호출 비용이다. 따라서 통제 대상은 **IP당 요청 수**다.
- **토큰당이 아니라 IP당으로 거는 이유**: 토큰당으로 걸면 20명짜리 모임이 동시에 링크를 열 때 정상 사용자가 막힌다. 분산 스크래핑은 IP가 많다는 뜻이고, 취미 규모에서 그건 사실상 없다. 이 판단을 코드 주석에 남긴다.
- **fail-open**: 카운터 DB 쓰기가 실패하면 **통과시킨다.** 장부를 못 보게 하는 것보다 레이트 리밋이 잠깐 없는 게 낫다. 이건 의도적 선택이므로 주석 + 테스트로 고정한다.

- [ ] **Step 1: `rate_limits` 테이블 + `client-ip` 실패 테스트**

```ts
// lib/db/schema.ts 에 추가
export const rateLimits = pgTable('rate_limits', {
  // 'g:<ip>' 형태. 용도가 늘어도 접두사로 구분한다.
  bucket: text('bucket').primaryKey(),
  count: integer('count').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
});
```

```ts
// lib/client-ip.test.ts
import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

const h = (init: Record<string, string>) => new Headers(init);

describe('clientIp', () => {
  it('x-forwarded-for의 첫 항목을 쓴다', () => {
    expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });
  it('공백을 다듬는다', () => {
    expect(clientIp(h({ 'x-forwarded-for': '  203.0.113.7 ,10.0.0.1' }))).toBe('203.0.113.7');
  });
  it('x-real-ip로 넘어간다', () => {
    expect(clientIp(h({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });
  // ⚠️ 헤더가 없을 때 전부 같은 버킷에 넣으면 한 사람이 전체를 잠글 수 있다.
  it('아무 헤더도 없으면 null', () => {
    expect(clientIp(h({}))).toBeNull();
  });
  it('빈 문자열은 null', () => {
    expect(clientIp(h({ 'x-forwarded-for': '   ' }))).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — `npx vitest run lib/client-ip.test.ts`. 기대: `Cannot find module './client-ip'`.

- [ ] **Step 3: `clientIp` 구현**

```ts
// lib/client-ip.ts
/**
 * Vercel은 엣지에서 `x-forwarded-for`를 직접 설정하므로 첫 항목이 실제 클라이언트다.
 * 로컬 `next start`에서도 Next가 소켓 주소로 이 헤더를 채운다(Plan 03 Task 6에서 측정).
 *
 * 헤더가 없으면 **null**이다 — 'unknown' 같은 상수로 뭉뚱그리면 IP를 못 읽은 모든 요청이
 * 한 버킷에 들어가고, 한 사람이 전체 공개 링크를 잠글 수 있다. 호출부가 null을 보고
 * 판단하게 한다(이 레포의 정책은 "IP를 모르면 제한하지 않는다" — Step 5 참조).
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip')?.trim();
  return real || null;
}
```

- [ ] **Step 4: 테스트 통과 확인** — 5개 PASS.

- [ ] **Step 5: 레이트 리밋 통합 테스트(실패부터)**

`test/rate-limit.integration.test.ts` — 실제 DB 왕복으로 다음을 고정한다:

1. 한도 안에서는 `{ allowed: true }`
2. 한도를 넘으면 `{ allowed: false, retryAfterSeconds }` — `retryAfterSeconds`는 1 이상 윈도 이하
3. **다른 버킷은 영향받지 않는다** ← *이게 없으면 "전부 막기"가 통과한다*
4. 윈도가 지나면 리셋된다 (`window_start`를 과거로 직접 UPDATE해 강제)
5. **동시 요청이 한도를 넘겨 새지 않는다** — `Promise.all`로 한도+5개를 한꺼번에 던져 `allowed`가 정확히 한도 개수인지 확인 (원자적 upsert가 실제로 원자적인지)
6. **fail-open** — 존재하지 않는 테이블을 보게 만든 핸들을 주입해 쓰기를 실패시키고 `{ allowed: true }`인지 확인

- [ ] **Step 6: 테스트 실패 확인** — 모듈 없음.

- [ ] **Step 7: `checkRateLimit` 구현**

```ts
// lib/rate-limit.ts
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * 고정 윈도 카운터. **DB 왕복 한 번**이고 그 한 번이 원자적이다 —
 * 읽고-판단하고-쓰면 그 사이로 동시 요청이 새고, 그건 레이트 리밋이 아니다.
 *
 * fail-open: 쓰기가 실패하면 통과시킨다. 장부를 못 보게 하는 것보다
 * 레이트 리밋이 잠깐 없는 게 낫다 (가용성 > 제한).
 */
export async function checkRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const rows = await db.execute<{ count: number; window_start: Date }>(sql`
      insert into rate_limits (bucket, count, window_start)
      values (${bucket}, 1, now())
      on conflict (bucket) do update set
        count = case
          when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
          then 1 else rate_limits.count + 1 end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
          then now() else rate_limits.window_start end
      returning count, window_start
    `);
    const row = rows.rows[0];
    if (!row || row.count <= limit) return { allowed: true };
    const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsed)) };
  } catch (e) {
    console.error('[checkRateLimit] 실패 — 통과시킨다 (fail-open)', e);
    return { allowed: true };
  }
}
```

> 구현자 주의: `db.execute`의 반환 모양은 드라이버마다 다르다(`rows` 유무). **실제로 찍어 확인하고** 플랜과 다르면 맞춘 뒤 보고한다.

- [ ] **Step 8: 통합 테스트 통과 확인** — 6개 PASS. 특히 5번(동시성)과 3번(버킷 격리)이 통과해야 한다.

- [ ] **Step 9: `/g/[token]`에 적용**

IP가 `null`이면 **제한하지 않는다**(Step 3의 근거). 한도는 **60회/분**. 초과 시 429 + `Retry-After` + 한국어 안내 페이지(JSON 아님 — 사람이 보는 화면이다).

- [ ] **Step 10: e2e — 변이 증명까지**

`e2e/public-ledger.spec.ts`에 추가. **⚠️ 기존 18개 테스트가 같은 IP로 `/g/`를 여러 번 친다** — 스펙·워커마다 `x-forwarded-for`를 다르게 줘서 버킷이 충돌하지 않게 한다(Plan 03 Task 6에서 쓴 기법 그대로).

- 한도 초과 → 429 + `Retry-After` 헤더
- **다른 IP는 여전히 200** ← 이게 없으면 "전부 막기"가 통과한다
- 인증 앱 경로(`/`, `/login`)는 제한되지 않는다

**변이 증명**: `checkRateLimit` 호출을 주석 처리 → 429 테스트가 빨개지는 것을 관측하고 되돌린다. 관측한 실패 메시지를 보고한다.

- [ ] **Step 11: 정리 크론**

`app/api/cron/cleanup/route.ts` — `Authorization: Bearer ${CRON_SECRET}` 검사(없거나 다르면 401), 하루 지난 행 삭제. `vercel.json`에 일 1회 크론 등록(Hobby는 일 단위만 허용). `CRON_SECRET`을 Vercel 환경변수에 등록하고 **값은 출력하지 않는다**.

> 왜 필요한가: 버킷은 IP마다 한 행이고, upsert는 윈도를 리셋할 뿐 행을 지우지 않는다. 방문 IP가 다양해지면 테이블이 단조 증가한다.

- [ ] **Step 12: 게이트 + 커밋**

마이그레이션 생성·SQL 확인·dev/test 적용 → lint · tsc · unit · integration · build · e2e(**순차**) → 커밋 `feat: 공개 장부 레이트 리밋` → 푸시 → 런 존재 확인 → 3잡 초록.

---

## Task 2: 모임 완전 삭제

**Files:**
- Create: `lib/db/delete.ts`
- Modify: `actions/group.ts`, 설정 화면
- Create: `test/group-delete.integration.test.ts`
- Modify: `e2e/authz.spec.ts`

### 설계 근거

- **스키마에 `onDelete`가 하나도 없다** — 전부 기본 `NO ACTION`이다. 캐스케이드는 없으니 **순서대로 지워야 한다.**
- `ledger_entries`의 자기참조 FK(`reversal_of`)는 **한 문장으로 부모·자식을 함께 지우면 통과한다** — `NO ACTION`은 문장 종료 시점에 검사되기 때문이다(`RESTRICT`였다면 즉시 실패했다). **이 사실을 테스트로 고정한다** — 다음 사람이 `RESTRICT`로 바꾸면 조용히 깨진다.
- 삭제 순서를 `lib/db/delete.ts` 한 곳에 둔다. `public-queries.ts`가 "노출 가능한 것의 전체 목록"이듯, 이 배열은 **"파괴되는 것의 전체 목록"**이다.
- **이름 확인은 서버에서 한다.** 클라이언트에서만 확인하면 그건 연출이지 방어가 아니다 — 서버 액션은 공개 엔드포인트다(ADR-002).

- [ ] **Step 1: 실패 테스트**

`test/group-delete.integration.test.ts`:
1. 모임 A에 원장 2건(하나는 역분개) · 회차 1 · 납부 1 · 정산 1(참여자 2·이체 1) · 멤버십 2를 만들고, 모임 B도 같은 내용으로 만든다
2. A 삭제 → **A 소유 행이 12개 테이블 전부에서 0**
3. **B의 모든 행 수가 그대로** ← 고전적인 삭제 버그를 잡는 자리
4. 틀린 이름으로 호출 → `NAME_MISMATCH`, **행이 하나도 지워지지 않음**
5. 멤버(비총무)가 호출 → `FORBIDDEN`, 행 불변
6. 역분개가 달린 원장이 **한 문장으로** 지워진다 (자기참조 FK)
7. 삭제 후 `publicToken`으로 `getPublicLedger` → null

- [ ] **Step 2: 실패 확인** → **Step 3: `lib/db/delete.ts` + `deleteGroup` 구현** → **Step 4: 통과 확인**

```ts
// lib/db/delete.ts — 파괴되는 것의 전체 목록. 순서가 곧 FK 의존성의 역순이다.
// 테이블을 추가하고 이 목록에 넣지 않으면 삭제가 23503으로 실패한다 — 조용히 남지 않는다.
```

- [ ] **Step 5: 설정 화면** — 총무만 보이는 위험 구역. 모임 이름을 타이핑해야 버튼이 열리고, **서버가 다시 확인한다.** testid `delete-group`, `delete-group-confirm`.

- [ ] **Step 6: 인가 매트릭스에 추가** — `deleteGroup`을 8번째 액션으로. 총무 외 전원 거부, 거부 후 행 수 불변. **성공 대조군은 맨 마지막**(삭제는 파괴적이라 뒤따르는 테스트가 의존할 수 없다 — Task 11에서 재발급 액션에 쓴 순서 해법 그대로).

- [ ] **Step 7: 게이트 + 커밋**

---

## Task 3: 회원 탈퇴

**Files:**
- Create: `docs/adr/004-deletion-semantics.md`
- Modify: `lib/db/schema.ts` (`user.deletedAt`)
- Create: `actions/account.ts`, `test/account-delete.integration.test.ts`
- Modify: 계정 설정 화면, `e2e/authz.spec.ts`

### 설계 근거 — 먼저 ADR을 쓴다

**`user` 행은 지울 수 없다.** `memberships.userId` · `ledgerEntries.createdBy` · `settlements.createdBy` 셋이 `notNull`로 참조한다. 셋을 nullable로 바꾸는 선택지도 있지만, 그러면 "누가 기록했는가"가 영구히 사라지고 마이그레이션이 세 테이블을 건드린다.

**대신 되돌릴 수 없는 익명화를 한다:**

| 대상 | 처리 | 이유 |
|---|---|---|
| `user.email` | `deleted-<uuid>@deleted.invalid` | 유니크 유지 + **같은 이메일로 재가입 가능** |
| `user.name`, `image` | `'탈퇴한 사용자'`, `null` | 식별자 제거 |
| `user.deletedAt` | `now()` | 로그인 차단 판정 |
| `account` (자격증명) | **행 삭제** | 비밀번호 해시 완전 제거 |
| `session` | **행 삭제** | 즉시 로그아웃 |
| `memberships.displayName` | `'탈퇴한 멤버'` | 행은 남긴다 — **지우면 회비 납부 체크가 사라져 과거 회차가 "미납"으로 보인다**(틀린 사실) |
| `settlement_participants.displayNameAtTime` | `'탈퇴한 멤버'` | ADR-003과 충돌 — 아래 |
| `ledger_entries`, `dues_payments`, `settlements` 금액·구조 | **불변** | 원장은 append-only. 지우면 잔액이 바뀐다(ADR-001) |

**ADR-004가 정해야 할 것**: ADR-003은 "조회 시 현재 명단을 조인하면 과거 정산이 소급 변경된다"며 이름을 굳혔다. 탈퇴 시 그 굳힌 이름을 바꾸는 것은 표면적으로 그 규칙을 어긴다. 결정과 근거를 명시한다 — **탈퇴는 소급 변경이 아니라 파기다.** ADR-003이 막으려던 것은 "명단이 바뀌었다고 기록이 따라 변하는 것"이고, 파기는 정보주체의 권리 행사다. 금액·참여 인원·이체 구조는 그대로이므로 **정산의 사실관계는 보존되고 이름만 지워진다.**

**총무는 탈퇴할 수 없다** — 모임이 남아 있으면 거부하고 "모임을 먼저 삭제하세요"로 안내한다. 총무 위임은 이 플랜 범위 밖이며, 그 사실을 에러 메시지와 ADR에 적는다.

- [ ] **Step 1: ADR-004 작성 · 커밋** (구현 전에)

- [ ] **Step 2: 실패 테스트** — `test/account-delete.integration.test.ts`:
1. 멤버 탈퇴 → `user` 이메일·이름 익명화, `account`·`session` 0행
2. **모임 잔액 불변, 원장 행 수 불변** ← ADR-001
3. **과거 회비 납부 체크 유지** — 탈퇴자가 냈던 회차가 여전히 "납부"로 보인다
4. 정산 금액·참여자 수·이체 구조 불변, 이름만 `'탈퇴한 멤버'`
5. **원래 이메일·표시명이 DB 어디에도 남아 있지 않다** (알려진 컬럼 전수 확인)
6. 총무가 호출 → `OWNS_GROUPS` 거부, **아무것도 바뀌지 않음**
7. 탈퇴한 이메일로 **재가입 가능**
8. 탈퇴 후 기존 세션 쿠키로 접근 → 인증 실패

- [ ] **Step 3: 실패 확인** → **Step 4: 구현** → **Step 5: 통과 확인**

로그인 경로에서 `deletedAt`이 찍힌 사용자를 거부한다. Better Auth의 `deleteUser` 기능은 **쓰지 않는다** — 하드 삭제라 위 FK 셋을 깬다. 이 사실을 주석에 남긴다.

- [ ] **Step 6: 변이 증명** — `memberships.displayName` 익명화를 끄면 5번이 빨개지는지, `account` 삭제를 끄면 5번/8번이 빨개지는지 확인하고 되돌린다. 관측 결과를 보고한다.

- [ ] **Step 7: 화면** — 계정 설정에 위험 구역. `탈퇴합니다` 타이핑 확인(서버 재확인). testid `delete-account`, `delete-account-confirm`.

- [ ] **Step 8: 게이트 + 커밋**

---

## Task 4: 개인정보처리방침

**Files:**
- Create: `app/privacy/page.tsx`
- Modify: 푸터 · 가입/로그인 화면 · 공개 장부 푸터
- Modify: `e2e/public-ledger.spec.ts`

### 내용 (이 문서는 Task 3의 명세이기도 하다 — 둘이 어긋나면 안 된다)

- **수집 항목**: 이메일, 비밀번호(해시), 표시명, 모임 활동 기록(회비·지출·정산)
- **목적**: 서비스 제공(모임 장부)
- **보관·파기**: 탈퇴 즉시 파기. **무엇이 지워지고 무엇이 남는지 Task 3 표 그대로 적는다** — "모임의 금액 기록은 익명 상태로 남습니다"를 숨기지 않는다
- **제3자 제공**: 없음
- **처리 위탁 / 국외 이전**: Vercel(호스팅), Neon(DB). ⚠️ **실제 리전을 확인해서 적는다** — 추측 금지. Vercel 프로젝트 리전과 Neon 브랜치 리전을 각각 확인한 값으로
- **이용자 권리**: 열람(로그인 후 화면), 삭제(탈퇴·모임 삭제) — **셀프서비스 경로를 명시**
- **공개 장부 고지**: 링크를 가진 사람은 로그인 없이 장부를 본다. 총무가 링크를 재발급하면 이전 링크는 즉시 무효
- **문의**: GitHub 이슈 링크 (개인 이메일 비표기 — 실사용자를 받는 시점에 전용 주소로 교체)
- **시행일**

- [ ] **Step 1: 페이지 작성** — 기존 스위스 그리드 타이포 그대로. 새 컴포넌트 만들지 말 것.
- [ ] **Step 2: 링크 배치** — 가입 화면(동의 맥락), 전역 푸터, **공개 장부 푸터**.
- [ ] **Step 3: e2e** — `/privacy`가 비로그인으로 200. 공개 장부에서 링크가 보이고 눌리는지. **⚠️ 외부 호스트 요청 0건 단언이 여전히 통과하는지** (Task 8이 세운 규칙 — 링크 하나가 이걸 깰 수 있다).
- [ ] **Step 4: 게이트 + 커밋**

---

## Task 5: 마감

**Files:** `README.md`, `docs/requirements.md`, 플랜 구현 노트

- [ ] **Step 1: 프로덕션 스모크 — 이번엔 삭제 경로를 실제로 탄다**

계정 2개로 모임 개설 → 회비·지출·정산 → 공개 링크 확인 → **한 명 탈퇴**(원장·잔액 불변 확인, 이름이 `탈퇴한 멤버`인지) → **모임 삭제**(공개 링크 404 확인) → 남은 계정도 탈퇴 → **12개 테이블 전부 0행 확인**.

> 이번 스모크는 뒷정리가 곧 기능이다 — 손으로 DELETE 하지 말고 **만든 기능으로 지운다.** 다 지웠는데 행이 남으면 그게 버그다.

- [ ] **Step 2: 레이트 리밋 프로덕션 확인** — 공개 링크를 한도 초과로 두드려 429와 `Retry-After`를 받고, 다른 IP는 200인지 확인. 크론 라우트가 비밀키 없이는 401인지 확인.
- [ ] **Step 3: 문서** — README에 탈퇴·삭제·처리방침 반영, `requirements.md`에 Plan 04 항목과 근거, 미결 항목 갱신(공개 링크 레이트 리밋 ✅로 닫힘).
- [ ] **Step 4: 게이트 + 커밋 + CI 3잡 초록 확인**

---

## Self-Review

**범위 점검** — 사용자가 고른 세 가지(레이트 리밋 / 삭제·탈퇴 / 처리방침)를 Task 1·2·3·4가 각각 덮는다. 기능 확장은 없다 — 다중 채권자 정산은 의도적으로 **범위 밖**이며 실사용 한 달 뒤 판단한다.

**의도적 제외**
- **총무 위임** — 탈퇴하려는 총무는 모임을 먼저 삭제해야 한다. 실사용에서 필요해지면 그때 만든다(플랜 밖에서 추측으로 만들지 않는다).
- **전용 문의 이메일** — 모르는 사람이 가입하기 시작할 때. 지금은 GitHub 이슈.
- **토큰당 레이트 리밋** — IP당으로 충분하다는 판단의 근거는 Task 1에 적었다. 틀렸다면 실사용 로그가 알려준다.

**이 플랜이 틀렸을 수 있는 곳** (구현자는 확인하고 보고한다)
1. `db.execute`의 반환 모양 (`rows` 유무) — 드라이버마다 다르다
2. 자기참조 FK가 한 문장 삭제에서 정말 통과하는지 — `NO ACTION` 문장 말미 검사 가정
3. Vercel Hobby의 크론 제약 (개수·주기)
4. Better Auth의 `user` 테이블을 직접 UPDATE 했을 때 세션 검증 경로가 어떻게 반응하는지
