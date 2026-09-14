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
