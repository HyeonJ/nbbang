import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
