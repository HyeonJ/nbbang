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
| 정산 참여자 | `SettlementParticipant` | 정산 한 건의 참여자 한 명 — 부담액과 **그 시점의 표시 이름**을 굳힌 스냅샷 (ADR-003) |
| 선결제자 | `payer` (`isPayer`) | 정산 총액을 먼저 낸 사람. v1에서 정산당 한 명이고 유일한 채권자 |
| 이체 | `SettlementTransfer` | 정산 결과의 "누가(from) → 누구에게(to) 얼마" 한 줄 |
| 탈퇴 | `deleteAccount` | 계정 삭제 = 식별자 파기. 행은 남고 이름이 `탈퇴한 멤버`가 된다 (ADR-004). 탈퇴하면 모든 멤버십이 `withdrawn`으로 떠난 상태가 된다 (ADR-005) |
| 나가기 | `leaveGroup` | 멤버 본인이 모임을 떠난다. `left_reason = 'left'`. 초대 링크로 같은 멤버십으로 돌아올 수 있다. 버튼은 모임 대시보드에 있다 (ADR-005) |
| 내보내기 | `removeMember` | 총무가 멤버를 떠나게 한다. `left_reason = 'removed'`. 링크로는 돌아올 수 없고 총무가 되살린다 |
| 되살리기 | `restoreMember` | 내보낸 멤버를 다시 활동 중으로 돌린다. 스스로 나간 사람·탈퇴자는 대상이 아니다 |
| 회차 명단 | `dues_round_members` | 회차를 만들 때 고정되는 "이 회차에 내야 하는 사람" 목록. 미납·예상 금액의 기준 (ADR-005) |
| 면제 | `removeFromRound` | 총무가 회차 명단에서 사람을 뺀다. 납부한 사람은 뺄 수 없다 |
| 엔빵 | (서비스명/동사) | N분의 1로 나누기. UI에서 동사로 사용: "엔빵하기" |
| 카테고리 | `category` | 지출 분류 (코트비·장비·회식…) |

## 네이밍 규칙

- DB 테이블: snake_case 복수 (`ledger_entries`, `dues_rounds`)
- TS 타입/도메인: PascalCase 단수 (`LedgerEntry`), 함수는 동사 시작 camelCase
- 금액 필드는 항상 `amount`(정수 원). 파생 합계는 `total*`/`balance` 접두어로 구분
- UI 문구는 한글 용어 열을 그대로 사용 (혼용 금지: "라운드"❌ → "회차"⭕)
