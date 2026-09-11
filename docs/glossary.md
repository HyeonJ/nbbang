# 엔빵 도메인 용어집

한글 용어 ↔ 코드 네이밍의 단일 기준. 코드·문서·UI 문구는 이 표를 따른다.

| 한글 (UI 문구) | 코드 | 정의 |
|---|---|---|
| 모임 | `Group` | 회비를 함께 관리하는 단위 (동호회·스터디) |
| 총무 | `owner` (role) | 모임의 관리자. v1에서 유일한 쓰기 권한자 |
| 멤버 | `member` (role) | 모임 구성원. 열람만 |
| 멤버십 | `Membership` | 사용자×모임 관계. `displayName`(모임 내 표시 이름) 보유 |
| 초대 링크 | `inviteToken` | 멤버 합류용 토큰 URL |
| 공개 장부 링크 | `publicToken` | 로그인 없는 읽기 전용 열람 토큰. 재발급 = 기존 링크 무효화 |
| 원장 | `LedgerEntry` | 불변(append-only) 금액 이벤트. 모든 돈의 단일 진실 원천 |
| 회비 납부 | `DUES_PAYMENT` (entry type) | 멤버의 회차 납부가 만든 수입 엔트리 |
| 지출 | `EXPENSE` (entry type) | 모임 돈이 나간 엔트리 |
| 역분개 | `REVERSAL` (entry type) | 기존 엔트리를 취소하는 반대 엔트리. `reversalOf`로 대상 참조 |
| 잔액 | `balance` | 원장 합산으로 계산되는 파생값. 저장하지 않음 |
| 회차 | `DuesRound` | 회비를 걷는 단위 (예: 2026년 1월분, 1인 20,000원) |
| 납부 기록 | `DuesPayment` | 회차×멤버십의 납부 체크. 원장 엔트리와 1:1 |
| 미납 | `unpaid` | 회차에서 납부 기록이 없는 상태 |
| 정산 | `Settlement` | 이벤트성 비용(회식 등)의 엔빵 나누기 한 건 |
| 분배 | `SettlementShare` | 정산 결과의 "누가(from) → 누구에게(to) 얼마" 한 줄 |
| 엔빵 | (서비스명/동사) | N분의 1로 나누기. UI에서 동사로 사용: "엔빵하기" |
| 카테고리 | `category` | 지출 분류 (코트비·장비·회식…) |

## 네이밍 규칙

- DB 테이블: snake_case 복수 (`ledger_entries`, `dues_rounds`)
- TS 타입/도메인: PascalCase 단수 (`LedgerEntry`), 함수는 동사 시작 camelCase
- 금액 필드는 항상 `amount`(정수 원). 파생 합계는 `total*`/`balance` 접두어로 구분
- UI 문구는 한글 용어 열을 그대로 사용 (혼용 금지: "라운드"❌ → "회차"⭕)
