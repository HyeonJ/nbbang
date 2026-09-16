# Plan 04 — 실사용 전 하드닝: 레이트 리밋 · 삭제 · 탈퇴 · 처리방침

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **이 문서는 외부 리뷰(2026-09-16) 반영본이다.** 초안은 `page.tsx`에서 429를 낼 수 있다고 전제했고, 평문 IP를 저장하면서 같은 플랜의 처리방침에는 그 사실을 적지 않았다. 판정 근거는 맨 아래 **외부 리뷰 판정** 표에 있다.

**Goal:** 실제 사람을 받기 전에 반드시 있어야 하는 것 — 공개 링크 레이트 리밋, 모임 완전 삭제, 회원 탈퇴, 개인정보처리방침 — 넷을 채운다.

**Architecture:** 새 기능이 아니라 기존 구조의 마감이다. 레이트 리밋은 **미들웨어**에서 판정한다(서버 컴포넌트는 상태 코드를 낼 수 없다). 저장은 이미 있는 Neon에 카운터 테이블 하나 — 새 의존성 0, **IP는 HMAC으로만** 저장한다. 삭제는 `onDelete`가 어디에도 없는 현 스키마에 맞춰 **행 잠금 + 트랜잭션 안 순서 삭제**. 탈퇴는 `user.id`를 `notNull`로 참조하는 컬럼이 셋이라 행 삭제가 불가능하므로 **식별자 파기 + 내부 UUID 보존**으로 구현하고, 그 한계까지 ADR-004와 처리방침에 적는다.

**Tech Stack:** 기존과 동일 — Next 15.5 App Router · Drizzle · Neon(앱은 `neon-serverless` Pool, 미들웨어는 엣지 호환 `neon()` HTTP) · Better Auth · next-safe-action · Playwright · Vitest.

---

## 이 플랜을 실행하는 사람이 반드시 지킬 규칙

