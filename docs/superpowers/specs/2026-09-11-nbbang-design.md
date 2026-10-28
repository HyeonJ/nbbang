# 엔빵 v1 설계 스펙

2026-09-11 브레인스토밍 승인. 요구사항은 [requirements.md](../../requirements.md), 결정 이유는 [adr/](../../adr/)에.

## 1. 스택 (2026-09-11 트렌드 검증 완료)

- **Next.js 15** App Router + React 19 + TypeScript — 단일 앱, 조회는 RSC, 쓰기는 서버 액션
- **Drizzle** + **Neon**(서버리스 Postgres) — 서버리스 콜드스타트·타입 안전 기준 2026 기본값
- **Better Auth** — 세션·소셜(여력 시 Google/카카오)
- **next-safe-action** — 모든 쓰기 액션의 입력 검증(zod)·인가 미들웨어
- Tailwind v4 · Vercel 배포 · GitHub Actions CI(lint→tsc→Vitest→Playwright)

## 2. 데이터 모델 (금액: 정수 원)

> 2026-10-28 갱신 — 초안(2026-09-11)의 `settlement_shares`·"그리디 최소 이체"·회차 `상태`는
> 구현 과정에서 바뀌었다. 아래가 현재 스키마이고, 정본은 `lib/db/schema.ts`다.

```
groups                  id, name, inviteToken, publicToken, accountLabel?, createdAt
memberships             id, userId × groupId, role(owner|member), displayName, joinedAt,
                        leftAt?, leftReason?(left|removed|withdrawn) — 둘은 CHECK로 함께 null/비null
ledger_entries          ★불변 원장: id, groupId, type(DUES_PAYMENT|EXPENSE|REVERSAL),
                        amount(부호 있음), occurredAt, category?, memo?, createdBy,
                        subjectMembershipId?, reversalOf?, createdAt
dues_rounds             id, groupId, period('YYYY-MM'), amountPerPerson, createdAt
dues_round_members      roundId × membershipId (+ groupId) — 회차 명단 스냅샷, 복합 FK 2개
dues_payments           groupId, roundId × membershipId → ledgerEntryId (1:1),
                        dues_payments_roster_fk → dues_round_members (명단 밖 납부·납부자 명단 삭제 불가)
settlements             id, groupId, title, total, payerMembershipId, occurredAt, createdBy
settlement_participants settlementId × membershipId, displayNameAtTime, shareAmount, isPayer
settlement_transfers    settlementId, from → to membershipId, amount
rate_limits             bucket(IP HMAC), count, windowStart        — 공개 장부 레이트 리밋
user.deleted_at         탈퇴 표시 (Better Auth 테이블에 추가한 컬럼)
```

- `ledger_entries`는 **append-only** — UPDATE/DELETE 없음. 정정은 REVERSAL 엔트리(`reversalOf`)로만 ([ADR-001](../../adr/001-immutable-ledger.md)).
  예외 둘: 모임 완전 삭제(행째 삭제)와 탈퇴 시 앱이 쓴 납부 메모의 이름 파기([ADR-004](../../adr/004-deletion-semantics.md)).
- 정정할 수 있는 것은 **지출뿐**이다. 회비 납부는 회차 화면의 납부 취소(역분개 + `dues_payments` 삭제)로만 되돌린다.
- 모임 잔액 = 원장 합산(파생값, 컬럼으로 저장하지 않음)
- 모임 경계는 `(group_id, id)` 복합 FK로 DB가 고정한다 — 타 모임 id를 가리키는 행은 23503
- 정산은 원장 밖이다([ADR-003](../../adr/003-settlement-outside-ledger.md)). v1은 **선결제자 1명** 모델이라 상계가 없고
  이체는 최대 n−1건, **부담액 합계 = 총액** 불변식, 나머지는 앞에서부터 1원씩

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
| 2026-09-17 | **Plan 04 실사용 전 하드닝** — 공개 링크 레이트 리밋(미들웨어, IP는 HMAC만, 보관 최대 48시간) · 모임 완전 삭제(FK 전이 폐포 대조) · 회원 탈퇴 = 식별자 파기([ADR-004](../../adr/004-deletion-semantics.md)) · 개인정보처리방침 · 세션 행 IP/UA 미보관 |
| 2026-10-27 | **P0: 탈퇴 시 앱이 쓴 납부 메모의 이름도 파기** — 파기 경계를 "자유 텍스트인가"에서 "누가 적었는가"로 개정(ADR-004 결정 2(b)). 키는 `ledger_entries.subject_membership_id`(납부 취소가 `dues_payments`를 지워도 남는다) |
| 2026-10-28 | 전체 회고 — 정정 대상을 지출로 한정(회비 납부를 정정 경로로 되돌리면 납부 취소가 영구히 막히던 결함), CI의 test DB·배포 직렬화. **기획 공백 발견: 멤버가 모임을 떠나는 경우가 모델에 없다** → Plan 05 첫 항목([requirements §8](../../requirements.md)) |
| 2026-10-28 | **Plan 05 멤버 생명주기** — 떠남은 상태(`left_at`/`left_reason`), 회차 명단은 생성 시점 스냅샷, 납부는 명단 안에서만([ADR-005](../../adr/005-member-lifecycle.md)) |
