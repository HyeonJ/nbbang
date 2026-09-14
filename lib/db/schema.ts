import { integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
}, (t) => [uniqueIndex('memberships_user_group').on(t.userId, t.groupId)]);

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
});

export const duesRounds = pgTable('dues_rounds', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id),
  period: text('period').notNull(), // 'YYYY-MM'
  amountPerPerson: integer('amount_per_person').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 한 모임에 같은 달 회차는 하나뿐 — 액션의 사전 확인은 읽고 쓰는 사이가 비어 있어 이 인덱스가 최종 방어선이다.
  uniqueIndex('dues_rounds_group_period').on(t.groupId, t.period),
]);

export const duesPayments = pgTable('dues_payments', {
  id: text('id').primaryKey(),
  roundId: text('round_id').notNull().references(() => duesRounds.id),
  membershipId: text('membership_id').notNull().references(() => memberships.id),
  // 이 납부가 만든 원장 엔트리. 납부 취소 시 이 행은 지우고 원장에는 역분개를 남긴다.
  ledgerEntryId: text('ledger_entry_id').notNull().references(() => ledgerEntries.id),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('dues_payments_round_membership').on(t.roundId, t.membershipId)]);