1. **플랜의 코드 조각은 명세가 아니라 의도다.** 현실과 어긋나면 **현실을 따르고 보고한다.** 이 문서의 초안은 외부 리뷰에서 블로커 8개를 받았다. 반영본도 틀렸을 수 있다.
2. **도달 불가라고 주장하는 상태는 강제로 만들어 증명한다.**
3. **한 번도 실패한 적 없는 단언은 증거가 아니다.** 변이 증명을 붙인다 — **단, 불변식에 닿는 방어에만**(레이트 리밋·삭제·탈퇴·유출 금칙). 정적 페이지나 링크 배치에는 붙이지 않는다(리뷰 MINOR 22·과잉 지적 수용).
4. **공허한 초록을 의심한다.** 새 단언마다 **"이게 통과하는 잘못된 구현이 있는가"**를 자문한다.
5. **`test:integration`과 `e2e`를 동시에 돌리지 않는다.** 둘 다 같은 test 브랜치를 TRUNCATE하고, 중단된 쪽의 유휴 커넥션이 다음 TRUNCATE를 막아 vitest가 조용히 멈춘다. 복구는 유휴 백엔드에 `pg_terminate_backend`.
6. **푸시가 워크플로 런을 만들지 않는 일이 있다.** 런 존재를 확인하고 없으면 후속 커밋으로 되살린다.
7. 스키마 변경은 `db:generate` → **SQL을 눈으로 읽고** → dev·test 적용. 프로덕션은 CI `deploy` 잡.
8. `.env.*`와 시크릿 값은 절대 출력·커밋하지 않는다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/db/schema.ts` | `rate_limits` 테이블, `user.deletedAt` |
| `middleware.ts` | **신규** — `/g/:path*` 레이트 리밋 판정·429 응답 |
| `lib/rate-limit.ts` | `createRateLimiter(exec)` — 원자적 upsert, **주입 가능**(fail-open 테스트를 위해) |
| `lib/client-ip.ts` | IP 파싱·정규화·HMAC |
| `app/api/cron/cleanup/route.ts` | 만료 행 정리 (`CRON_SECRET`) |
| `vercel.json` | **기존 파일에 `crons`만 병합** — `git.deploymentEnabled`를 덮지 말 것 |
| `lib/db/delete.ts` | 파괴되는 것의 전체 목록(순서 포함) |
| `actions/group.ts` | `deleteGroup` |
| `actions/account.ts` | `deleteAccount` |
| `app/privacy/page.tsx` | 개인정보처리방침 |
| `docs/adr/004-deletion-semantics.md` | 탈퇴가 ADR-003과 충돌하는 지점의 결정 + **보존되는 것의 한계** |

---

## Task 1: 공개 장부 레이트 리밋 (미들웨어)

**Files:** `lib/db/schema.ts` · `lib/client-ip.ts`(+test) · `lib/rate-limit.ts` · `middleware.ts` · `test/rate-limit.integration.test.ts` · `app/api/cron/cleanup/route.ts` · `vercel.json` · `e2e/public-ledger.spec.ts`

### 설계 근거

- **왜 미들웨어인가** — App Router의 `page.tsx`(서버 컴포넌트)는 임의 상태 코드·헤더를 낼 수 없다. 초안은 "429 + `Retry-After` + 한국어 안내 페이지"를 `page.tsx`에 넣으라고 했는데, 그대로 하면 **화면은 보이는데 status/header 단언이 실패**한다. 판정과 응답은 미들웨어에서 한다.
- **미들웨어는 엣지 런타임** — `lib/db/index.ts`의 `neon-serverless` Pool(WebSocket)은 쓸 수 없다. `@neondatabase/serverless`의 `neon()`(fetch 기반)을 쓴다. 이 레포는 이미 `scripts/`·`test/db-guard.ts`에서 그것을 쓰고 있다.
- **IP는 평문으로 저장하지 않는다** — `rate_limits.bucket`에 원본 IP를 넣으면 ① 개인정보를 수집·보관하는 것이므로 처리방침에 적어야 하고 ② IPv6 표기 흔들림·포트 포함·비정상 길이가 그대로 PK에 들어가 우회와 인덱스 팽창을 동시에 만든다. **HMAC-SHA256(salt, ip)의 앞 32자**만 저장한다 — 길이가 고정되고, DB만 봐서는 IP를 복원할 수 없다. 엣지에서는 Node `createHmac`이 없으므로 **Web Crypto(`crypto.subtle`)**를 쓴다.
- **IP당으로 거는 이유** — 토큰당으로 걸면 20명짜리 모임이 링크를 동시에 열 때 정상 사용자가 막힌다. 토큰은 128비트라 열거는 불가능하고, 실제 위험은 유출된 링크의 반복 긁기와 함수 호출 비용이다.
- **fail-open** — 카운터 쓰기가 실패하면 통과시킨다. 장부를 못 보게 하는 것보다 레이트 리밋이 잠깐 없는 게 낫다. **이 정책이 핵심이므로 테스트 가능해야 한다** → 실행기를 주입받는 구조로 만든다.
- **고정 윈도의 한계**(리뷰 MINOR 18 수용): 윈도 경계에서 최대 2배 버스트가 가능하다. 비용 방어 목적에는 충분하므로 v1은 고정 윈도로 가고, **그 한계를 주석에 적는다.**

- [ ] **Step 1: `x-forwarded-for` 신뢰 경계를 먼저 확인한다** ⚠️ *구현 전에*

리뷰 블로커 1: "테스트에서 임의 IP를 만들 수 있다"와 "클라이언트가 IP를 속일 수 없다"가 동시에 참이어야 하는데, 초안은 그걸 증명하지 않았다. **Plan 03 Task 6은 로컬 `next start`에서 컨텍스트별 XFF 주입이 먹혔다고 기록**했는데, 같은 문서가 "Next가 소켓 주소로 XFF를 채운다"고도 적었다 — **둘은 양립할 수 없다.** 어느 쪽이 맞는지 실측한다.

1. 로컬 `next start`에 XFF를 넣은 요청과 안 넣은 요청을 보내 미들웨어가 읽는 값을 찍는다
2. **배포된 프로덕션**에 XFF를 위조해 보내 Vercel이 덮어쓰는지/덧붙이는지/보존하는지 확인한다
3. 결과를 `lib/client-ip.ts` 주석과 구현 노트에 남긴다

**판정 기준**: Vercel이 XFF를 덮어쓴다면 프로덕션에서 위조 불가이고 e2e의 XFF 주입은 로컬에서만 유효하다(그것으로 충분). **보존한다면 XFF 직접 신뢰를 중단하고** 플랫폼 전용 헤더로 바꾸거나 첫 항목이 아닌 마지막 항목을 쓴다. 확인 결과에 따라 Step 3을 고쳐 쓴다.

- [ ] **Step 2: `client-ip` 실패 테스트**

IPv4/IPv6 **파싱·검증**까지 한다(리뷰 IMPORTANT 6). 유효하지 않은 값은 `null`.

```ts
// 통과해야 할 것
clientIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })) === '203.0.113.7'
clientIp(h({ 'x-forwarded-for': '  203.0.113.7 ,10.0.0.1' })) === '203.0.113.7'
clientIp(h({ 'x-forwarded-for': '2001:db8::1' })) === '2001:db8::1'
clientIp(h({ 'x-real-ip': '203.0.113.9' })) === '203.0.113.9'
// null이어야 할 것 — 버킷 오염·우회 경로를 만들지 않는다
clientIp(h({})) === null
clientIp(h({ 'x-forwarded-for': '   ' })) === null
clientIp(h({ 'x-forwarded-for': 'not-an-ip' })) === null
clientIp(h({ 'x-forwarded-for': 'A'.repeat(500) })) === null
clientIp(h({ 'x-forwarded-for': '203.0.113.7:8080' })) === null  // 포트 포함은 거부하거나 벗겨낸다 — 한쪽으로 일관되게
```

`hashIp(ip, salt)` — HMAC-SHA256 앞 32자. 같은 입력 → 같은 출력, 다른 salt → 다른 출력, **출력에 원본 IP가 포함되지 않음**을 단언한다.

- [ ] **Step 3: 실패 확인 → 구현 → 통과 확인**

IP가 `null`이면 **제한하지 않는다**(`'unknown'` 같은 상수로 뭉뚱그리면 IP를 못 읽은 모든 요청이 한 버킷에 들어가 한 사람이 전체를 잠근다). `RATE_LIMIT_SALT`가 없으면 **시작 시 에러** — 시크릿 기본값 하드코딩 금지(글로벌 규칙).

- [ ] **Step 4: 레이트 리밋 통합 테스트 (실패부터)**

```ts
// 주입 가능한 형태 — fail-open을 실제로 테스트할 수 있어야 한다 (리뷰 블로커 2)
export function createRateLimiter(exec: SqlExecutor) { return async (bucket, limit, windowSeconds) => {...} }
export const checkRateLimit = createRateLimiter(defaultExec);
```

고정할 것:
1. 한도 안 → `{ allowed: true }`
2. 한도 초과 → `{ allowed: false, retryAfterSeconds }` (1 이상, 윈도 이하)
3. **다른 버킷은 영향 없음** ← 없으면 "전부 막기"가 통과한다
4. 윈도 경과 후 리셋 (`window_start`를 과거로 직접 UPDATE해 강제)
5. **동시 요청이 한도를 넘겨 새지 않음** — `Promise.all`로 한도+5개를 던져 `allowed`가 정확히 한도 개수인지 (원자적 upsert가 정말 원자적인가)
6. **fail-open** — 던지는 `exec`를 주입해 `{ allowed: true }` + 에러 로깅 확인

- [ ] **Step 5: 구현**

`Retry-After`는 **SQL 안에서 계산한다**(리뷰 IMPORTANT 7) — 윈도 시작은 DB의 `now()`인데 경과 시간을 앱의 `Date.now()`로 재면 시계 차이로 음수·과대값이 나온다.

```sql
insert into rate_limits (bucket, count, window_start)
values ($1, 1, now())
on conflict (bucket) do update set
  count = case when rate_limits.window_start < now() - make_interval(secs => $2)
               then 1 else rate_limits.count + 1 end,
  window_start = case when rate_limits.window_start < now() - make_interval(secs => $2)
                      then now() else rate_limits.window_start end
