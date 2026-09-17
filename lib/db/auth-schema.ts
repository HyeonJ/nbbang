import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  /**
   * 탈퇴 시각. `null` = 활성 계정 (ADR-004).
   *
   * **이 컬럼은 Better Auth가 만든 것이 아니다** — 이 파일의 나머지는 `@better-auth/cli`가
   * 생성한 스키마이고, 이 한 줄만 손으로 더했다. 그래서 두 곳에 짝이 있어야 한다:
   *  1. `lib/auth.ts`의 `user.additionalFields.deletedAt` — 없으면 `getSession`이 돌려주는
   *     사용자 객체에서 **조용히 걸러진다**(어댑터는 `select *`로 읽지만 `parseUserOutput`이
   *     스키마에 선언된 필드만 남긴다). 그러면 `lib/session.ts`의 차단이 항상 통과한다.
   *  2. `drizzle/0006_user_deleted_at.sql` — 추가 전용 마이그레이션.
   *
   * ⚠️ **이 파일의 다른 timestamp와 달리 `withTimezone: true`다.** 나머지는 CLI가 만든
   * `timestamp`(without time zone)인데, 이 컬럼은 "언제 파기됐는가"라는 **시점**이고
   * 앱의 모든 테이블(`lib/db/schema.ts`)이 쓰는 표기와 같아야 비교가 흔들리지 않는다.
   * 기존 두 컬럼을 함께 고치지 않는 이유는 그것이 Better Auth가 읽고 쓰는 컬럼이라
   * 이 태스크의 범위를 넘기 때문이다.
   *
   * `user` 행을 지우지 않는 이유는 ADR-004에 있다 — `memberships.user_id` ·
   * `ledger_entries.created_by` · `settlements.created_by` 셋이 `notNull`로 이 행을 참조한다.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
