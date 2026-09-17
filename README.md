# 엔빵 (nbbang)

동호회·스터디 총무를 위한 회비 장부 — 걷고, 쓰고, 나누고, 투명하게 공개한다.

> **상태**: **v1 완성**(F1~F7) + **실사용 전 하드닝 완료**(Plan 04)·배포 — https://nbbang-iota.vercel.app
> 걷고(F2), 쓰고(F3), 엔빵하고(F4), 링크 하나로 공개하고(F5), 미납 문구를 복붙하고(F6),
> CSV로 내보낸다(F7). 잔액은 언제나 원장 합산의 파생값이다(ADR-001).
> 실제 사람을 받기 전에 필요한 넷 — 공개 링크 레이트 리밋 · 모임 완전 삭제 · 회원 탈퇴 ·
> [개인정보처리방침](https://nbbang-iota.vercel.app/privacy) — 도 들어갔다([아래](#지우기와-남용-방지-plan-04)).

## 왜

총무는 매달 회비를 걷고, 지출하고, 엑셀 스크린샷을 카톡방에 올린다.
누가 냈는지 추적하고, 회식 엔빵을 계산하고, "회비 어디에 썼어요?"에 답하는 일 —
엔빵은 이 세 가지 스트레스를 없앤다.

## v1 범위

- [x] **F1** 모임 개설·초대 링크·멤버 관리 (총무/멤버 역할) — Plan 01
- [x] **F2** 회비 회차 생성 + 멤버별 납부 체크 — Plan 02
- [x] **F3** 지출 기록 (카테고리·메모, 역분개로 정정) — Plan 02
- [x] **F4** 정산 마법사 — 엔빵 계산, "누가 누구에게 얼마" 이체 목록 — Plan 03
- [x] **F5** **공개 장부 뷰** — 로그인 없이 링크로 열람 (총무만 가입해도 모임 전체가 씀) — Plan 03
- [x] **F6** 미납 현황 복붙 텍스트 (입금 계좌 한 줄까지) — Plan 02·03
- [x] **F7** CSV 내보내기 — Plan 03

**v1 범위는 전부 구현·배포됐다.** F4는 **선결제자 1명** 모델이다 — 한 사람이 총액을 먼저 내고
나머지가 그에게 보낸다(회식비 엔빵). 여러 명이 나눠 낸 정산의 다중 채권자 상계는 v1 범위 밖이다
([ADR-003](docs/adr/003-settlement-outside-ledger.md)).

비범위(v2+): 실결제/PG, 청구서·알림 발송, 영수증 OCR, 은행 연동, 다중 채권자 상계 정산.

### 공개 장부 링크 쓰는 법 (F5)

모임 **설정** 화면의 '공개 장부 링크'를 복사해 단톡방에 붙인다. 받은 사람은 로그인 없이
잔액·전체 기록·멤버 표시 이름을 본다 — 쓰기 수단은 없고, 이메일·초대 토큰·입금 계좌 문구는
그 화면에 나가지 않는다. 링크가 엉뚱한 곳으로 새면 같은 화면에서 **재발급**한다(옛 링크는
즉시 404가 된다). 검색 엔진 색인·리퍼러 전달·CDN 캐시는 응답 헤더로 모두 막혀 있다.

## 지우기와 남용 방지 (Plan 04)

v1 기능이 아니라 **실제 사람을 받기 전의 마감**이다. 넷 다 배포돼 있다.

| 것 | 어디서 | 무엇을 보장하는가 |
|---|---|---|
| **회원 탈퇴** | 내 모임 → **계정** → 위험 구역 (`탈퇴합니다` 타이핑) | 계정·프로필·멤버십·정산 스냅샷의 **구조화된 식별자를 파기**한다. 행 삭제가 아니다 — 금액·이체 구조는 그대로 남고 이름만 `탈퇴한 멤버`가 된다 ([ADR-004](docs/adr/004-deletion-semantics.md)) |
| **모임 완전 삭제** | 모임 → **설정** → 위험 구역 (모임 이름 타이핑) | 그 모임의 7개 자식 테이블 + `groups`를 **한 트랜잭션에서 순서대로** 지운다. 공개 링크는 즉시 404 |
| **개인정보처리방침** | [`/privacy`](https://nbbang-iota.vercel.app/privacy) | 법률 문서가 아니라 **코드가 하는 일을 그대로 옮긴 서비스 정책**이다. 무엇이 남는지(내부 UUID·자유 텍스트)까지 적는다 |
| **공개 링크 레이트 리밋** | `middleware.ts` (`/g/:path*`) | 같은 접속 IP에서 **분당 60회**. 초과하면 429 + `Retry-After`. IP는 **HMAC-SHA256 앞 32자**로만 저장하고 하루 한 번 도는 크론이 치운다(정직한 상한 **최대 48시간** — Hobby 크론은 1일 1회가 최소다) |

세 가지 판단이 이 기능들의 모양을 정했다. 다음 사람이 되돌리기 쉬운 자리라 여기 적어 둔다.

- **탈퇴는 `user` 행 삭제가 아니다.** `memberships.user_id`·`ledger_entries.created_by`·
  `settlements.created_by` 셋이 `notNull`로 참조한다. 행을 지우려면 셋을 nullable로 바꿔야 하고
  그러면 "누가 기록했는가"가 영구히 사라진다. 그래서 **식별자 파기 + 내부 UUID 보존**이고,
  그 한계("연결할 수 없는 익명화는 아니다")를 ADR과 처리방침에 적었다.
- **멤버십 줄을 지우지 않는다.** 지우면 그 사람이 냈던 회비가 사라져 과거 회차가 `미납`으로
  보인다 — 없던 사실이 생긴다.
- **세션 행에 접속 IP·User-Agent를 적지 않는다.** Better Auth의 기본 동작은 적는 것이고,
  그것을 끄는 공식 스위치(`advanced.ipAddress.disableIpTracking`)는 **같은 플래그로 가입·로그인
  레이트 리밋까지 끈다**(`getIP`가 `null`을 돌려주면 판정 설정 자체가 버려진다). 그래서
  `lib/auth.ts`는 `databaseHooks.session.create.before`로 두 값만 비우고 `getIP`는 살려 둔다.
  `test/session-privacy.integration.test.ts`가 **양쪽**을 고정한다 — 값이 비어 있는 것과,
  로그인 제한이 여전히 IP별로 429를 내는 것.

탈퇴·삭제는 **되돌릴 수 없고** 유예기간이 없다. 확인 문구는 화면 연출이 아니라 서버 액션이
트랜잭션 안에서 다시 검사한다(ADR-002 — 서버 액션은 공개 엔드포인트다).

## 스택

Next.js 15 (App Router, 서버 액션) · React 19 · TypeScript · Drizzle · Neon (Postgres) · Better Auth · Tailwind v4 · Vercel

### 환경 (Neon 브랜치 3개)

| 브랜치 | 용도 | 주입 위치 |
|---|---|---|
| `production` | 배포 | Vercel 환경변수 |
| `dev` | 로컬 개발 | `.env.local` |
| `test` | E2E (로컬·CI) | `.env.test` / GitHub `TEST_DATABASE_URL` |

E2E는 대상 DB를 TRUNCATE하므로 `test` 브랜치에만 `e2e_guard.sentinel` 마커 테이블을 만든다 (`.env.example` 참고).

### 스키마 변경 (버전 마이그레이션)

`drizzle-kit push`는 폐기됐다 — 사람이 세 브랜치를 각각 기억해 돌리는 구조였고, Plan 02에서
`production`을 빠뜨려 새 테이블을 읽는 대시보드가 프로덕션에서 500을 냈다. 이제 스키마 변경은
**커밋되는 마이그레이션 파일**(`drizzle/*.sql`)이 진실 원천이다.

```bash
# 1. lib/db/schema.ts 수정 후 마이그레이션 생성 (커밋 대상)
npm run db:generate

# 2. 생성된 SQL을 눈으로 읽는다 — DROP이 의도치 않게 들어갔는지 확인

# 3. 로컬 dev·test에 적용
npm run db:migrate        # dev  (.env.local)
npm run db:migrate:test   # test (.env.test)
```

E2E(`npm run e2e`)는 실행마다 test 브랜치에 `drizzle-kit migrate`를 돌린다 — 그래서 마이그레이션
누락·오류는 CI에서 빨갛게 드러난다.

`production` 적용과 배포는 **main 푸시 시 CI의 `deploy` 잡이 한다**. 순서는 마이그레이션 →
배포다(스키마를 먼저 올려야 새 코드가 없는 컬럼을 읽지 않는다). 마이그레이션이 실패하면 잡이
멈춰 배포가 일어나지 않고, 프로덕션은 이전 배포로 계속 서비스된다.

배포는 Vercel CLI가 아니라 REST API(`scripts/vercel-deploy.mjs`)로 한다 — 등록된
`VERCEL_TOKEN`이 프로젝트 스코프 토큰이어서 CLI가 동작하지 않는다(사유는
[ci.yml](.github/workflows/ci.yml)의 `deploy` 잡 주석). 스크립트는 배포가 끝 상태에
이를 때까지 폴링하므로 빌드 실패는 CI에서 빨갛게 드러난다.

Vercel의 **Git 자동배포는 [vercel.json](vercel.json)의 `git.deploymentEnabled.main=false`로
꺼져 있다** — 그래서 `deploy` 잡이 유일한 배포 경로다. 이 잡을 끄거나 실패를 무시하면
프로덕션을 배포하는 주체가 아무도 없게 된다.

## 마이그레이션 문제 해결

**1. 적용 이력 확인** — 어느 브랜치가 어디까지 적용됐는지는 DB에 물어본다.

```sql
select * from drizzle.__drizzle_migrations order by created_at;
```

`hash`는 해당 `drizzle/<tag>.sql` **파일 원본의 sha256**이고, `created_at`은
`drizzle/meta/_journal.json`의 `when`(ms)이다. 세 브랜치의 행이 같아야 정상이다.

**2. baseline 표시가 안 된 브랜치를 발견했을 때** — 이력이 빈 DB에 `migrate`를 돌리면 baseline의
`CREATE TABLE`이 기존 테이블과 충돌한다. `scripts/mark-migration-applied.mts`를 그 브랜치에 실행해
**실행 없이 적용됨으로 표시**한다. 멱등하다(같은 hash는 건너뜀). `public` 스키마가 기대한 베이스라인과
다르면 아무것도 쓰지 않고 중단한다.

```bash
npx dotenv -e .env.local -- node scripts/mark-migration-applied.mts   # dev
npx dotenv -e .env.test  -- node scripts/mark-migration-applied.mts   # test
# production — 커밋하지 않는 임시 파일로 받아 쓰고 즉시 지운다 (.env*는 .gitignore에 있다)
npx vercel env pull .env.production.local --environment=production
npx dotenv -e .env.production.local -- node scripts/mark-migration-applied.mts
npx dotenv -e .env.production.local -- drizzle-kit migrate   # production에 마이그레이션 적용
rm .env.production.local
```

`.mts`는 Node의 내장 타입 제거로 실행한다 — Node 22.18+ 또는 23+가 필요하다(그 아래라면
`npx tsx scripts/mark-migration-applied.mts`).

**3. 마이그레이션은 성공했는데 배포가 실패했을 때** — 스키마를 되돌리지 않는다. 마이그레이션은
추가 전용이므로 **이전 앱 버전이 계속 동작한다**(새 컬럼을 안 읽을 뿐). Vercel에서 이전 배포로
롤백하고, 원인을 고쳐 다시 푸시한다.

**4. 마이그레이션 자체가 실패했을 때** — Neon 브랜치는 시점 복구가 가능하다. 실패한 브랜치를
직전 시점으로 복구하거나, 어디까지 적용됐는지 확인해 수동 SQL로 정리한 뒤 이력 테이블을 손으로
맞춘다. 어느 쪽이든 **배포는 마이그레이션 뒤에 오므로 프로덕션 앱은 이전 버전으로 계속 서비스된다.**

## 원칙

- **돈은 불변 원장**: 모든 금액 변동은 append-only 이벤트. 수정은 역분개. 잔액은 파생값. ([ADR-001](docs/adr/001-immutable-ledger.md))
- **모든 쓰기는 검증·인가를 통과**: 서버 액션은 공개 엔드포인트다. ([ADR-002](docs/adr/002-server-action-authorization.md))
- **정산은 원장 밖**: 멤버 간 채무는 모임 돈이 아니다. 결과는 그 시점 이름까지 굳힌 스냅샷으로 남는다. ([ADR-003](docs/adr/003-settlement-outside-ledger.md))
- **문서가 단일 진실 원천**: [requirements](docs/requirements.md) → [설계 스펙](docs/superpowers/specs/2026-09-11-nbbang-design.md) → 구현 계획 순으로 진화.

## 개발

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (http://localhost:3000)
npm run lint       # ESLint
npx tsc --noEmit   # 타입 체크
npm test           # Vitest 단위 테스트 (DB 불필요 — CI의 check 잡이 DB 시크릿 없이 돌린다)
npm run test:integration  # Vitest 통합 테스트 (test 브랜치 DB를 TRUNCATE한다)
npm run build      # 프로덕션 빌드
npm run e2e        # Playwright E2E (test 브랜치 DB를 TRUNCATE한다)
```

### 테스트 세 층

| 층 | 명령 | 대상 | 고정하는 것 |
|---|---|---|---|
| 단위 | `npm test` | 순수 함수 (`lib/`) | 도메인 규칙·포맷·에러 판별 |
| 통합 | `npm run test:integration` | test 브랜치 DB 왕복 | 잔액 = 원장 합산, **어느 제약이** 모임 경계를 막는지, 삭제·탈퇴가 **무엇을 지우고 무엇을 남기는지**, 레이트 리밋의 원자성·fail-open |
| E2E | `npm run e2e` | 빌드된 앱 + 브라우저 | 화면 동선, **인가 매트릭스**(`e2e/authz.spec.ts`), 공개 장부 누출, 정산이 원장 밖임 |

E2E 스펙 7본이 각각 다른 주장을 맡는다: `foundation`(가입·개설·합류·권한),
`ledger`(잔액 = 원장 합산 + CSV 정확성·유출 금지), `authz`(쓰기 액션 8종 × 역할 5종),
`public-ledger`(링크 하나로 열리되 토큰·이메일·계좌는 새지 않음 + 처리방침 도달·외부요청 0건),
`settlement`(엔빵 계산 결과와 **정산이 잔액·공개 장부·CSV를 하나도 움직이지 않음** — ADR-003을
세 표면에서 확인한다), `rate-limit`(한도 초과 429 + 세 보안 헤더 + **다른 IP는 여전히 200**),
`account-delete`(탈퇴 동선과 **탈퇴자의 진짜 쿠키를 재생했을 때의 서버 거부**).

파괴적인 스펙은 **파일의 맨 마지막 테스트**에 둔다 — 삭제와 탈퇴는 되돌아오지 않으므로 뒤에
어떤 테스트도 그 계정·모임에 의존할 수 없다.

인가 매트릭스는 서버 액션 POST를 역할별 세션으로 재생해 거부 코드(`FORBIDDEN`/`NOT_MEMBER`/
`UNAUTHENTICATED`/`ENTRY_NOT_FOUND`/`NAME_MISMATCH`/`ACCOUNT_DELETED` …)를 단언한다 — 거부 화면에는 누를 버튼이 없으므로
UI 클릭으로는 확인할 수 없는 주장이다. Plan 02에서 손으로 하던 확인을 CI가 대신한다 (ADR-002).

"이 DB를 TRUNCATE해도 되는가"의 판정은 `test/db-guard.ts` **한 구현**을 Playwright와 Vitest가
함께 쓴다. 비우는 테이블 목록도 `lib/db/schema.ts`에서 스키마 이름까지 파생하므로 테이블 추가를
놓칠 수 없고, `truncateTestData`는 가드를 통과한 핸들만 받는 **브랜드 타입**을 요구하므로
"가드를 안 부르고 비우는" 호출은 타입 검사에서 막힌다.