returning count,
  greatest(1, ceil(extract(epoch from
    (rate_limits.window_start + make_interval(secs => $2)) - now())))::int as retry_after_seconds
```

> ⚠️ `returning` 절에서 `rate_limits.window_start`가 **갱신 후 값**인지 확인하라. 아니면 `excluded`/서브쿼리로 바꾼다. `db.execute`의 반환 모양(`rows` 유무)도 실제로 찍어 확인하고 플랜과 다르면 맞춘 뒤 보고한다.

- [ ] **Step 6: 미들웨어 적용**

`matcher: ['/g/:path*']`. 한도 **60회/분**. 초과 시 `NextResponse`로 429 + `Retry-After` + 한국어 안내 HTML. 인증 앱 경로는 매처에 들어가지 않는다.

- [ ] **Step 7: e2e + 변이 증명**

**⚠️ 기존 18개 테스트가 같은 IP로 `/g/`를 여러 번 친다** — 스펙·워커마다 XFF를 다르게 줘서 자기 테스트가 자기를 막지 않게 한다.

- 한도 초과 → 429 + `Retry-After`
- **다른 IP는 여전히 200** ← 없으면 "전부 막기"가 통과한다
- `/`, `/login`은 제한되지 않음

**변이 증명**: 미들웨어의 한도 검사를 무력화 → 429 테스트가 빨개지는 것을 관측·되돌림·보고.

- [ ] **Step 8: 정리 크론**

`CRON_SECRET`을 **먼저 존재 확인**한다 — `auth === \`Bearer ${process.env.CRON_SECRET}\``만 쓰면 환경변수 미설정 시 `Bearer undefined`가 통과한다(리뷰 IMPORTANT 8). 테스트는 **env 없음 / 헤더 없음 / 틀린 값 / 맞는 값** 넷을 분리한다.

