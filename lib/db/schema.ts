import {
  boolean,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export * from './auth-schema';

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
