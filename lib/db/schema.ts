import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export * from './auth-schema';

/**
 * 공개 장부(`/g/:token`) 레이트 리밋 카운터 — **고정 윈도(fixed window)**.
 *
 * `bucket`에는 **IP 평문이 들어가지 않는다.** `lib/client-ip.ts`의
 * `hashIp`(HMAC-SHA256, 앞 32자 = 128비트)만 들어간다. 이유 두 가지:
 *  1. 접속 IP는 개인정보다 — 평문으로 보관하면 처리방침에 수집·보관 사실을 적어야 하고,
 *     DB 유출 시 그대로 사람에 연결된다. HMAC이면 salt 없이는 복원할 수 없다.
 *  2. 길이가 고정된다 — IPv6 표기 흔들림·비정상 길이 문자열이 PK로 들어와 인덱스를
 *     팽창시키는 경로가 닫힌다(표기 정규화는 `clientIp`가 먼저 한다).
 *
 * ⚠️ **고정 윈도의 한계**: 윈도 경계에서 최대 2배 버스트가 가능하다(창 끝에 60회 +
 * 창 시작에 60회 = 2초 안에 120회). 이 제한의 목적은 "유출된 링크의 반복 긁기와 함수 호출
 * 비용 방어"이고 그 목적에는 충분하므로 v1은 고정 윈도로 간다. 정밀한 평활화가 필요해지면
 * 슬라이딩 윈도(로그 테이블 또는 토큰 버킷)로 바꾼다 — 그때 이 주석을 지운다.
 *
 * ⚠️ **인덱스를 일부러 두지 않는다.** 이 테이블의 행 수는 "최근 1분 안에 공개 장부를 연
 * 서로 다른 IP 수" 규모이고, 유일한 범위 조회는 정리 크론의 일 1회 전체 스캔이다.
 * 반면 쓰기는 요청마다 일어난다 — `window_start`에 인덱스를 달면 윈도가 리셋되는 update가
 * HOT 갱신에서 빠져 매번 인덱스를 건드린다. 싼 쪽은 인덱스 없는 일 1회 전체 스캔이다.
 */
export const rateLimits = pgTable('rate_limits', {
  // HMAC 해시에 용도 접두사를 붙인 값 — 같은 IP를 다른 목적으로 제한할 때 버킷이 섞이지 않는다.
  bucket: text('bucket').primaryKey(),
  count: integer('count').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
});

export const groups = pgTable('groups', {
  id: text('id').primaryKey(), // crypto.randomUUID()
  name: text('name').notNull(),
  inviteToken: text('invite_token').notNull().unique(),
  publicToken: text('public_token').notNull().unique(),
  /**
   * 미납 안내 문구에 붙일 입금 계좌 — 총무가 직접 입력하는 **자유 텍스트**다.
   * 예: '카카오뱅크 3333-01-1234567 정현인'. 은행·번호·예금주로 쪼개지 않는다:
   * 검증할 수도 없고(은행별 자릿수가 다르다), 쪼개면 세 칸을 모두 채우게 강요한다.
   *
   * ⚠️ 노출 범위는 **세 줄로 고정**이다 (외부 리뷰 MINOR 17):
   *   ① 인증된 멤버가 보는 회차 화면의 미납 안내 문구에만 나온다(총무·멤버 모두 — 멤버도 입금한다).
   *      **정산 공유 문구에는 넣지 않는다** — 정산의 채권자는 선결제한 멤버이고 모임 계좌가
   *      아니다(ADR-003). 거기에 이 줄을 붙이면 돈을 엉뚱한 곳으로 보내라고 말하는 셈이다.
   *   ② 공개 장부(`/g/:token`)에는 **절대** 나오지 않는다 — `public-queries.ts`의 select에 없다.
   *   ③ CSV 내보내기에 **넣지 않는다** — 그것은 원장 내보내기이지 모임 설정 내보내기가 아니다.
   * ②·③은 `e2e/public-ledger.spec.ts`와 `e2e/ledger.spec.ts`의 금칙 목록이 각각 지킨다.
   *
   * `null` = 계좌 없음. 빈 문자열은 저장하지 않는다(액션이 `''`를 `null`로 접는다) —
   * 두 값이 공존하면 "계좌가 있는가"가 두 개의 진실로 갈라진다.
   */
  accountLabel: text('account_label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable('memberships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id), // Better Auth user.id
  groupId: text('group_id').notNull().references(() => groups.id),
  role: text('role', { enum: ['owner', 'member'] }).notNull(),
  displayName: text('display_name').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('memberships_user_group').on(t.userId, t.groupId),
  // id는 이미 PK라 이 유니크는 행을 더 좁히지 않는다 — 존재 이유는 **복합 FK의 참조 대상**이다.
  // Postgres는 FK가 가리키는 컬럼 조합에 유니크 제약을 요구하므로, 이것이 없으면
  // dues_payments가 (group_id, membership_id)로 "같은 모임의 그 멤버십"을 가리킬 수 없다.
  unique('memberships_group_id_key').on(t.groupId, t.id),
]);