`vercel.json`은 **이미 존재한다**(`git.deploymentEnabled.main=false` — 이 레포의 유일한 배포 경로를 지키는 설정이다). **`crons` 키만 병합하고 기존 키를 보존한다.** 병합 후 기존 키가 그대로인지 확인한다.

보관기간은 **24시간**으로 하고 그 값을 처리방침과 일치시킨다(Task 4).

- [ ] **Step 9: 게이트 + 커밋**

---

## Task 2: 모임 완전 삭제

**Files:** `lib/db/delete.ts` · `actions/group.ts` · 설정 화면 · `test/group-delete.integration.test.ts` · `e2e/authz.spec.ts`

### 설계 근거

- **스키마에 `onDelete`가 하나도 없다** — 전부 기본 `NO ACTION`. 캐스케이드는 없으니 순서대로 지워야 한다.
- `ledger_entries`의 자기참조 FK는 **한 문장으로 부모·자식을 함께 지우면 통과한다**(`NO ACTION`은 문장 종료 시 검사). **테스트로 고정한다** — 다음 사람이 `RESTRICT`로 바꾸면 조용히 깨진다.
- **행 잠금이 필요하다**(리뷰 블로커 3): 삭제 트랜잭션 중 다른 액션이 같은 모임에 원장·납부를 새로 넣으면 마지막 `groups` 삭제가 23503으로 실패하거나 교착이 생긴다. 트랜잭션 시작 시 `select ... from groups where id = $1 for update`.
- **이름 확인은 그 잠금 뒤, 트랜잭션 안에서 한다**(리뷰 IMPORTANT 11). 액션 진입 시 읽은 이름으로 비교하면 그 사이 이름이 바뀌었을 때 **사용자가 다른 이름의 모임을 지운다.**
- **클라이언트 확인은 연출이다** — 서버 액션은 공개 엔드포인트다(ADR-002).

- [ ] **Step 1: 실패 테스트**

1. 모임 A·B에 각각 원장 2건(하나는 역분개)·회차 1·납부 1·정산 1(참여자 2·이체 1)·멤버십 2
2. A 삭제 → **A 소유 행이 전부 0**
3. **B의 행 수 불변** ← 고전적 삭제 버그를 잡는 자리
4. 틀린 이름 → `NAME_MISMATCH`, **아무 행도 삭제되지 않음**
5. 멤버가 호출 → `FORBIDDEN`, 행 불변
6. 역분개가 달린 원장이 **한 문장으로** 삭제됨
7. 삭제 후 `publicToken`으로 `getPublicLedger` → null
8. **삭제 대상 목록이 FK 메타데이터와 일치한다**(리뷰 IMPORTANT 10) — "12개 테이블"을 손으로 적지 않는다. `groups`를 직접·간접 참조하는 테이블을 DB 메타데이터에서 찾아 `lib/db/delete.ts`의 목록과 대조한다. 테이블이 추가되면 **이 테스트가 먼저 빨개진다.**

- [ ] **Step 2: 실패 확인 → Step 3: 구현 → Step 4: 통과 확인**

