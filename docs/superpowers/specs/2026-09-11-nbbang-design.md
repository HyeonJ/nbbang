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
