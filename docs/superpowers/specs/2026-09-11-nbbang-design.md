# 엔빵 v1 설계 스펙

2026-09-11 브레인스토밍 승인. 요구사항은 [requirements.md](../../requirements.md), 결정 이유는 [adr/](../../adr/)에.

## 1. 스택 (2026-09-11 트렌드 검증 완료)

- **Next.js 15** App Router + React 19 + TypeScript — 단일 앱, 조회는 RSC, 쓰기는 서버 액션
- **Drizzle** + **Neon**(서버리스 Postgres) — 서버리스 콜드스타트·타입 안전 기준 2026 기본값
- **Better Auth** — 세션·소셜(여력 시 Google/카카오)
- **next-safe-action** — 모든 쓰기 액션의 입력 검증(zod)·인가 미들웨어
- Tailwind v4 · Vercel 배포 · GitHub Actions CI(lint→tsc→Vitest→Playwright)

## 2. 데이터 모델 (금액: 정수 원)

```
groups            id, name, inviteToken, publicToken, createdAt
memberships       userId × groupId, role(owner|member), displayName, joinedAt
ledger_entries    ★불변 원장: id, groupId, type(DUES_PAYMENT|EXPENSE|REVERSAL),
                  amount, occurredAt, category, memo, createdBy, reversalOf, createdAt
dues_rounds       groupId, 연월, 1인 금액, 상태
dues_payments     roundId × membershipId → ledgerEntryId (1:1)
settlements       groupId, 제목, 총액, 일자, createdBy
settlement_shares settlementId, from→to, amount  (분배 스냅샷)
```

- `ledger_entries`는 **append-only** — UPDATE/DELETE 없음. 정정은 REVERSAL 엔트리(`reversalOf`) 후 재기록 ([ADR-001](../../adr/001-immutable-ledger.md))
- 모임 잔액 = 원장 합산(파생값, 컬럼으로 저장하지 않음)
- 정산 분배는 그리디 최소 이체 알고리즘, **분배 합계 = 총액** 불변식

## 3. 레이어

```
app/(routes)        화면. 조회는 서버 컴포넌트에서 직접 lib/db 쿼리
actions/            모든 쓰기. next-safe-action: zod 파싱 → 인가 미들웨어 → 도메인 호출
lib/domain/         ledger.ts, settlement.ts, dues.ts — 순수 함수, DB 모름, Vitest 대상
lib/db/             Drizzle 스키마·쿼리·트랜잭션
```

- **인가** ([ADR-002](../../adr/002-server-action-authorization.md)): 액션 컨텍스트 `{userId, groupId, role}` 강제. v1 쓰기는 owner만, member는 열람. 예외 없음 — 서버 액션은 공개 HTTP 엔드포인트다.
- **에러**: 도메인 에러 코드(`NOT_MEMBER`, `ROUND_CLOSED`, `ALREADY_PAID`, …) → safe-action 결과 타입으로 UI까지 전달
- **테스트**: 도메인 순수 함수 Vitest(정산 불변식·역분개·경계값) + Playwright E2E(F1~F7) + CI

## 4. 화면 (모바일 퍼스트)

1. 랜딩 / 2. 로그인·가입(Better Auth) / 3. 내 모임 목록
4. 모임 대시보드 — 잔액·최근 내역·이번 달 납부 요약
5. 회차 상세 — 멤버×회차 납부 체크 그리드 + 미납 복붙 텍스트 버튼
6. 지출 입력·내역 / 7. 정산 마법사 — 참여자→금액→결과 카드(공유 텍스트)
8. 공개 장부 `/g/[token]` — 읽기 전용, 표시 이름만, 토큰 재발급으로 무효화
9. 설정 — 멤버·초대 링크·모임 정보

디자인 시안은 구현 전 별도 라운드(HTML 프로토타입)로 결정. 원칙: 금액은 tabular numerals, 라이트 우선.

## 5. 배포·운영