- [ ] **Step 5: 설정 화면** — 총무만 보이는 위험 구역. 모임 이름 타이핑 → 서버 재확인. testid `delete-group`, `delete-group-confirm`.

- [ ] **Step 6: 인가 매트릭스** — `deleteGroup`을 8번째 액션으로. **성공 대조군은 맨 마지막**(삭제는 파괴적이라 뒤따르는 테스트가 의존할 수 없다 — Plan 03 Task 11의 재발급 순서 해법 그대로).

- [ ] **Step 7: 게이트 + 커밋**

---

## Task 3: 회원 탈퇴

**Files:** `docs/adr/004-deletion-semantics.md` · `lib/db/schema.ts` · `actions/account.ts` · `test/account-delete.integration.test.ts` · 계정 설정 화면 · `e2e/authz.spec.ts`

### 설계 근거 — 먼저 ADR을 쓴다

**`user` 행은 지울 수 없다.** `memberships.userId` · `ledger_entries.created_by` · `settlements.created_by` 셋이 `notNull`로 참조한다.

| 대상 | 처리 | 이유 |
|---|---|---|
| `user.email` | `deleted-<uuid>@deleted.invalid` | 유니크 유지 + **같은 이메일로 재가입 가능** |
| `user.name`, `image` | `'탈퇴한 사용자'`, `null` | 식별자 제거 |
| `user.deletedAt` | `now()` | 세션·로그인 차단 판정 |
| `account`(자격증명) | **행 삭제** | 비밀번호 해시 제거 |
| `session` | **행 삭제** | 즉시 로그아웃 |
| `verification` | **행 삭제** | 이메일이 담길 수 있다 (리뷰 IMPORTANT 13) |
| `memberships.displayName` | `'탈퇴한 멤버'` | 행은 남긴다 — **지우면 회비 납부 체크가 사라져 과거 회차가 "미납"으로 보인다**(없던 사실이 생긴다) |
| `settlement_participants.displayNameAtTime` | `'탈퇴한 멤버'` | **`membershipId`로 찾는다** — 이름 문자열 매칭 금지(동명이인·개명 이력을 놓친다) |
| 금액·구조 전부 | **불변** | ADR-001 |
| **`user.id` (내부 UUID)** | **보존된다** | FK 셋이 참조한다. **이 한계를 숨기지 않는다** — 아래 |

**ADR-004가 정해야 할 것 두 가지:**

1. **ADR-003과의 충돌** — ADR-003은 "조회 시 현재 명단을 조인하면 과거 정산이 소급 변경된다"며 이름을 굳혔다. 탈퇴는 그 굳힌 이름을 바꾼다. 결정: **탈퇴는 소급 변경이 아니라 파기다.** ADR-003이 막으려던 것은 "명단이 바뀌었다고 기록이 따라 변하는 것"이고, 파기는 정보주체의 권리 행사다. 금액·참여 인원·이체 구조가 보존되므로 **정산의 사실관계는 남고 이름만 지워진다.**
2. **익명화의 한계 — 정직하게 적는다** (리뷰 ★2·블로커 5 수용):
   - **내부 UUID(`user.id`)는 보존된다.** 탈퇴자의 과거 활동은 하나의 안정적 식별자로 계속 연결된다. 그 UUID 자체에는 개인정보가 없지만 "완전한 익명화"는 아니다. `created_by`를 nullable로 바꾸는 대안은 3개 테이블 마이그레이션 + "누가 기록했는가"의 영구 소실을 대가로 하므로 v1에서는 채택하지 않는다. **이 판단을 ADR에 적고 처리방침에도 한 줄로 고지한다.**
   - **자유 텍스트는 파기 대상이 아니다.** 사용자가 원장 메모·계좌 문구·정산 제목에 자기 이름이나 이메일을 적었다면 그것은 남는다. 파기 범위는 **"계정·프로필·멤버십·정산 참여자 스냅샷의 구조화된 식별자"**로 명시한다. 자유 텍스트까지 지우려면 PII 탐지가 필요하고 그건 이 플랜 범위를 크게 넘는다.

**총무는 탈퇴할 수 없다** — 소유한 모임이 있으면 거부한다. 에러 문구는 이유를 설명한다: "소유한 모임을 먼저 삭제해 주세요. 총무를 다른 멤버에게 넘기는 기능은 아직 없습니다." **총무 위임이 제품상 미결이라는 사실을 ADR에도 적는다**(리뷰 MINOR 23).

