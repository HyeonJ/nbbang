# 엔빵 (nbbang)

동호회·스터디 총무를 위한 회비 장부 — 걷고, 쓰고, 나누고, 투명하게 공개한다.

> **상태**: Plan 02(원장·회비·지출) 완료·배포 — https://nbbang-iota.vercel.app
> 회비를 걷고 지출을 쓰면 잔액이 원장 합산으로 따라온다. 다음은 Plan 03(정산·공개 장부·내보내기).

## 왜

총무는 매달 회비를 걷고, 지출하고, 엑셀 스크린샷을 카톡방에 올린다.
누가 냈는지 추적하고, 회식 엔빵을 계산하고, "회비 어디에 썼어요?"에 답하는 일 —
엔빵은 이 세 가지 스트레스를 없앤다.

## v1 범위

- [x] **F1** 모임 개설·초대 링크·멤버 관리 (총무/멤버 역할) — Plan 01
- [x] **F2** 회비 회차 생성 + 멤버별 납부 체크 — Plan 02
- [x] **F3** 지출 기록 (카테고리·메모, 역분개로 정정) — Plan 02
- [ ] **F4** 정산 마법사 — 엔빵 계산, "누가 누구에게 얼마" 최소 이체
- [ ] **F5** **공개 장부 뷰** — 로그인 없이 링크로 열람 (총무만 가입해도 모임 전체가 씀)
- [ ] **F6** 미납 현황 복붙 텍스트
- [ ] **F7** CSV 내보내기

남은 **F4~F7은 Plan 03**에서 다룬다.
(F6은 회차 화면에 미납 안내 문구·복사 버튼이 이미 있지만, 요구사항이 말하는 계좌 정보는
아직 데이터 모델에 없다 — 그 나머지를 Plan 03에서 마무리한다.)

비범위(v2+): 실결제/PG, 청구서·알림 발송, 영수증 OCR, 은행 연동.

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

`production` 적용은 **아직 수동이다** — CI 배포 잡(Plan 03 Task 1 Step 6)이 붙기 전까지는 아래
"마이그레이션 문제 해결" 2번의 production 절차로 env를 임시로 받아 `drizzle-kit migrate`를 돌린다.

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
- **문서가 단일 진실 원천**: [requirements](docs/requirements.md) → [설계 스펙](docs/superpowers/specs/2026-09-11-nbbang-design.md) → 구현 계획 순으로 진화.

## 개발

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (http://localhost:3000)
npm run lint       # ESLint
npx tsc --noEmit   # 타입 체크
npm test           # Vitest 단위 테스트
npm run build      # 프로덕션 빌드
npm run e2e        # Playwright E2E (test 브랜치 DB를 TRUNCATE한다)
```