- Vercel + Neon 무료 티어, 레포 public(`HyeonJ/nbbang`), 시크릿은 전부 env
- 리스크: Neon 무료 콜드스타트 수백 ms — 허용, 문제 시 캐싱으로 대응
- Vercel Analytics만. 에러 추적은 v1.5에서 검토

## 6. 결정 이력

| 날짜 | 결정 |
|---|---|
| 2026-09-11 | 주제 선정: 5개 후보(회비·정산/인수인계 RAG/실시간 보드/예약/리그) → 회비·정산 확정. 근거: 실사용자 확보 최쉬움 + "돈 정합" 경력 서사의 속편 |
| 2026-09-11 | 스택: TS 풀스택 올인 (Java/Spring 강점 대신 미경험 영역 선택). Drizzle/Better Auth/Neon은 웹검색 트렌드 검증 |
| 2026-09-11 | 구조: 단일 앱+서버 액션 채택 (모노레포·분리 API·tRPC 기각 — v1 범위에 오버엔지니어링) |
| 2026-09-11 | v1 범위: 코어 장부 + 공개 링크·미납 복붙 텍스트·CSV 3종 추가 (실사용 정착 결정 요소) |
| 2026-09-11 | 실결제는 v1 비범위 — PG 가입에 사업자 필요, v2에서 샌드박스로 기술 검증 |
| 2026-09-11 | 이름: 엔빵(nbbang) — 후보 3라운드(총무·돈독·결 등) 끝에 확정 |
| 2026-09-15 | **정산은 원장에 기록하지 않는다** ([ADR-003](../../adr/003-settlement-outside-ledger.md)) — 멤버 간 채무는 모임 돈이 아니므로 잔액에 영향이 없다. 결과는 `settlement_participants`(전원 + 그 시점 표시 이름 + 선결제자 표시) + `settlement_transfers`에 **완전한 스냅샷**으로 저장하고, 조회 시 현재 명단을 조인하지 않는다 — 이름이 바뀌거나 멤버가 떠나도 과거 정산이 변하지 않아야 하므로 |
| 2026-09-15 | 정산 v1은 **선결제자 1명** 모델 — 채권자가 하나뿐이라 상계할 것이 없고 이체는 최대 n−1건. 다중 채권자 netting은 v1 비범위(요구사항 F4의 "최소 이체" 문구를 이에 맞게 정정) |
| 2026-09-15 | **`drizzle-kit push` 폐기 → 버전 마이그레이션 전환** — Plan 02는 사람이 세 브랜치를 각각 기억해 push하는 구조였고 production을 빠뜨려 배포본이 500이었다. 이제 `drizzle/*.sql`이 진실 원천이고, CI의 `deploy` 잡이 production 적용 → 배포를 순서대로 한다. check 잡은 "지금 스키마로 generate하면 새 마이그레이션이 나오는가"로 드리프트를 상태 검사한다 |
| 2026-09-15 | **복합 FK 하드닝** — 모임 경계를 액션 레이어만 보던 곳을 DB도 보게 바꿨다(`(group_id, id)` UNIQUE를 참조 대상으로). 타 모임 id를 직접 insert하는 경로가 `23503`으로 거부된다 — 인가가 뚫려도 돈이 모임을 넘지 못한다 |
| 2026-09-15 | **공개 장부 누출 방어를 응답 수준에서 고정** — `force-dynamic` + `no-store`(재발급한 옛 링크가 CDN에 남지 않게), `Referrer-Policy: no-referrer` + `X-Robots-Tag`(링크가 리퍼러·검색으로 새지 않게), 서드파티 리소스 0건, 전용 쿼리(컬럼 명시 선택). 공개 토큰은 **128비트**로 상향. 레이트 리밋은 v1 미도입으로 결정·기록 |
| 2026-09-15 | v1 완성(Plan 03 Task 11) — F1~F7 전부 배포·검증. 남은 성공 기준은 **실모임 온보딩** 하나뿐이며 코드 밖 활동이다 |