- [ ] **Step 1: ADR-004 작성 · 커밋** (구현 전에)

- [ ] **Step 2: 실패 테스트**

1. 멤버 탈퇴 → `user` 이메일·이름 익명화, `account`·`session`·`verification` 0행
2. **모임 잔액 불변, 원장 행 수 불변** (ADR-001)
3. **과거 회비 납부 체크 유지** — 탈퇴자가 냈던 회차가 여전히 "납부"
4. 정산 금액·참여자 수·이체 구조 불변, 이름만 `'탈퇴한 멤버'` — **`membershipId`로 찾았는지** 동명이인 픽스처로 확인
5. **구조화된 식별자 컬럼에 원래 이메일·표시명이 없다** (주장 범위를 좁힘 — 자유 텍스트는 제외하고, 그 사실을 테스트 이름에 적는다)
6. 총무가 호출 → `OWNS_GROUPS`, **아무것도 바뀌지 않음**
7. 탈퇴한 이메일로 **재가입 가능**
8. 탈퇴 후 기존 세션 쿠키로 접근 → 인증 실패
9. **동시성**(리뷰 IMPORTANT 12): 탈퇴 트랜잭션과 원장 생성이 겹칠 때 `deletedAt`이 찍힌 사용자로 새 엔트리가 생기지 않는다. 탈퇴 시 `user` 행을 잠그고, 쓰기 인가 계층이 **쓰기 직전에도** `deletedAt is null`을 확인한다.

- [ ] **Step 3: 실패 확인 → Step 4: 구현 → Step 5: 통과 확인**

Better Auth의 `deleteUser`는 **쓰지 않는다** — 하드 삭제라 FK 셋을 깬다. 이 사실을 주석에 남긴다. 차단은 앱 미들웨어가 아니라 **세션을 해석하는 공통 auth 계층**에서 한다(리뷰 IMPORTANT 14) — 미들웨어만 막으면 서버 액션의 auth 헬퍼와 불일치한다.

- [ ] **Step 6: 변이 증명** — `memberships.displayName` 익명화를 끄면 5번이, `account` 삭제를 끄면 5번/8번이 빨개지는지 확인·되돌림·보고.

- [ ] **Step 7: 화면** — 계정 설정 위험 구역. `탈퇴합니다` 타이핑 → 서버 재확인. testid `delete-account`, `delete-account-confirm`.

- [ ] **Step 8: 게이트 + 커밋**

---

## Task 4: 개인정보처리방침

**Files:** `app/privacy/page.tsx` · 푸터 · 가입/로그인 화면 · 공개 장부 푸터 · 공개 링크 발급 화면 · `e2e/public-ledger.spec.ts`

> **표현 주의**(리뷰 MINOR 24): 이 문서를 "법적 형식을 갖춘"이라고 부르지 않는다. 법률 자문 없이 그렇게 단정할 수 없다. **서비스 정책**으로 쓰고, 필수 항목을 체크리스트로 갖춘다.

### 내용 — Task 1·3과 **한 글자도 어긋나면 안 된다**

- **수집 항목**: 이메일 · 비밀번호(해시) · 표시명 · 모임 활동 기록(회비·지출·정산) · **세션 쿠키** · **접속 IP의 해시값**(레이트 리밋 목적, 평문 미보관, **24시간 보관** — Task 1의 크론 주기와 일치시킬 것)
- **목적**: 서비스 제공 / 남용 방지(IP 해시)
- **보관·파기**: 탈퇴 즉시 파기. **Task 3의 표 그대로 적는다** — 무엇이 지워지고 **무엇이 남는지**(모임의 금액 기록은 익명 상태로 남음, 내부 식별자 보존, 자유 텍스트는 파기 대상 아님)를 숨기지 않는다
- **제3자 제공**: 없음
- **처리 위탁 / 국외 이전**: Vercel(호스팅), Neon(DB). ⚠️ **실제 리전을 확인해서 국가명을 적는다 — 추측 금지**
- **이용자 권리**: 열람·삭제 = **셀프서비스 경로 명시**(탈퇴·모임 삭제 버튼 위치)
- **공개 장부 고지**: 링크 보유자는 로그인 없이 장부를 본다. 재발급하면 이전 링크는 즉시 무효
- **문의**: GitHub 이슈 — **"개인정보를 이슈에 적지 마세요"를 명시**하고, 삭제·열람은 화면에서 직접 하도록 안내한다(리뷰 IMPORTANT 15). 전용 연락처는 실사용자를 받는 시점에 추가한다
- **시행일**