export const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id),
  type: text('type', { enum: ['DUES_PAYMENT', 'EXPENSE', 'REVERSAL'] }).notNull(),
  // 부호 있는 정수 원 — 수입 +, 지출 −. 잔액은 이 컬럼의 합이다(저장 금지).
  amount: integer('amount').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  category: text('category'),
  memo: text('memo'),
  createdBy: text('created_by').notNull().references(() => user.id),
  // 역분개 대상. 같은 대상에 둘 이상 달릴 수 없다.
  reversalOf: text('reversal_of').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 복합 FK 참조 대상 — dues_payments와 아래 자기참조 FK가 모두 이것을 가리킨다.
  unique('ledger_entries_group_id_key').on(t.groupId, t.id),
  // 역분개 대상은 반드시 **같은 모임의 실재하는** 엔트리다 — 액션 레이어에 더해 DB도 막는다.
  // reversal_of가 NULL이면(= 역분개가 아닌 엔트리) MATCH SIMPLE 기본 규칙에 따라 검사되지 않는다.
  // ⚠️ 이 FK는 위 reversal_of 유니크를 **대체하지 않는다** — "한 엔트리는 한 번만 역분개"는
  // 그 유니크의 일이고, 이 FK의 일은 "가리키는 엔트리가 같은 모임에 실재함"이다. 둘 다 필요하다.
  foreignKey({
    columns: [t.groupId, t.reversalOf],
    foreignColumns: [t.groupId, t.id],
    name: 'ledger_entries_reversal_fk',
  }),
  /**
   * 이 레포에서 가장 자주 도는 읽기의 모양 그대로다 — `where group_id = ? order by occurred_at`.
   * 그 형태를 쓰는 곳이 넷이다: 대시보드 최근 기록·지출 목록·공개 장부(`public-queries.ts`)·
   * CSV 내보내기. 잔액 합산(`sum(amount) where group_id`)까지 더하면 다섯이다.
   *
   * ⚠️ 정직하게 적어둘 것: `group_id` **단독 조회는 이미 인덱스를 탄다** —
   * `ledger_entries_group_id_key`(복합 FK의 참조 대상인 UNIQUE (group_id, id))가 선행 컬럼으로
   * group_id를 갖기 때문이다. 그래서 이 인덱스가 새로 제거하는 것은 **정렬 단계**이지 순차
   * 스캔이 아니다 — "순차 스캔을 없앤다"는 과장은 하지 않는다.
   *
   * 플랜의 Self-Review는 이 인덱스를 "v1 규모에서 불필요"로 의도적 제외했었다. Task 11에서
   * 뒤집은 근거: 마이그레이션 파이프라인(Task 1)이 생긴 뒤로 인덱스 추가는 **추가 전용 SQL 한
   * 줄**이 됐고, 행이 적은 지금이 가장 싼 시점이다(나중에는 같은 작업을 트래픽 아래에서 해야
   * 한다). `desc`로 적은 이유는 네 읽기 중 셋이 내림차순이기 때문이고, CSV의 오름차순 읽기도
   * 같은 인덱스를 **역방향 스캔**으로 쓴다 — 방향 때문에 인덱스가 둘 필요해지지 않는다.
   */
  index('ledger_entries_group_occurred').on(t.groupId, t.occurredAt.desc(), t.createdAt.desc()),
]);

