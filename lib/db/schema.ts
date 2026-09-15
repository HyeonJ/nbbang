import { foreignKey, integer, pgTable, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export * from './auth-schema';

export const groups = pgTable('groups', {
  id: text('id').primaryKey(), // crypto.randomUUID()
  name: text('name').notNull(),
  inviteToken: text('invite_token').notNull().unique(),
  publicToken: text('public_token').notNull().unique(),
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