- [ ] **Step 1: 페이지 작성** — 기존 스위스 그리드 타이포 그대로. 새 컴포넌트를 만들지 않는다.
- [ ] **Step 2: 링크 배치** — 가입 화면(동의 맥락) · 전역 푸터 · 공개 장부 푸터.
- [ ] **Step 3: 공개 링크 노출 경고**(리뷰 IMPORTANT 16) — 링크 발급·재발급 화면에 "이 링크를 가진 사람은 로그인 없이 멤버 이름과 지출 내역을 봅니다 / 재발급하면 기존 링크는 즉시 무효" 고지. 푸터 링크만으로는 인지 흐름이 약하다.
- [ ] **Step 4: e2e** — `/privacy` 비로그인 200. 공개 장부에서 링크 도달 가능. **⚠️ 외부 호스트 요청 0건 단언을 `/privacy`까지 확장**(리뷰 MINOR 21) — 깨지는 경로는 링크 자체가 아니라 그 페이지가 외부 폰트·원격 이미지를 넣을 때다.
- [ ] **Step 5: 게이트 + 커밋**

---

## Task 5: 마감

- [ ] **Step 1: 한도 초과 검증은 test 브랜치에서** (리뷰 과잉 지적 수용) — 프로덕션 공개 링크를 한도까지 두드리지 않는다. 429·`Retry-After`·다른 IP 200은 로컬/test에서 확인하고, **프로덕션에서는 정상 접근 1회와 크론 401만** 본다.

- [ ] **Step 2: 프로덕션 스모크 — 만든 기능으로 지운다**

계정 2개로 모임 개설 → 회비·지출·정산 → 공개 링크 확인 → **한 명 탈퇴**(잔액·원장 불변, 이름이 `탈퇴한 멤버`) → **모임 삭제**(공개 링크 404) → 남은 계정 탈퇴.

> ⚠️ **확인 범위는 이번 스모크가 만든 id로 한정한다**(리뷰 IMPORTANT 17). "12개 테이블 전부 0행"은 실사용자 0명일 때만 맞는 절차이고, 문서로 남으면 첫 사용자 이후 **사고 절차**가 된다. 손으로 DELETE 하지 말고 만든 기능으로 지운다 — 다 지웠는데 자기 id의 행이 남으면 그게 버그다.

- [ ] **Step 3: 문서** — README에 탈퇴·삭제·처리방침 반영. `requirements.md`의 미결 항목에서 "공개 링크 레이트 리밋" 닫기. **총무 위임 미구현**을 제품 미결로 기록.
- [ ] **Step 4: 게이트 + 커밋 + CI 3잡 초록 확인**

---

## 외부 리뷰 판정 (2026-09-16, codex)