export const duesRounds = pgTable('dues_rounds', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id),
  period: text('period').notNull(), // 'YYYY-MM'
  amountPerPerson: integer('amount_per_person').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 한 모임에 같은 달 회차는 하나뿐 — 액션의 사전 확인은 읽고 쓰는 사이가 비어 있어 이 인덱스가 최종 방어선이다.
  uniqueIndex('dues_rounds_group_period').on(t.groupId, t.period),
  // 복합 FK 참조 대상 (위 memberships_group_id_key와 같은 이유).
  unique('dues_rounds_group_id_key').on(t.groupId, t.id),
]);

/**
 * ⚠️ `groupId`는 "두 번째 진실 원천"이 아니다 — **복합 FK의 구성요소**다.
 * 단독 컬럼만 추가하면 round의 모임과 어긋날 수 있어 오히려 해롭고, 아래 세 복합 FK와
 * 함께여야 의미가 있다: 회차·멤버십·원장 엔트리가 **모두 이 결제와 같은 모임**임을 DB가 보장한다.
 * (이전에는 이 판정을 actions/dues.ts만 했고, Plan 02 Task 9는 타 모임 membership_id를 직접
 *  넣어 도달 불가 상태를 만들어냈다. 이제 그 insert는 23503으로 거부된다.)
 */
export const duesPayments = pgTable('dues_payments', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id),
  roundId: text('round_id').notNull(),
  membershipId: text('membership_id').notNull(),
  // 이 납부가 만든 원장 엔트리. 납부 취소 시 이 행은 지우고 원장에는 역분개를 남긴다.
  ledgerEntryId: text('ledger_entry_id').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dues_payments_round_membership').on(t.roundId, t.membershipId),
  // 기존 단일 컬럼 FK(round_id/membership_id/ledger_entry_id)는 이 셋이 대체한다 —
  // 단일 FK는 "그 행이 존재함"만 봤고 모임 경계는 보지 못했다.
  foreignKey({
    columns: [t.groupId, t.roundId],
    foreignColumns: [duesRounds.groupId, duesRounds.id],
    name: 'dues_payments_round_fk',
  }),
  foreignKey({
    columns: [t.groupId, t.membershipId],
    foreignColumns: [memberships.groupId, memberships.id],
    name: 'dues_payments_membership_fk',
  }),
  foreignKey({
    columns: [t.groupId, t.ledgerEntryId],
    foreignColumns: [ledgerEntries.groupId, ledgerEntries.id],
    name: 'dues_payments_entry_fk',
  }),
]);

/**
 * 이벤트 정산 한 건(회식비 엔빵 등). **원장을 건드리지 않는다** — 모임 돈이 아니라
 * 멤버 사이의 채무 정리이므로 잔액에 영향이 없다(ADR-003).
 *
 * v1은 **선결제자 1명** 모델이다: 한 사람이 총액을 먼저 내고 나머지가 그에게 보낸다.
 * 이 행은 머리말(제목·총액·선결제자·일자)만 들고, 계산 결과는 아래 두 테이블에 **전부** 적재된다.
 */
export const settlements = pgTable('settlements', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id),
  title: text('title').notNull(),
  total: integer('total').notNull(),
  // 선결제자 — 참여자 중 한 명. 모임 경계는 아래 복합 FK가 고정한다.
  payerMembershipId: text('payer_membership_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 복합 FK 참조 대상 — 아래 참여자·이체가 (group_id, settlement_id)로 이 행을 가리킨다.
  unique('settlements_group_id_key').on(t.groupId, t.id),
  foreignKey({
    columns: [t.groupId, t.payerMembershipId],
    foreignColumns: [memberships.groupId, memberships.id],
    name: 'settlements_payer_fk',
  }),
]);

/**
 * 정산 참여자 스냅샷 — 참여자 **전원**이 한 행씩 남는다(선결제자도, 부담액 0원도).
 *
 * ⚠️ 이 테이블은 초안에 없었다. 초안은 이체 행만 저장하면서 "스냅샷"이라 주장했는데
 * 그러면 ① 선결제자의 부담액 ② 0원 참여자 ③ 이체가 0건인 정산의 참여 인원
 * ④ 그 시점의 표시 이름이 전부 유실된다. 외부 리뷰(2026-09-15)가 BLOCKER로 지적해 분리했다.
 *
 * `displayNameAtTime`이 핵심이다 — 조회 시 `memberships`를 조인하면 누가 이름을 바꾸거나
 * 모임을 떠나는 순간 **과거 정산이 소급 변경된다**. 기록이 아니라 뷰가 되어버린다(ADR-003).
 */
export const settlementParticipants = pgTable('settlement_participants', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  settlementId: text('settlement_id').notNull(),
  membershipId: text('membership_id').notNull(),
  // 정산 시점의 표시 이름을 그대로 굳힌다 — 이후 명단이 어떻게 바뀌어도 이 값은 변하지 않는다.
  displayNameAtTime: text('display_name_at_time').notNull(),
  shareAmount: integer('share_amount').notNull(),
  isPayer: boolean('is_payer').notNull(),
}, (t) => [
  // 같은 사람이 한 정산에 두 번 들어오면 부담액이 두 줄로 갈라진다 — 마지막 방어선.
  // (경계에서는 createSettlement의 zod refine이, 도메인에서는 DUPLICATE_PARTICIPANT가 먼저 막는다.)
  uniqueIndex('settlement_participants_unique').on(t.settlementId, t.membershipId),
  foreignKey({
    columns: [t.groupId, t.settlementId],
    foreignColumns: [settlements.groupId, settlements.id],
    name: 'settlement_participants_settlement_fk',
  }),
  foreignKey({
    columns: [t.groupId, t.membershipId],
    foreignColumns: [memberships.groupId, memberships.id],
    name: 'settlement_participants_membership_fk',
  }),
]);

/**
 * 이체 목록 — "누가 누구에게 얼마". 선결제자가 채권자 한 명뿐이므로 최대 n−1행이다(ADR-003).
 * `from`·`to` **양쪽 모두** 복합 FK로 같은 모임임을 DB가 보장한다 — 초안은 `to` 쪽에 FK가
 * 없어 직접 insert로 타 모임·존재하지 않는 멤버십을 받을 수 있었다(외부 리뷰 IMPORTANT 5).
 */
export const settlementTransfers = pgTable('settlement_transfers', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  settlementId: text('settlement_id').notNull(),
  fromMembershipId: text('from_membership_id').notNull(),
  toMembershipId: text('to_membership_id').notNull(),
  amount: integer('amount').notNull(),
}, (t) => [
  foreignKey({
    columns: [t.groupId, t.settlementId],
    foreignColumns: [settlements.groupId, settlements.id],
    name: 'settlement_transfers_settlement_fk',
  }),
  foreignKey({
    columns: [t.groupId, t.fromMembershipId],
    foreignColumns: [memberships.groupId, memberships.id],
    name: 'settlement_transfers_from_fk',
  }),
  foreignKey({
    columns: [t.groupId, t.toMembershipId],
    foreignColumns: [memberships.groupId, memberships.id],
    name: 'settlement_transfers_to_fk',
  }),
]);