| # | 등급 | 지적 | 판정 |
|---|---|---|---|
| ★1 | BLOCKER | `page.tsx`는 429/헤더를 낼 수 없다 | **수용** — 미들웨어로 이동 (Task 1) |
| ★2 | BLOCKER | 익명화 후에도 `user.id`가 영구 식별자 | **부분 수용** — 스키마 변경(3컬럼 nullable)은 기각: "누가 기록했는가"의 영구 소실 대비 이득이 적고, 외부 매핑 없는 UUID는 그 자체로 개인정보가 아니다. **대신 한계를 ADR·처리방침에 명시**. "되돌릴 수 없는 익명화"라는 초안 표현은 과했음 — 삭제 |
| ★3 | BLOCKER | IP가 개인정보인데 수집 명세에 없음 | **수용** — HMAC 저장 + 처리방침에 24시간 보관 명시 |
| 1 | BLOCKER | XFF 신뢰 경계 미증명 | **수용** — Task 1 Step 1에서 **구현 전에 실측**. Plan 03의 두 기록이 서로 모순임을 확인 |
| 2 | BLOCKER | fail-open이 현 시그니처로 테스트 불가 | **수용** — `createRateLimiter(exec)` 주입 |
| 3 | BLOCKER | 삭제 중 동시 쓰기 → 23503/교착 | **수용** — `for update` 잠금 |
| 4 | BLOCKER | 정산 참여자 익명화 키 미지정 | **부분 수용** — 키 명시는 수용. 단 "스키마 변경이 필요할 수 있다"는 전제는 **사실과 다름**: `settlement_participants.membershipId`가 이미 있다 |
| 5 | BLOCKER | "DB 어디에도 없다"는 자유 텍스트 때문에 거짓 | **수용** — 파기 범위를 구조화된 식별자로 한정, 처리방침에도 고지 |
| 6 | IMPORTANT | bucket 미검증·미정규화 | **수용** — IP 파싱 + HMAC(고정 길이) |
| 7 | IMPORTANT | `Date.now()` vs DB 시계 | **수용** — SQL에서 계산 |
| 8 | IMPORTANT | `Bearer undefined` 통과 | **수용** — env 존재를 먼저 검사, 4가지 케이스 분리 |
| 9 | IMPORTANT | `vercel.json` 생성이 기존 설정을 덮음 | **수용** — 파일 존재 확인함. `crons`만 병합 |
| 10 | IMPORTANT | "12개 테이블"은 낡는다 | **수용** — FK 메타데이터와 대조 |
| 11 | IMPORTANT | 이름 확인을 트랜잭션 안에서 | **수용** |
| 12 | IMPORTANT | 탈퇴 중 동시 쓰기 | **수용** — 잠금 + 쓰기 직전 `deletedAt` 확인 |
| 13 | IMPORTANT | Better Auth 테이블 전수 | **수용** — `verification` 존재 확인함, 표에 추가 |
| 14 | IMPORTANT | 로그인 차단 위치 모호 | **수용** — 공통 auth 계층에서 |
| 15 | IMPORTANT | GitHub 공개 이슈는 개인정보 창구로 부적절 | **수용** — 경고 문구 + 셀프서비스 우선 안내. 전용 연락처는 실사용자 시점 |
| 16 | IMPORTANT | 공개 링크 노출 고지 부족 | **수용** — 발급·재발급 화면에 고지 |
| 17 | IMPORTANT | 프로덕션 "전 테이블 0행"은 위험한 절차 | **수용** — 스모크 자기 id로 한정 |
| 18 | MINOR | 고정 윈도 경계 2배 버스트 | **수용(문서화)** — 비용 방어엔 충분, 한계를 주석에 |
| 21 | MINOR | 외부요청 0건은 `/privacy`까지 | **수용** |
| 22 | MINOR | 변이 증명이 수동 보고 의존 | **부분 수용** — 불변식에 닿는 방어에만 적용, 정적 페이지 제외 |
| 23 | MINOR | 총무 위임 부재의 UX 문구 | **수용** — 이유를 설명하는 에러 + ADR에 미결 기록 |
| 24 | MINOR | "법적 형식" 과잉 표현 | **수용** — "서비스 정책"으로 |

**과잉 지적**: 프로덕션 한도 초과 테스트 → test 브랜치로 이동(수용). 모든 방어에 변이 증명 → 불변식 한정(수용). 크론이 긴급하지 않다 → **기각**: IP 해시를 저장하는 순간 보관기간이 생기고, 그러면 정리가 기능의 일부가 된다(리뷰 스스로 같은 단서를 달았다).

## Self-Review

**범위** — 사용자가 고른 세 가지를 Task 1·2·3·4가 덮는다. 기능 확장 없음. 다중 채권자 정산은 범위 밖이며 실사용 한 달 뒤 판단한다.

**의도적 제외**: 총무 위임 · 전용 문의 이메일 · 토큰당 레이트 리밋 · 슬라이딩 윈도 · 자유 텍스트 PII 파기.

**아직 확인되지 않은 가정** (구현자는 확인하고 보고한다)
1. Vercel·로컬의 `x-forwarded-for` 처리 (Task 1 Step 1에서 실측 — Plan 03의 두 기록이 모순)
2. `db.execute` 반환 모양, `returning` 절의 `window_start`가 갱신 후 값인지
3. 자기참조 FK가 한 문장 삭제에서 통과하는지 (`NO ACTION` 문장 말미 검사 가정)
4. Vercel Hobby 크론 제약(개수·주기)
5. 미들웨어 엣지 런타임에서 `neon()` HTTP 드라이버가 동작하는지
6. Better Auth가 `user`를 직접 UPDATE했을 때 세션 검증 경로의 반응
